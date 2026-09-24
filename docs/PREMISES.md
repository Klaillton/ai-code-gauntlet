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
- Mutation + gherkin-mutation on the **template** (the kit product) and Todo;
  differential on PRs; timeouts are not kills
- **D10**: Gherkin/OpenAPI in a diff requires `docs/generated` in the same diff
- **D11**: every `@op` with Gherkin needs ≥1 scenario-level `@unhappy`/`@edge` (fail in both apps)
- **D12**: implementation (`src/**`) in a diff requires holes-review artifact or human grant
- **D13**: every OpenAPI op needs ≥1 `contract.cases` entry (invalid cases fail; `caseAllowlist` + expires)
- ESLint + Prettier + TypeScript
- AGENTS.md + skills
- CI = the same gates

## Phase 2 / 3

Phase 2 honesty gates are **wired** on the template (the product) and Todo.
Phase 3 supply-chain extras (SBOM, gitleaks) are **CI jobs**, not local verify.

Not kit gates: official Stryker (custom runner), official dependency-cruiser
(arch-bound), perf/ORM budgets (need a real workload in the consuming app).
Another stack (Java/Spring) is `adopt` in **that** repo, not this kit.

Gherkin leakage is **D8** and is already wired.
