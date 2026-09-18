# Premises of AI Code Gauntlet

Stack-agnostic. Discipline lives in **gates and tools**, not prompt politeness.

## Thesis

Do not trust agent intelligence. Surround it with deterministic constraints:

1. Behavior in Gherkin (human defends; protect-specs is a hard gate)
2. HTTP contract in OpenAPI (human approves breaking changes)
3. Two test streams: unit (HOW) + acceptance (WHAT)
4. Static shape: lint, format, types, complexity
5. One pipeline (`verify`) locally and in CI
6. Agent does not rewrite specs to go green
7. spec-sync inventories routes, OpenAPI, `@op` tags, domain vs unit (D1-D8)
8. no-cheat fails skip/only, disabled gates, and lowered coverage floors
9. secrets-scan fails credentials, private keys, and high-confidence PII dumps
   (no standing `ALLOW_SECRETS`; reports must not echo secret values)
10. arch-bound fails if `src/domain` imports HTTP/UI/fs infra

See [ADR-spec-sync-drift.md](./ADR-spec-sync-drift.md).

## What the kit proves today

- Cucumber + Playwright (acceptance)
- Vitest + coverage floors (unit)
- OpenAPI contract checks + spec-sync inventory
- no-cheat + protect-specs (hard tools)
- deps-lock (manifest grant) + spec-review skill
- secrets-scan (credentials / private keys / conservative PII)
- arch-bound (`src/domain` must not import HTTP/UI/fs)
- Complexity gate on `src/domain` (max 10)
- CRAP ≤ 8 on touched `src/domain` after unit coverage
- Mutation gate on Todo (`scripts/mutation.ts`, 80% kill); template keeps `test:mutation` opt-in only
- ESLint + Prettier + TypeScript
- AGENTS.md + skills
- CI = the same gates

## Phase 2 / 3 (not wired yet)

Official Stryker package, dependency-cruiser package (arch-bound is wired),
perf budgets. SBOM and gitleaks are **CI extra jobs**, not local verify gates.
Java adapter is Camada 0 only until a Spring consumer.

Gherkin leakage is **D8** and is already wired.
