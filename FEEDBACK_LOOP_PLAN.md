# OpenSCAD Feedback Loop Improvement Plan

## Status Update (Current)

The feedback-loop work now exists in **two layers**:

1. **App-integrated compile/repair flow**
   - structured compile reports emitted from preview to app state,
   - artifact/version matching using `artifactId` + `codeHash`,
   - compile error normalization for repair prompts,
   - bounded one-shot auto-repair for compile failures,
   - user-visible repair/compile progress in chat and preview UI,
   - stricter OpenSCAD prompting plus basic sanitation/validation of generated code.

2. **New headless/lib-first evaluation flow**
   - reusable feedback-loop core extracted into `src/lib/feedbackLoop/`,
   - headless artifact generator in `src/lib/ai/buildArtifactHeadless.ts`,
   - Node-friendly OpenSCAD compiler using bundled WASM in `src/lib/compiler/nodeOpenScadCompiler.ts`,
   - CLI runner in `scripts/eval-feedback-loop.ts`,
   - default prompt ladder in `src/lib/feedbackLoop/defaultCases.ts`,
   - successful live smoke test against the llama.cpp endpoint at `http://192.168.4.220:8080` using `unsloth/Qwen3.6-27B-GGUF:Q4_K_XL`.

What is **not** implemented yet:

- app UI and headless eval do **not** yet share one single orchestration path,
- multi-view preview snapshot capture,
- vision-assisted repair using preview images,
- user-invoked “fix preview” / visual mismatch workflow,
- richer semantic/geometry evaluation beyond compile success.

## Goal
Improve the model generation and repair loop so the system can:

1. surface specific compile/runtime errors back to the LLM,
2. automatically attempt targeted fixes,
3. run both in-app and headlessly as reusable library code,
4. include rendered preview images from multiple viewpoints when useful,
5. keep the user informed about what failed and what retry is happening,
6. avoid endless retry loops.

---

## Current Issues Observed

### 1. Invalid model output reaches the compiler
Examples seen so far:
- plain English text at the top of the generated file,
- invalid OpenSCAD syntax,
- reserved keywords used as variables,
- malformed `for` syntax,
- invalid geometry assignment patterns.

### 2. Compile feedback is not part of the generation loop
Right now the app shows compile errors in preview, but the generation flow does not reliably:
- feed exact OpenSCAD errors back into model repair,
- associate those errors with the specific artifact version that failed,
- retry with structured context.

### 3. Visual feedback is missing from repair prompts
For geometry that technically compiles but is wrong, the LLM has no rendered images from the app preview.

### 4. No bounded repair state machine
A robust loop needs:
- explicit states,
- retry counters,
- artifact-version matching,
- cancellation when the user edits/selects something else.

---

## Proposed Design

## Phase 0: Headless/lib-first workflow

**Status:** Implemented

### A. Extract reusable feedback-loop core
Implemented in:
- `src/lib/feedbackLoop/types.ts`
- `src/lib/feedbackLoop/runFeedbackLoop.ts`
- `src/lib/feedbackLoop/defaultCases.ts`

The core loop now supports dependency injection for:
- artifact generation,
- artifact compilation,
- bounded repair retries,
- result summarization.

### B. Add Node-friendly artifact generation adapter
Implemented in:
- `src/lib/ai/buildArtifactHeadless.ts`

This provides a headless path that reuses the existing chat/provider behavior in a Node-friendly way without requiring the React app runtime.

### C. Add Node-friendly OpenSCAD validation/compiler adapter
Implemented in:
- `src/lib/compiler/nodeOpenScadCompiler.ts`

This uses the bundled OpenSCAD WASM directly in Node and returns compile reports compatible with the feedback loop.

### D. Add CLI evaluation runner
Implemented in:
- `scripts/eval-feedback-loop.ts`
- `package.json` script: `npm run eval:feedback-loop`

This runner takes explicit env/config and can evaluate the default prompt ladder outside the app.

### E. Remaining gap in the architecture
Not implemented yet:
- `useCadApp.ts` still owns its own app-side orchestration,
- the app path has not yet been rewritten to call the new `src/lib/feedbackLoop` core directly.

## Phase 1: Structured compile feedback pipeline

**Status:** Implemented

### A. Add compile result callbacks from preview to app state
Implemented. The preview stack now emits structured compile reports back into app state for the active artifact/code version.

Suggested shape:

```ts
type ArtifactCompileReport = {
  artifactId: string;
  codeHash: string;
  status: 'success' | 'error';
  errorMessage?: string;
  stdErr?: string[];
  fileType?: 'stl' | 'svg';
  generatedAt: number;
};
```

The preview component should emit a report whenever:
- compile succeeds,
- compile fails,
- a newer compile supersedes an older one.

### B. Tie reports to a specific artifact version
Implemented. Compile reports are keyed by:
- `artifactId`,
- `codeHash` of the compiled code.

