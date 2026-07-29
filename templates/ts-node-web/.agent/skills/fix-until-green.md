# Skill: fix-until-green

Use when verify/CI is red and the agent must restore the gauntlet.

## Protocol

1. Run `npm run verify` (or the single failing script if already known)
2. Classify the first failing gate:
   - format/lint/typecheck → fix style/types, do not touch features
   - unit/coverage → fix code or add real tests (never delete coverage config)
   - contract → align implementation to OpenAPI (not the reverse, unless human asked)
   - e2e → fix app or step defs; **do not** edit `.feature` without permission
3. Apply the smallest fix
4. Re-run the failed gate, then full `npm run verify`
5. Repeat up to **5** cycles
6. If still red: report gate, error excerpt, hypotheses, and stop

## Cheating detection (self-check before done)

- Any `.skip` / `xit` / `test.skip` added? → revert
- Asserts loosened without product reason? → revert
- Feature file “fixed” to match buggy UI? → revert + ask human
- Coverage threshold lowered? → revert

## Exit codes

- 0 only with full green verify
- non-zero with clear handoff notes otherwise
