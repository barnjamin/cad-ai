# OpenSCAD agent plan

## Current repo state

The former `flue-rewrite/` workspace has been moved to the repository root.

Current top-level structure:

- `.flue/agents/openscad.ts` — main webhook agent
- `.flue/roles/` — coder and critic roles
- `.agents/skills/` — `specify`, `generate`, `revise`, `repair-compile`, `critique-visual`
- `src/core/` — orchestration and shared types
- `src/tools/` — compile, render, and hashing tools
- `src/llm/` — llama.cpp client helpers
- `scripts/run-llama-openscad.ts` — direct llama.cpp smoke test
- `vendor/openscad-wasm/` — bundled OpenSCAD WASM runtime
- `.artifacts/` — generated `.scad`, `.stl`, and preview images

## What is implemented now

The root workspace currently supports:

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
2. produce a compact model spec
3. generate or revise OpenSCAD
4. compile with bundled OpenSCAD WASM
5. if compile fails, repair with bounded retries
6. render preview images from the compiled STL
7. critique the rendered result
8. if critique fails, revise with bounded retries
9. return final code plus diagnostics

## Current response shape

The agent returns a structured result with:

- `ok`
- `mode`
- `model`
- `spec`
- `finalCode`
- `attempts[]`
  - compile result
  - optional render result
  - optional critique result
- `summary`
- `warnings[]`
- `failureReason` when the loop exhausts its budget

## Validation/tooling status

Working now:

- bundled WASM compile path in `src/tools/compileOpenScad.ts`
- self-contained STL preview rendering in `src/tools/renderViews.ts`
- bounded loop orchestration in `src/core/runOpenScadLoop.ts`
- direct llama.cpp smoke-test script in `scripts/run-llama-openscad.ts`

Still incomplete or intentionally limited:

- richer preview styling and edge overlays
- stronger change-preservation checks for revise mode
- persisted regression fixtures and batch evaluation harness
- richer artifact/attempt logging beyond the current response payload
- llama.cpp wired into the main Flue runtime path as a first-class provider option

## Practical next steps

1. improve preview image quality and diagnostics
2. add fixture-based regression tests for create and revise flows
3. strengthen revise-mode preservation and diff summaries
4. expose richer artifact paths/logs in the response contract
5. decide whether to keep or rename the legacy `flue-rewrite` package name in `package.json`
6. optionally wire the llama.cpp path into the primary agent runtime

## Non-goals for now

- unbounded self-repair loops
- dependence on an external OpenSCAD CLI for validation or rendering
- complex multi-agent decomposition beyond the current coder/critic split

## Success criteria for this phase

The root workspace should remain able to:

- accept `create` and `revise` requests,
- generate readable OpenSCAD,
- validate it with the bundled compiler,
- render review images locally,
- perform bounded critique-driven repair,
- return a useful structured result for both manual testing and future regression runs.
