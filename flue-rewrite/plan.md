# Flue rewrite plan for OpenSCAD generation and revision

## Workspace

- **Directory:** `flue-rewrite/`
- **Reason:** keep the Flue-based rewrite isolated from the existing browser app while still living in the same repo.
- **Flue layout:** because the workspace now already contains files (for example this `plan.md`), use the **`.flue` layout** from the Flue docs:
  - `flue-rewrite/.flue/agents/`
  - `flue-rewrite/.flue/roles/`
- **Shared harness context:**
  - `flue-rewrite/AGENTS.md`
  - `flue-rewrite/.agents/skills/`

## Current status

Implemented so far:

- isolated Node.js Flue workspace in `flue-rewrite/`
- `.flue` workspace layout with one webhook agent:
  - `.flue/agents/openscad.ts`
- workspace-level harness context:
  - `AGENTS.md`
  - `.agents/skills/`
- initial roles:
  - `.flue/roles/openscad-coder.md`
  - `.flue/roles/openscad-critic.md`
- initial skills:
  - `specify`
  - `generate`
  - `revise`
  - `repair-compile`
  - `critique-visual`
- orchestrated loop in `src/core/runOpenScadLoop.ts`
- bundled **OpenSCAD WASM** compiler integrated in `src/tools/compileOpenScad.ts`
- llama.cpp smoke-test client copied/adapted from the original project:
  - `src/llm/llamaCppClient.ts`
  - `scripts/run-llama-openscad.ts`

Working now:

- payload validation for `create` and `revise`
- spec -> generate/revise -> compile -> bounded compile repair flow
- compile validation using the bundled WASM compiler
- multi-view rendering from the WASM-generated STL artifact (`front`, `top`, `right`, `iso`)
- visual critique wired into the main loop
- bounded visual repair loop after critique
- build + typecheck of the Flue workspace

Not done yet:

- richer render styling/edge overlay tuning
- fixture/regression harness inside the rewrite workspace
- llama.cpp wired directly into the Flue agent runtime path

Current external blocker:

- the remote llama.cpp endpoint at `http://192.168.4.220:8080/` was reachable earlier, but is currently timing out from this machine, so end-to-end llama-driven runs are blocked until that endpoint is reachable again.

## What we are building

A Flue agent workspace focused on one job:

1. **Create** an initial valid OpenSCAD program from a natural-language prompt.
2. **Revise** an existing OpenSCAD program to satisfy a change prompt.
3. Run an internal **evaluation + repair loop** that uses:
   - compile feedback,
   - rendered images from multiple views,
   - bounded retries,
   - structured summaries of what changed.

This should produce a practical first version that is more reliable than a single-shot LLM call.

## Why Flue fits

From the Flue docs and README:

- Flue is a **headless agent harness** framework in TypeScript.
- It supports **agents, roles, skills, sessions, and tasks**, which maps well to a multi-step CAD workflow.
- It can run on **Node.js** first, which is the easiest target for local tool integration.
- It supports **local sandboxes** and **container sandboxes** later if we need stronger isolation.
- A lot of the orchestration can live in **Markdown roles/skills**, which is useful for prompt iteration without burying all behavior in TypeScript.

## Recommended first deployment target

Use **Node.js** first.

Why:
- easiest way to call existing local OpenSCAD-related tooling,
- easiest way to reuse code already present in this repo,
- easiest way to run evaluations offline and in CI,
- no need to solve Cloudflare/container details before the core loop works.

## Proposed model

Current default for the Flue agent:
- **`anthropic/claude-sonnet-4-6`**

Reason:
- strong instruction following,
- good code editing behavior,
- easy first integration with Flue's normal `init({ model })` flow.

Additional local generation path already scaffolded:
- llama.cpp at **`http://192.168.4.220:8080/`**
- tested model choices observed on that endpoint included:
  - `ggml-org/gemma-4-E2B-it-GGUF:Q8_0`
  - `unsloth/Qwen3.6-27B-GGUF:Q4_K_XL`

Planned direction:
- keep Anthropic as the default Flue-hosted path for now,
- continue testing the local llama.cpp path as an alternate generator once the endpoint is reachable again.

## Design principles

1. **Bounded loops only** — no open-ended self-repair.
2. **Compile first, then visual critique** — syntax validity is the first gate.
3. **Keep artifacts explicit** — prompt, plan, code, compile report, renders, critique, and revision history should all be structured.
4. **Separate orchestration from domain prompts** — TypeScript for flow control; roles/skills for task behavior.
5. **Reuse proven code from the current repo where possible** instead of rewriting OpenSCAD evaluation from scratch.

## Reuse from the existing project

The current repo already has useful headless feedback-loop work. The rewrite should likely adapt rather than replace these ideas/components:

