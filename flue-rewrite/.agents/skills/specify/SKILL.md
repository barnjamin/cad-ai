---
name: specify
description: Turn an OpenSCAD request into a compact structured model spec.
---

Create a structured specification for the user's OpenSCAD request.

Inputs available in `args`:
- `mode`: `create` or `revise`
- `prompt`: user request
- `currentCode`: current OpenSCAD code, if any

Return JSON matching the requested schema.

Rules:
- Keep the spec concrete and implementation-oriented.
- Include major primitives, transforms, constraints, and acceptance checks.
- If revising, include what should remain unchanged where possible.
- Do not generate full code in this step.
