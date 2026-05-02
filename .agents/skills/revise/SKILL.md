---
name: revise
description: Revise existing OpenSCAD to satisfy a change request while preserving good structure.
---

Revise the provided OpenSCAD program.

Inputs available in `args`:
- `prompt`: original change request
- `spec`: structured model specification
- `currentCode`: existing OpenSCAD code
- `critiqueSummary` (optional): summary of the latest visual critique
- `critiqueIssues` (optional): important visual mismatches to fix
- `suggestedEdits` (optional): concrete geometry edits suggested by critique
- `views` (optional): rendered view paths for the current candidate

Return JSON matching the requested schema.

Rules:
- Preserve working parts unless the change request requires otherwise.
- If visual critique inputs are present, change only the geometry needed to address those issues.
- Output plain OpenSCAD in the `code` field only.
- No markdown fences.
- Include a short `rationale` and a list of expected visible features after the revision.