- `src/lib/compiler/nodeOpenScadCompiler.ts`
- `src/lib/feedbackLoop/runFeedbackLoop.ts`
- `src/lib/ai/buildArtifactHeadless.ts`
- `scripts/eval-feedback-loop.ts`
- notes in `FEEDBACK_LOOP_PLAN.md`

The Flue rewrite should wrap equivalent capabilities as Flue tools/workflows instead of embedding all logic in the current app state layer.

## High-level architecture

### Public surface

A single webhook-oriented orchestrator agent is enough for v1:

- `.flue/agents/openscad.ts`

Payload modes:

```ts
{ mode: 'create', prompt: string }
{ mode: 'revise', prompt: string, currentCode: string }
```

The public agent should:
1. normalize input,
2. create a spec/plan,
3. generate or revise code,
4. run evaluation,
5. repair if needed,
6. return final code plus diagnostics.

### Internal roles

Implemented roles:

- `.flue/roles/openscad-coder.md`
  - writes and edits practical OpenSCAD from a spec
- `.flue/roles/openscad-critic.md`
  - critiques current code/results against prompt intent and visible geometry

Possible future split if the workflow grows more complex:

- dedicated planner role
- dedicated compile-repair role
- dedicated finalizer role

### Internal skills

Implemented Markdown skills under `.agents/skills/`:

- `.agents/skills/specify/SKILL.md`
- `.agents/skills/generate/SKILL.md`
- `.agents/skills/revise/SKILL.md`
- `.agents/skills/repair-compile/SKILL.md`
- `.agents/skills/critique-visual/SKILL.md`

Still optional later:

- `.agents/skills/decide-next-step/SKILL.md`

These keep orchestration readable and make prompt tuning possible without rewriting the agent code.

## Runtime pipeline

### 1. Input normalization

Convert incoming payload into a structured request:

```ts
type OpenScadRequest = {
  mode: 'create' | 'revise';
  userPrompt: string;
  currentCode?: string;
};
```

Derived fields:
- design intent summary,
- constraints,
- must-have features,
- forbidden shortcuts,
- output expectations.

### 2. Spec creation

Run a planning/spec step before code generation.

Output should be structured, for example:

```ts
type ModelSpec = {
  summary: string;
  primitives: string[];
  dimensions: string[];
  constraints: string[];
  assumptions: string[];
  acceptanceChecks: string[];
};
```

This gives the later critique loop something stable to compare against besides the raw user prompt.

### 3. Initial code generation

- `create` mode: generate a fresh OpenSCAD program.
- `revise` mode: transform the provided code with the change request while preserving unaffected behavior.

Generation output should be normalized into:

```ts
type CandidateProgram = {
  code: string;
  rationale: string;
  expectedViews: string[];
};
```

### 4. Compile evaluation

Run the candidate through a compile tool.

Expected result shape:

```ts
type CompileResult = {
  ok: boolean;
  summary: string;
  stderr: string[];
  line?: number;
  column?: number;
  artifacts?: {
    stlPath?: string;
    previewMeshPath?: string;
  };
};
```

If compile fails:
- pass the code + normalized compile report to the `compile-repairer` role,
- retry with a small hard limit,
- stop and return a structured failure if the limit is exhausted.

### 5. Multi-view rendering

If compile succeeds, render images from multiple fixed viewpoints:

- front
- top
- right
- isometric

Output shape:

```ts
type RenderSet = {
  views: Array<{
    name: 'front' | 'top' | 'right' | 'iso';
    imagePath: string;
  }>;
};
```

### 6. Visual critique

Use the original prompt + structured spec + rendered views to ask:
- does the object broadly match intent?
- are expected features visible?
- are proportions obviously wrong?
- is the requested change reflected?

Output should be structured:

```ts
type VisualCritique = {
  pass: boolean;
  score: number;
  issues: string[];
  suggestedEdits: string[];
};
```

If critique fails:
- send the current code + critique summary back to the editor/repairer,
- regenerate a revised candidate,
- compile again,
- rerender,
- re-evaluate.

## Feedback-loop state machine

The loop should be explicit rather than implicit prompt chaining.

```ts
type LoopStage =
  | 'spec'
  | 'generate'
  | 'compile'
  | 'repairCompile'
  | 'render'
  | 'critiqueVisual'
  | 'repairVisual'
  | 'done'
  | 'failed';
```

Suggested limits:
- initial generation: 1 pass
- compile repairs: 2 retries
- visual repairs: 2 retries
- total loop budget: 5 candidate programs max

Stop conditions:
- compile passes and visual critique passes,
- retry budget exhausted,
- repeated near-identical failure,
- invalid or empty model output,
- tool/runtime failure.

## Suggested Flue implementation approach

### Orchestrator agent

`.flue/agents/openscad.ts` should be thin orchestration code:

- initialize agent with a chosen model,
- use `session.skill()` for named stages,
- use `session.task()` for isolated sub-work when helpful,
- call local tools/scripts for compile and render,
- keep all attempt metadata in structured objects.

### Sandbox strategy