This prevents stale worker results from triggering repairs against a newer artifact.

### C. Normalize OpenSCAD errors before repair
Implemented. A helper now turns verbose OpenSCAD stderr into a compact repair payload.

Example normalized payload:

```ts
type NormalizedCompileError = {
  summary: string;
  line?: number;
  column?: number;
  relevantStdErr: string[];
};
```

Parsing rules:
- extract `line N` when present,
- keep the first parser/runtime error,
- keep a few nearby stderr lines,
- drop noisy/non-actionable lines such as localization warnings unless they are the only signal.

---

## Phase 2: Automatic one-shot repair loop

**Status:** Implemented for compile-failure auto-repair

### A. Add repair state to `useCadApp`
Implemented. Repair attempts are tracked in app state/ref and tied to artifact/code state.

Suggested tracking model:

```ts
type RepairAttemptState = {
  artifactId: string;
  codeHash: string;
  attempts: number;
  status: 'idle' | 'repairing' | 'failed' | 'succeeded';
  lastError?: string;
};
```

### B. Trigger repair only under strict conditions
Implemented. Auto-repair runs only when:
- the artifact came from assistant generation,
- compile failed,
- the failure corresponds to the currently selected artifact version,
- the app is not already generating,
- attempts for this artifact/code hash are below a small limit.

Recommended initial limit:
- `1` automatic retry for syntax/compile failures.

### C. Reuse existing `build_parametric_model` pathway
Implemented in spirit using the same strict OpenSCAD generation pathway and repair context (`baseCode` + normalized `error`).

The current tool schema already supports an `error` field.
Use that instead of inventing a new generation path.

Repair request should include:
- current broken code as `baseCode`,
- normalized compile error string as `error`,
- original user intent if available,
- optionally image IDs once image capture exists.

Example repair instruction payload:

```json
{
  "text": "Fix this OpenSCAD model so it compiles and preserves the intended design.",
  "baseCode": "...broken code...",
  "error": "Parser error: syntax error in file /input.scad, line 1. The first line is not valid OpenSCAD.",
  "imageIds": []
}
```

### D. Surface repair progress in chat UI
Implemented. Repair/compile status is surfaced in both the chat UI and the preview workspace.

While repair is happening, show a compact assistant status such as:
- `Repairing model from compile error…`
- `Retry failed: parser error on line 1`

This should appear as a tool/status state rather than silently mutating the model.

---

## Phase 3: Multi-view render capture for visual feedback

**Status:** Not implemented yet

### A. Capture preview snapshots from the 3D viewport
Add a render capture utility to the preview viewport using the underlying Three.js renderer/canvas.

Target viewpoints:
- front,
- top,
- right,
- isometric.

Recommended output:
- PNG data URLs,
- modest resolution like 512×512,
- one batch captured after successful compile and geometry load.

### B. Add snapshot metadata type
Suggested shape:

```ts
type ArtifactSnapshot = {
  id: string;
  artifactId: string;
  codeHash: string;
  view: 'front' | 'top' | 'right' | 'iso';
  mediaType: 'image/png';
  dataUrl: string;
  createdAt: number;
};
```

### C. Store only recent snapshots
Avoid bloating state.
Keep snapshots only for:
- the selected artifact,
- optionally the most recent successful compile for recent assistant artifacts.

### D. Use snapshots only when supported by the selected model
Not every model supports vision.
Repair flow should:
- include images only when `supportsVision === true`,
- otherwise fall back to text-only error context.

### E. Use snapshots mainly for semantic/geometry repair
Snapshot-assisted repair is most helpful when:
- the model compiles but looks wrong,
- bores are missing,
- proportions are off,
- orientation is wrong,
- a requested feature did not appear.

For pure parser errors, compile stderr is usually enough.

---

## Phase 4: “Compile OK but visually wrong” feedback loop

**Status:** Not implemented yet

### A. Add user-invoked repair action
Auto-repair is best for syntax/compile failures.
For geometry issues, add a user-triggered action like:
- `Fix preview`
- `Regenerate from preview`
- `Explain mismatch`

This action should package:
- current code,
- latest snapshots,
- the user’s correction text.

### B. Feed back visual discrepancy prompts
Example prompt payload:

```json
{
  "text": "The model compiles, but the center bore is missing and the teeth are too blocky. Keep the outer diameter similar.",
  "baseCode": "...current code...",
  "imageIds": ["front", "iso", "top"]
}
```

---

## Phase 5: Prompt and validation improvements

**Status:** Partially implemented

### A. Tighten strict OpenSCAD prompt
Implemented. The strict code prompt now explicitly forbids non-code output and common invalid patterns.

