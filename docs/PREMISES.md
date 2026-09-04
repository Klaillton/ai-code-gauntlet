# Premisses of AI Code Gauntlet

Stack-agnostic. Discipline lives in **gates and tools**, not prompt politeness.

## Thesis

Do not trust agent intelligence. Surround it with deterministic constraints:

1. Behavior in Gherkin (human defends; protect-specs is a hard gate)
2. HTTP contract in OpenAPI (human approves breaking changes)
3. Two test streams: unit (HOW) + acceptance (WHAT)
4. Static shape: lint, format, types
5. One pipeline (`verify`) locally and in CI
6. Agent does not rewrite specs to go green
7. spec-sync inventories routes, OpenAPI, `@op` tags, domain vs unit (D1-D8)
8. no-cheat fails skip/only, disabled gates, and lowered coverage floors

See [ADR-spec-sync-drift.md](./ADR-spec-sync-drift.md).

## What the kit proves today

- Cucumber + Playwright (acceptance)
- Vitest + coverage floors (unit)
- OpenAPI contract checks + spec-sync inventory
- no-cheat + protect-specs (hard tools)
- ESLint + Prettier + TypeScript
- AGENTS.md + skills
- CI = the same gates

## Phase 2 / 3 (not wired)

Mutation testing, dependency-cruiser, perf budgets, deps-lock / SBOM, Spec Review AI.

Gherkin leakage is **D8** and is already wired.
