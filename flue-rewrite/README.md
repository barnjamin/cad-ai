# flue-rewrite

Isolated Flue workspace for the OpenSCAD rewrite.

## Default choices

- Target: Node.js
- Layout: `.flue` workspace layout inside `flue-rewrite/`
- Default model: `anthropic/claude-sonnet-4-6`
- If `OPENROUTER_API_KEY` or `OPENROUTER_KEY` is set and `FLUE_MODEL_ID` is empty, the agent defaults to `openrouter/moonshotai/kimi-k2.6`

## Commands

```bash
cd flue-rewrite
npm install
cp .env.example .env
npm run dev
```

OpenRouter setup example:

```bash
OPENROUTER_API_KEY="..."
OPENROUTER_MODEL_ID="moonshotai/kimi-k2.6"
# or FLUE_MODEL_ID="openrouter/moonshotai/kimi-k2.6"
```

Sample invocation:

```bash
curl http://localhost:3583/agents/openscad/test-1 \
  -H "Content-Type: application/json" \
  -d '{"mode":"create","prompt":"Create a simple parametric box with a centered cylindrical hole."}'
```

Direct llama.cpp smoke test using the original project's OpenAI-compatible connection pattern:

```bash
npm run run:llama -- "Create a centered cube with a cylindrical hole through it."
```

## Notes

- The agent now runs a bounded spec -> generate/revise -> compile -> render -> critique loop.
- Compile validation uses the bundled OpenSCAD WASM toolchain.
- Preview rendering is self-contained: SCAD is compiled to STL with WASM, then rasterized to PNG views inside the workspace.
- The visual critique stage consumes those rendered views, and the loop can perform bounded visual revisions when critique fails.