Add rules such as:
- first line must be valid OpenSCAD or a comment,
- never prepend explanations,
- do not use reserved keywords as variable names,
- use valid OpenSCAD loop syntax,
- use `r`/`d` for cylinders,
- avoid assigning geometry expressions to variables.

### B. Add local validation before preview compile
Partially implemented. A cheap validator/sanitizer now catches obvious bad generations before artifact commit, though this is still generation-side validation rather than a separate preview preflight pass.

Before sending code to OpenSCAD, run a cheap validator for obvious issues:
- suspicious prose on line 1,
- unmatched delimiters,
- `for (... in ...)` patterns,
- `radius =` on cylinders,
- variable named `module`, `color`, etc. when risky.

This validator does **not** replace OpenSCAD compilation.
It just catches trivial bad generations early and produces clearer repair context.

### C. Add code sanitation before artifact commit
Implemented. Generated code is sanitized before artifact commit.

Before storing a generated artifact:
- strip markdown fences,
- extract likely SCAD blocks,
- remove obvious leading prose,
- normalize line endings.

If sanitation still yields low-confidence code, mark the tool call as failed instead of committing the artifact.

---

## State Machine Proposal

```text
user prompt
  -> planner/tool call
  -> code generation
  -> sanitize/validate
  -> preview compile
      -> success
           -> capture snapshots
           -> ready
      -> error
           -> normalize compile error
           -> if retry budget remains
                -> repair request
                -> generated code
                -> sanitize/validate
                -> preview compile again
           -> else
                -> show error to user
```

Important invariants:
- one in-flight repair per artifact/code hash,
- stale compile results ignored,
- repair cancelled if user changes selected artifact or sends a new prompt,
- hard retry limit.

---

## Suggested Implementation Order

### Completed
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- most of the prompt/sanitation work from Phase 5

### Remaining
- Step 4.5
- Step 5
- Step 6
- Step 7

### Step 0
Extract and stabilize the headless/lib-first runner:
- reusable feedback-loop core,
- Node-friendly generator adapter,
- Node-friendly OpenSCAD compiler,
- CLI runner with explicit config.

### Step 1
Add structured compile report callbacks from preview to app.

### Step 2
Add normalized compile error extraction helper.

### Step 3
Add one-shot auto-repair on compile failure using existing agent tooling.

### Step 4
Add UI state for repair progress and failure reporting.

### Step 4.5
Refactor `useCadApp.ts` to consume the shared `src/lib/feedbackLoop` core so app and headless flows use the same orchestration.

### Step 5
Add multi-view snapshot capture after successful preview renders.

### Step 6
Plumb snapshots into repair/generation for vision-capable models.

### Step 7
Add user-invoked visual repair flow for “looks wrong” cases.

---

## Risks / Things to Watch

### 1. Infinite repair loops
Mitigation:
- retry cap,
- artifact/code-hash tracking,
- skip auto-repair on unchanged regenerated code.

### 2. Excess token usage from images
Mitigation:
- use only 2–4 compact snapshots,
- only send them when necessary,
- only for vision models.

### 3. Race conditions between preview and repair
Mitigation:
- attach `artifactId` + `codeHash` to reports,
- ignore stale callback results.

### 4. Large state payloads from data URLs
Mitigation:
- keep snapshots ephemeral,
- avoid persisting them to local storage,
- retain only latest successful set.

### 5. Poor repair quality from noisy stderr
Mitigation:
- normalize errors,
- keep only relevant lines,
- provide line-number-specific context where available.

---

## Deliverables

### Milestone 0: Headless evaluation workflow
**Status: Done**
- reusable feedback-loop core in `src/lib/feedbackLoop/`,
- headless artifact generator,
- Node-friendly OpenSCAD WASM compiler,
- CLI runner via `npm run eval:feedback-loop`,
- default evaluation case ladder,
- validated with a live llama.cpp smoke test.

### Milestone 1: Robust compile error repair
**Status: Done**
- compile reports wired to app state,
- normalized error extraction,
- single automatic repair retry,
- user-visible repair status.

### Milestone 1.5: Shared orchestration across app + headless
**Status: Not started**
- move app-side loop ownership out of `useCadApp.ts`,
- make app and headless paths call the same core runner.

### Milestone 2: Visual feedback support
**Status: Not started**
- multi-view snapshot capture,
- snapshot storage for latest good preview,
- optional image inclusion in repair prompts.

### Milestone 3: Visual correction workflow
**Status: Not started**
- explicit user action to repair based on preview mismatch,
- improved prompting for geometry corrections.

---

## Recommendation
**Milestone 0 and Milestone 1 are now complete.**

Recommended next step: **Milestone 1.5**.

Reason:
- the new headless path now works,
- the app still has duplicate orchestration in `useCadApp.ts`,
- unifying the loop before adding image-based repair will reduce drift and duplicated bug fixes.

After Milestone 1.5, proceed to Milestone 2 for snapshot capture and vision-capable repair.
