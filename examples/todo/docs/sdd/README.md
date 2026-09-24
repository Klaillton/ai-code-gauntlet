# SDD Security + Observability (D15)

Greenfield apps ship mandatory:

- `Security.md` — security requirements
- `Observability.md` — observability requirements

Gate **sdd-presence (D15)** fails when SDD is active and either file is missing,
empty, lacks a heading, or has no requirement list item.

Skip with `sdd: false` in `gauntlet.config.json`.

**Residual:** lorem/TODO-only bodies still pass presence — quality is Spec review.
