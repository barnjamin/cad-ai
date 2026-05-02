# AI-assisted OpenSCAD generation

This repo is now the OpenSCAD Flue workspace at the repository root.

It accepts a natural-language prompt, generates or revises OpenSCAD, then runs a bounded validation loop:

1. create a compact design spec,
2. generate or revise OpenSCAD,
3. compile with the bundled OpenSCAD WASM toolchain,
4. render preview images from the generated STL,
5. run visual critique,
6. do bounded repair if needed.

## Repo layout

```text
.
├─ .flue/agents/openscad.ts
├─ .flue/roles/
├─ .agents/skills/
├─ src/core/
├─ src/tools/
├─ src/llm/
├─ scripts/run-llama-openscad.ts
├─ vendor/openscad-wasm/
├─ .artifacts/
├─ AGENTS.md
├─ README.md
└─ plan.md
```

## Setup

From the repo root:

```bash
npm install
```

Create a `.env` file with whichever provider settings you want to use.

Common options:

```bash
# Optional explicit model override for the Flue agent
FLUE_MODEL_ID="anthropic/claude-sonnet-4-6"

# If using OpenRouter, the agent auto-selects an OpenRouter model when a key is present
OPENROUTER_API_KEY="..."
OPENROUTER_MODEL_ID="moonshotai/kimi-k2.6"
# or FLUE_MODEL_ID="openrouter/moonshotai/kimi-k2.6"
```

For the direct llama.cpp smoke test script:

```bash
VITE_LLAMACPP_BASE_URL="http://192.168.4.220:8080/"
LLAMACPP_MODEL_ID=""
LLAMACPP_MAX_TOKENS="4096"
```

## Run the agent locally

Start the Flue dev server from the repo root:

```bash
npm run dev
```

That serves the `openscad` webhook agent locally.

## Example: create a model

```bash
curl http://localhost:3583/agents/openscad/test-create \
  -H "Content-Type: application/json" \
  -d '{"mode":"create","prompt":"Create a simple parametric box with a centered cylindrical hole."}'
```

## Example: revise an existing model

```bash
curl http://localhost:3583/agents/openscad/test-revise \
  -H "Content-Type: application/json" \
  -d '{"mode":"revise","prompt":"Make the box taller and widen the hole.","currentCode":"difference() { cube([20,20,10], center=true); cylinder(h=20, r=3, center=true, $fn=48); }"}'
```

## Running with a custom prompt

### Option 1: direct webhook call

This is the easiest way to try a custom create prompt without fighting shell escaping:

```bash
curl http://localhost:3583/agents/openscad/custom-create \
  -H "Content-Type: application/json" \
  --data-binary @- <<'JSON'
{
  "mode": "create",
  "prompt": "Create a small wall-mount bracket with two countersunk screw holes, a vertical back plate, and a rounded front hook for hanging headphones."
}
JSON
```

Custom revise prompt example:

```bash
curl http://localhost:3583/agents/openscad/custom-revise \
  -H "Content-Type: application/json" \
  --data-binary @- <<'JSON'
{
  "mode": "revise",
  "prompt": "Keep the overall footprint, thicken the hook, and add a filleted-looking top transition using simple printable geometry.",
  "currentCode": "difference() { cube([60,20,8], center=true); translate([0,0,-1]) cylinder(h=10, r=4, center=true, $fn=48); }"
}
JSON
```

### Option 2: one-off local run with `flue run`

The package already includes sample scripts, but you can also invoke the agent directly with your own payload:

```bash
npx flue run openscad \
  --target node \
  --id custom-create \
  --env .env \
  --payload '{"mode":"create","prompt":"Create a desk cable clip with a C-shaped opening and a flat mounting base."}'
```

## Included npm scripts

```bash
npm run dev
npm run build
npm run typecheck
npm run run:sample:create
npm run run:sample:revise
npm run run:llama -- "Create a centered cube with a cylindrical hole through it."
```

## What the agent returns

The webhook response includes:

- `ok`
- `mode`
- `model`
- `spec`
- `finalCode`
- `attempts` with compile/render/critique diagnostics
- `summary`
- `warnings`

## Notes

- The old `flue-rewrite/` subdirectory is gone; this repo root is now the workspace.
- Compile validation uses the vendored OpenSCAD WASM toolchain in `vendor/openscad-wasm/`.
- Preview rendering is self-contained: SCAD is compiled to STL, then rasterized into PNG views inside `.artifacts/`.
- Visual critique is bounded; the loop does not repair indefinitely.
- The direct llama.cpp script is a separate smoke-test path and is not yet the default runtime path for the main Flue agent.
