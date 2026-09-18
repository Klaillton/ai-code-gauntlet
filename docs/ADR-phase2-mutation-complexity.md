# ADR: Phase 2 — mutation + complexity

- **Status:** Accepted
- **Date:** 2026-09-03
- **Context:** AI Code Gauntlet kit (`Klaillton/ai-code-gauntlet`)
- **Related:** [ADR-spec-sync-drift.md](./ADR-spec-sync-drift.md)
- **Does not include:** deps-lock / spec-review (shipped separately; see ADR-phase2-deps-spec-review.md)

## Decision

Wire the next Phase 2 honesty controls on `src/domain`:

1. **Mutation testing** — Stryker-*equivalent* gate (`test:mutation` / `mutation`)
2. **Complexity budget** — deterministic cyclomatic max per domain function

Official Stryker (`@stryker-mutator/*`) is **not** added as a package.
The runner uses the TypeScript compiler API (already a dependency) plus
existing Vitest. Operators match Stryker's core set: equality, relational,
logical, boolean literals, unary-not, numeric +1.

**Done (A1, 2026-09-16):** CI `mutation-report.json` on main measured **100%**
kill (7/7 mutants, 0 timeout). Threshold raised to **80%**. Official Stryker
remains later. Do not lower coverage floors to make mutation green.

**Done (A3, 2026-09-16):** CRAP ≤ 8 on touched `src/domain` after unit coverage
(`scripts/crap.ts`). Cyclomatic max 10 remains the cheap pre-unit budget.

Gherkin leakage is **D8** and was already wired in `scripts/spec-sync.ts`
(`checkD8`). This PR does not change that check.

## Mutation

### Rule

`scripts/mutation.ts` mutates `src/domain/**/*.ts` (config `mutation.include`,
default `src/domain`) one site at a time, restores the file, and runs
`npx vitest run` (no coverage, so floors stay untouched).

- Baseline unit tests must already pass (fail-closed).
- Kill score = (killed + timeout) / mutantCount. Zero mutants → score 100
  with an info finding (empty/health-only domain).
- **Threshold: 80%** (`mutation.threshold`). Raised after CI measured 100%
  kill on Todo domain (artifact `gauntlet-todo`, 2026-09-16).
- Timeout (default 90s / `mutation.timeoutMs`) counts as **killed**
  (Stryker-like) so a hung mutant does not flake the gate. Residual risk:
  a truly hung runner looks like a kill.
- Report: `mutation-report.json` (gitignored); folded into
  `gauntlet-report.json`.

### Wiring

| App | Script | Gate |
| --- | --- | --- |
| `examples/todo` | `npm run test:mutation` | **yes** — after `unit`, before `contract` |
| `templates/ts-node-web` | `npm run test:mutation` | **omitted** from verify (speed; opt-in) |

Do **not** disable the Todo gate with `enabled: false` (no-cheat / D9).

## Complexity

### Rule

`scripts/complexity.ts` counts cyclomatic complexity per function-like
declaration under `src/domain` (if / loop / case / catch / `?:` / `&&` /
`||` / `??`; nested functions scored separately). Fail if any function
exceeds **max 10**.

Uncle Bob CRAP ≤ 8 is `complexity^2 * (1-coverage)^3 + complexity`. That
needs a coverage combo this MVP does not compute. Cyclomatic **max 10**
is the deterministic stand-in; document CRAP as a later raise, not a
silent skip.

ESLint `complexity: ["error", { max: 10 }]` is also on `src/domain/**/*.ts`
so editors fail the same budget. The dedicated gate does not depend on
someone deleting that rule.

### Wiring

| App | Script | Gate |
| --- | --- | --- |
| `examples/todo` | `npm run complexity` | **yes** — after `typecheck` |
| `templates/ts-node-web` | `npm run complexity` | **yes** (cheap / not heavy) |

## CRAP

`scripts/crap.ts` after unit coverage. Formula:
`complexity² × (1 − file line coverage)³ + complexity` per function in
`src/domain` files present in the git diff (same surfaces as protect-specs,
including the main-push skip). Fail if any score **> 8**. Missing
`coverage/coverage-summary.json` fails closed. Empty domain diff is info.

| App | Script | Gate |
| --- | --- | --- |
| `examples/todo` | `npm run crap` | **yes** — after `unit`, before `mutation` |
| `templates/ts-node-web` | `npm run crap` | **yes** — after `unit`, before `contract` |

Config: `complexity.include` (default `src/domain`), `complexity.max`
(default `10`). Report: `complexity-report.json` (gitignored).

## D8

Confirmed present in `scripts/spec-sync.ts`: `checkD8` fails `.feature`
steps that leak CSS, `data-testid` / `getByTestId`, `nth-child`, or raw
HTTP paths. No change in this PR.

## Consequences

- Weak domain tests fail `mutation` on Todo (survivors listed in the report).
- God-functions in `src/domain` fail `complexity` / lint.
- Template verify stays fast (no mutation gate).
- Coverage floors in `vitest.config.ts` are **90/90/70/90** on `src/domain`
  (B3). Do not lower them.
- Keep both gate sets together on main (`deps-lock` plus `complexity` /
  Todo `mutation`). This ADR does not duplicate deps-lock or spec-review.

## Residual risks

- **CI time:** each mutant is a full Vitest process. Todo domain is small
  today (single-digit mutants). Growth in `src/domain` will stretch the
  example-todo job; timeout raised to 30 minutes as headroom.
- **Flaky mutation:** timeout-as-killed can hide a hung runner; Vitest
  worker flakes would count as kills. Re-run `npm run test:mutation`
  locally before blaming product code.
- **Timeout-as-killed** can hide a hung runner; re-run `npm run test:mutation`
  locally before blaming product code.
- **Not official Stryker:** operator coverage is the core set only (no
  string / optional-chaining / statement-removal). Sufficient for this
  domain; revisit when adopting Stryker.

## Out of scope

- Official `@stryker-mutator/core` + lockfile (follow-up; needs
  `deps-approved`)
- dependency-cruiser / architectural drift
- CRAP-with-coverage (needs coverage combo)
- deps-lock / spec-review (see sibling ADR)
