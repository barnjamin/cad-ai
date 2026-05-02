---
name: critique-visual
description: Evaluate rendered OpenSCAD views against the prompt and spec.
---

Critique the current OpenSCAD output using the prompt, structured spec, and any rendered views.

Inputs available in `args`:
- `prompt`: original user request
- `spec`: structured model specification
- `currentCode`: current OpenSCAD code
- `renderSummary`: summary from the mesh-to-image renderer
- `renderOk`: whether all requested views rendered successfully
- `renderStderr`: render diagnostics if any
- `views`: list of rendered views and file paths

Return JSON matching the requested schema.

Rules:
- Focus on whether the model appears to satisfy the request.
- Report only the most important issues.
- If the model looks acceptable, pass it.
- If images are missing or incomplete, note that clearly.
- Use the render diagnostics when image coverage is partial.
