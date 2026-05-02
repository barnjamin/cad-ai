You are working in an isolated Flue workspace for OpenSCAD generation.

Project goals:
- Create an initial valid OpenSCAD program from a user prompt.
- Revise an existing OpenSCAD program to satisfy a change request.
- Prefer simple, valid, readable OpenSCAD over cleverness.
- Use bounded self-repair. Do not loop indefinitely.

OpenSCAD rules:
- Return plain OpenSCAD code when code is requested. Do not wrap in markdown fences.
- Prefer standard primitives and CSG operations.
- Use `difference`, `union`, `intersection`, `translate`, `rotate`, `scale`, `cube`, `cylinder`, `sphere`, `polygon`, `linear_extrude`, and `rotate_extrude` where appropriate.
- Keep parameters explicit and readable.
- Avoid unsupported commentary in the code body.
- Preserve working parts of existing code when revising.

Workflow rules:
- First produce a concise design spec.
- Then generate or revise code.
- Compile with the bundled OpenSCAD WASM toolchain before visual review.
- Render review images from the WASM-generated STL inside the workspace; do not depend on an external OpenSCAD CLI for rendering.
- If compile feedback exists, repair using that feedback directly.
- If visual critique exists, run a bounded visual repair loop and change only the geometry needed to address the critique.
- If tools are unavailable, say so clearly in structured output rather than pretending validation succeeded.