For v1, use **`sandbox: 'local'`** on Node.js so the agent can access:
- the isolated Flue workspace,
- render outputs,
- fixture prompts,
- evaluation logs,
- local tool wrappers.

This is the fastest path to a working prototype.

For hosted multi-tenant use later, move to a container sandbox.

## Tooling plan

The Flue agent will need trusted, non-LLM tool wrappers for deterministic steps.

### Tool 1: compile OpenSCAD

Input:
- code string
- optional output paths

Output:
- normalized `CompileResult`

Chosen implementation:
1. reuse/adapt the existing **Node-friendly OpenSCAD WASM** compiler path from the original repo,
2. keep the compile path self-contained inside the workspace so downstream rendering can consume the generated STL directly.

### Tool 2: render OpenSCAD views

Input:
- code or compiled artifact
- target views

Output:
- PNG paths for each requested view

Chosen implementation:
1. compile OpenSCAD to STL with the bundled OpenSCAD WASM tool,
2. parse the STL in Node,
3. rasterize fixed orthographic preview views to PNG inside the workspace.

This keeps rendering self-contained and avoids any dependency on an external OpenSCAD CLI binary.

### Tool 3: hash + diff candidate programs

Used to:
- detect unchanged retries,
- avoid wasting loop budget,
- produce concise revision summaries.

### Tool 4: fixture evaluation runner

Feed canned prompts through the agent and store:
- final code,
- compile outcome,
- render outputs,
- critique summaries,
- pass/fail score.

This becomes the regression harness for the rewrite.

## File layout after current scaffolding

```text
flue-rewrite/
  package.json
  tsconfig.json
  README.md
  AGENTS.md
  plan.md
  .env.example
  .flue/
    agents/
      openscad.ts
    roles/
      openscad-coder.md
      openscad-critic.md
  .agents/
    skills/
      specify/
        SKILL.md
      generate/
        SKILL.md
      revise/
        SKILL.md
      repair-compile/
        SKILL.md
      critique-visual/
        SKILL.md
  src/
    core/
      runOpenScadLoop.ts
      types.ts
    llm/
      llamaCppClient.ts
    tools/
      compileOpenScad.ts
      renderViews.ts
      hashProgram.ts
  scripts/
    run-llama-openscad.ts
  vendor/
    openscad-wasm/
```

## Response contract for v1

The webhook should return something like:

```ts
type OpenScadAgentResponse = {
  ok: boolean;
  mode: 'create' | 'revise';
  spec: ModelSpec;
  finalCode?: string;
  attempts: Array<{
    index: number;
    compile: CompileResult;
    critique?: VisualCritique;
  }>;
  summary: string;
  failureReason?: string;
};
```

This keeps the output useful both for a UI and for offline evaluation.

## Phase plan

### Phase 1: isolated Flue skeleton — **done**

- create Node-based Flue workspace ✅
- scaffold one webhook agent ✅
- add AGENTS, roles, and placeholder skills ✅
- wire a minimal create/revise orchestration path ✅

### Phase 2: deterministic compile loop — **mostly done**

- add compile tool wrapper ✅
- switch compile path to bundled OpenSCAD WASM ✅
- add bounded compile repair loop ✅
- save richer attempt logs to disk ⏳

### Phase 3: render + visual critique — **mostly done**

- add multi-view renderer from the WASM-generated STL ✅
- pass renders into critique step ✅
- add bounded visual repair loop ✅
- return richer diagnostics ⏳

### Phase 4: revise flow — **started**

- support existing-code edits via `mode: 'revise'` ✅
- add stronger change-preservation checks ⏳
- diff old vs new code and summarize changes ⏳

### Phase 5: regression harness — **not started in this workspace**

- port over or adapt existing feedback-loop fixtures ⏳
- run batch evaluations from prompt suites ⏳
- compare models and prompt variants ⏳

### Phase 6: llama.cpp integration — **started**

- copy/adapt llama.cpp OpenAI-compatible connection logic from the original project ✅
- add direct smoke-test script ✅
- wire llama.cpp into the Flue agent runtime path ⏳
- validate against `192.168.4.220:8080` once reachable again ⏳

## Main risks

1. **Rendering path may be the hardest part** if we need robust multi-view images outside the browser.
2. **Vision input plumbing** depends on the exact provider/model path we choose.
3. **Local sandbox is not isolated**, so it is perfect for prototyping but not final multi-tenant hosting.
4. **OpenSCAD success is not geometry success**; the visual critique loop is necessary to catch plausible-but-wrong outputs.

## Recommended next implementation step

After the current progress, the next concrete task should be:

1. improve render quality and diagnostics from the WASM/STL preview renderer,
2. add regression fixtures so render + critique behavior can be benchmarked repeatedly,
3. wire the llama.cpp client into the Flue agent path as an alternate provider/generator,
4. restore successful connectivity to `192.168.4.220:8080` and rerun smoke tests.
