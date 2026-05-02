---
name: generate
description: Generate a fresh OpenSCAD program from a structured spec.
---

Write a fresh OpenSCAD program from the provided spec.

Inputs available in `args`:
- `prompt`: original user request
- `spec`: structured model specification

Return JSON matching the requested schema.

Rules:
- Output plain OpenSCAD in the `code` field only.
- No markdown fences.
- Prefer valid, compact, readable code.
- Use simple parameterization when it helps later edits.
- Include a short `rationale` and a list of expected visible features.
