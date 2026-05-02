---
name: repair-compile
description: Repair OpenSCAD code using compile feedback.
---

Repair the provided OpenSCAD using compile feedback.

Inputs available in `args`:
- `prompt`: original user request
- `spec`: structured model specification
- `currentCode`: broken OpenSCAD code
- `compileSummary`: compact compile failure summary
- `stderr`: relevant compile stderr lines

Return JSON matching the requested schema.

Rules:
- Fix the compile issue first.
- Preserve the intended design as much as possible.
- Output plain OpenSCAD in the `code` field only.
- No markdown fences.
- Keep changes as small as possible when feasible.
