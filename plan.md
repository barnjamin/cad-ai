# OpenSCAD design-agent plan

## Product goal

Build a Flue-based OpenSCAD agent that can:

1. create an initial design from a natural-language prompt,
2. evaluate that design with compile and visual validation,
3. accept follow-up change requests,
4. revise the design while preserving requested unchanged intent,
5. repeat this loop in a bounded, inspectable way.

The goal is not just to produce valid OpenSCAD once. The goal is to support an iterative design workflow where a user can progressively refine a model and understand what changed at each revision.

## Current repo state

Current top-level structure:

- `.flue/agents/openscad.ts` — main webhook agent
- `.flue/roles/` — coder and critic roles
- `.agents/skills/` — `specify`, `generate`, `revise`, `repair-compile`, `critique-visual`
- `src/core/` — orchestration and shared types
- `src/tools/` — compile, render, and hashing tools
- `src/llm/` — LLM environment and OpenAI-compatible helpers
- `scripts/run-llm-openscad.ts` — direct LLM smoke test
- `vendor/openscad-wasm/` — bundled OpenSCAD WASM runtime
- `.artifacts/` — generated `.scad`, `.stl`, and preview images

## What is implemented now

The current workspace already supports:

- `create` mode from a natural-language prompt
- `revise` mode from a prompt plus existing OpenSCAD
- payload validation in the webhook agent
- structured spec generation before coding
- initial code generation or revision
- compile validation via the bundled OpenSCAD WASM toolchain
- bounded compile repair retries
- STL-based preview rendering into fixed views (`front`, `top`, `right`, `iso`)
- visual critique against the prompt and spec
- bounded visual repair retries
- structured response output with attempt history, warnings, and final code

## Current runtime flow

1. normalize request payload
2. produce a compact design spec
3. generate or revise OpenSCAD
4. compile with bundled OpenSCAD WASM
5. if compile fails, repair with bounded retries
6. render preview images from the compiled STL
7. critique the rendered result
8. if critique fails, revise with bounded retries
9. return final code plus diagnostics

## Main gap between current state and product goal

The current pipeline is good at producing and repairing a single candidate.

The main remaining gap is support for a strong iterative design workflow:

- preserving unchanged design intent across revisions,
- making revisions traceable and inspectable,
- comparing versions rather than only attempts,
- evaluating multi-step design sequences instead of isolated runs,
- keeping user-requested changes central rather than treating revision as generic regeneration.

## Design iteration model

The system should treat each user-visible design step as a revision in a design history, not just as an isolated call.

A healthy design loop should look like this:

1. user provides an initial design prompt,
2. agent produces a spec and first design candidate,
3. agent validates compile and renders review images,
4. user requests one or more changes,
5. agent updates the spec while explicitly preserving unaffected intent,
6. agent revises only the geometry needed,
7. agent validates compile and renders again,
8. agent returns the new revision plus a clear change summary,
9. repeat until the design is accepted or revision budget is exhausted.

## State model for iterative design

To support revision quality, each design revision should have a clear source of truth.

At minimum, a revision record should contain:

- `designId` — stable identifier for the overall design thread
- `revisionId` — identifier for the current user-visible revision
- `parentRevisionId` — previous revision, if any
- `mode` — `create` or `revise`
- `userPrompt` — latest request
- `basePrompt` — original design brief
- `spec` — structured current design spec
- `preserve[]` — features or constraints explicitly meant to remain unchanged
- `changeSummary` — concise summary of requested and applied changes
- `currentCode` — resulting OpenSCAD
- `artifacts` — paths or ids for `.scad`, `.stl`, rendered views, and metadata
- `attempts[]` — internal compile/repair/critique attempts within this revision
- `validationSummary` — compile/render/critique result summary

Important distinction:

- a **revision** is a user-visible design step,
- an **attempt** is an internal repair or critique loop within one revision.

The current code already models attempts well. The next phase should model revisions equally well.

## Revision contract

Each revise request should follow a stricter contract than it does today.

For every revision, the agent should:

1. restate the requested changes,
2. restate the features that must be preserved,
3. update the structured spec,
4. revise only affected geometry where possible,
5. validate compile,
6. render and critique the result,
7. return a concise summary of what changed and what stayed the same.

This should help prevent revise mode from drifting into effective regeneration from scratch.

## Preservation requirements

For this project, preservation is a core feature, not a nice-to-have.

Unless explicitly requested otherwise, revise mode should aim to preserve:

- overall design purpose,
- working structural elements,
- existing dimensions or proportions that were not targeted for change,
- mounting, fit, clearance, or symmetry relationships already present,
- readable structure and naming in working code.

The agent should avoid:

- unnecessary rewrites of the whole program,
- changing unrelated geometry during visual repair,
- silently dropping important existing features,
- introducing extra complexity without a prompt-driven reason.

## Validation model

Validation should continue to remain bounded and layered.

### Layer 1: syntax and compile validation

Required on every candidate:

- OpenSCAD parses successfully,
- bundled WASM compile succeeds,
- compile diagnostics are recorded,
- bounded compile repair is attempted when needed.

### Layer 2: visual plausibility validation

Required when rendering is available:

- render standard views from the compiled STL,
- critique the rendered output against the prompt and spec,
- perform bounded visual repair when critique identifies high-value mismatches.

### Layer 3: revision-preservation validation

Needed to support iterative design well:

- compare old and new specs,
- summarize requested changes vs incidental changes,
- detect likely loss of preserved features,
- flag suspiciously large rewrites in revise mode.

This third layer is currently the most important missing validation area.

## Artifact and versioning strategy

Artifacts should be treated as part of the product surface, not just debug output.

For each revision, persist or expose:

- generated `.scad`
- compiled `.stl`
- rendered preview images
- structured spec snapshot
- critique summary
- attempt metadata
- hashes linking related artifacts together

This will support:

- manual review,
- future UI integration,
- regression testing,
- comparison across revisions,
- reproducibility of failure cases.

## Evaluation strategy

Single-turn smoke tests are useful, but they are not enough for the real goal.

The evaluation strategy should prioritize multi-step design sequences.

### High-value fixture types

1. **Create-only fixtures**
   - verify initial prompt-to-design quality
   - check compile and render success

2. **Revise-preservation fixtures**
   - start from a known working design
   - request one localized change
   - verify unrelated features remain intact

3. **Multi-step iteration fixtures**
   - create a design
   - apply two to four consecutive revisions
   - verify the design converges rather than drifts

4. **Compile-repair fixtures**
   - feed broken or partially broken OpenSCAD
   - verify bounded repair behavior

5. **Visual-repair fixtures**
   - use prompts that are likely to produce plausible but incorrect geometry
   - verify critique causes focused fixes rather than broad rewrites

### Evaluation questions that matter most

- Did the requested change actually happen?
- Did the agent preserve what it should have preserved?
- Did compile and render remain valid?
- Did the code stay readable enough for future revision?
- Does the design improve across iterations instead of drifting?

## Runtime and session strategy

The project should explicitly decide how iterative state is managed.

There are two broad approaches:

### Option A: explicit revision payloads

Each revise request carries the needed state explicitly, such as:

- current code,
- prior spec,
- revision metadata,
- artifact references.

Pros:

- easier to test,
- more deterministic,
- less dependent on session memory,
- better for batch regression and external integrations.

### Option B: stateful Flue sessions

Use stable Flue agent ids or session ids to preserve conversation and workspace state across requests.

Pros:

- simpler user interaction,
- natural fit for iterative conversations,
- useful when building a richer interactive app later.

Recommended direction for now:

- keep design state explicit in the response and payload contract,
- optionally use Flue sessions as a convenience layer,
- do not rely on conversation memory alone as the only source of truth for revise behavior.

## What remains incomplete or intentionally limited

Still incomplete or intentionally limited:

- stronger revise-mode preservation checks
- structured change summaries between revisions
- persistent revision metadata beyond the current response payload
- fixture-based regression coverage for multi-step design iteration
- richer preview diagnostics and image quality
- stronger detection of over-large rewrites in revise mode
- direct OpenAI-compatible path wired into the main Flue runtime as a first-class provider option
- a final decision on project/package naming consistency

## Practical next steps

1. define a canonical revision record
   - add design-level and revision-level identifiers
   - separate revision history from attempt history
   - expose artifact references in a stable shape

2. strengthen revise-mode preservation
   - require explicit preserved features in spec output when revising
   - add a change summary for every revision
   - detect and flag suspiciously broad rewrites

3. add multi-step regression fixtures
   - create → revise → revise sequences
   - include preservation-focused assertions
   - store golden specs, code, and artifacts where practical

4. improve artifact persistence and inspection
   - save spec and critique snapshots alongside `.scad`, `.stl`, and previews
   - make artifact locations easier to consume programmatically

5. improve preview diagnostics and render quality
   - make failures clearer
   - improve view consistency
   - leave room for overlays or edge rendering later

6. decide on iteration-state strategy
   - keep explicit payload-based revision state as the default
   - decide whether stable Flue session ids should also be part of the API story

7. optionally wire the direct OpenAI-compatible path into the main runtime
   - only after the design-loop contract is stronger

8. clean up naming and packaging
   - decide whether to keep or rename the legacy `flue-rewrite` package name in `package.json`

## Non-goals for now

- unbounded self-repair loops
- dependence on an external OpenSCAD CLI for validation or rendering
- complex multi-agent decomposition beyond the current coder/critic split
- fully automatic geometric equivalence checking
- production UI work before the revision contract and evaluation harness are stronger

## Success criteria for this phase

This phase is successful when the workspace can reliably:

- accept an initial design prompt,
- generate readable OpenSCAD,
- validate it with the bundled compiler,
- render review images locally,
- perform bounded critique-driven repair,
- accept follow-up change requests,
- preserve unaffected design intent across revisions,
- report what changed vs what stayed the same,
- return a useful structured result for both manual testing and future regression runs.

## Summary

The project already has a strong single-revision generation and validation pipeline.

The next phase should focus less on adding more isolated tooling and more on making the agent behave like a real iterative design system:

- revision-aware,
- preservation-aware,
- artifact-aware,
- and testable across multi-step design workflows.
