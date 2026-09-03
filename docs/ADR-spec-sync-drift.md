# ADR: Spec-sync drift gates

- **Status:** Accepted
- **Date:** 2026-09-03
- **Context:** AI Code Gauntlet kit (`Klaillton/ai-code-gauntlet`)

## Decision

Treat **inventory-driven spec-sync** as a first-class gauntlet surface, next to
format/lint/types/unit/contract/e2e.

Humans defend three artifacts:

| Surface | Artifact | Truth |
| --- | --- | --- |
| Behavior (WHAT) | `features/**/*.feature` | Gherkin, domain language |
| HTTP | `openapi/openapi.yaml` | operationId + schema |
| Domain HOW | `src/domain` ↔ `tests/unit` | unit tests, not E2E |

HTTP operations are linked to scenarios with Cucumber tags `@op:<operationId>`.

## Strictness

| App | Strictness | D3 (operationId without `@op` scenario) |
| --- | --- | --- |
| `examples/todo` | `strict` | **fail** |
| `templates/ts-node-web` | `lenient` | **warn** (verify stays green) |

Other implemented drifts (D1, D2, D5, D7, D8) fail in both apps.
D6 is best-effort (warn/info only).

## Allowlist

Routes that are not product HTTP must be explicitly allowlisted. Required fields:

- `kind`: `test-harness` | `static-ui` | `internal` | `wip-red`
- `method`, `path`
- `reason`
- `exemptFrom`: `openapi` | `gherkin` | `unit` | `docs`
- `owner`
- `expires`: ISO date (`YYYY-MM-DD`)

Expired entries do not grant exemption. Unknown kinds fail closed.

Todo seed:

- `POST /api/test/reset` — `test-harness`, exempt `openapi`+`gherkin`, owner `klaillton`, ~90 days, E2E harness (`GAUNTLET_E2E=1`)
- `GET /` — `static-ui`, exempt `openapi`, owner `klaillton`, ~90 days, HTML shell

## Drift catalog (implemented)

| Id | Rule | Default |
| --- | --- | --- |
| **D1** | Route in `src/api/app.ts` not in OpenAPI | fail unless allowlisted (`exemptFrom: openapi`) |
| **D2** | OpenAPI path+method has no matching route | fail |
| **D3** | `operationId` has no `@op:<operationId>` scenario | fail if `strict`, warn if `lenient`; skip if exempt `gherkin` |
| **D5** | `src/domain` module with no unit test (same-stem or import) | fail (unless internal allowlist exempts `unit`) |
| **D6** | Changed `src/api` / `src/domain` without matching spec/unit in git diff | best-effort warn; skip + document if git is unavailable |
| **D7** | Committed `docs/generated/*` does not match a fresh generate | fail |
| **D8** | `.feature` steps leak CSS, `data-testid`, or raw HTTP paths | fail |

Scripts:

- `scripts/inventory.ts` — routes (regex on `app.get/post/...`), OpenAPI via `js-yaml`, feature tags, domain/unit
- `scripts/spec-sync.ts` — D1–D5, D8, optional D6; exit 1 on fails
- `scripts/generate-docs.ts` — `docs/generated/{api,behaviors,gauntlet,gaps}.md`
- `scripts/check-docs-fresh.ts` — D7 content compare
- `scripts/verify.ts` — ordered gates + `gauntlet-report.json`

`scripts/check-openapi.ts` remains the **runtime** contract gate. Spec-sync is static drift, not a replacement.

## How to add a new endpoint (SDD)

1. Human writes a Gherkin scenario tagged `@op:<operationId>` in domain language.
2. Human approves the OpenAPI path, operationId, and schemas.
3. Add a contract case when the operation is HTTP-visible.
4. Implement domain, unit tests, and the HTTP adapter.
5. Run `npm run docs:generate` then `npm run verify`.
6. Non-product routes use the typed allowlist (kind, reason, exemptFrom, owner, expires).

Keep selectors and raw paths in step defs, not in feature files (D8).

## D6 follow-up

D6 is best-effort at verify time. If git diff is available, unmatched `src/api` or
`src/domain` changes warn. If git is missing, spec-sync records an info finding.
A later change can harden D6 on `origin/main...HEAD` per app path.

Generated `docs/generated/gaps.md` does **not** snapshot live D6 text, so D7 stays
deterministic across machines with and without git.

## Consequences

- A route needs OpenAPI or an expiry-bounded allowlist.
- Product operations without a tagged scenario fail in the Todo example.
- Generated docs are a committed, checkable artifact (D7).
- Coverage thresholds and existing gates are unchanged.

## Phase 2 / Phase 3 — additional failure modes (roadmap)

These are **not** implemented in this change. They are the next constraints after
inventory/spec-sync is green.

### Phase 2 — semantic honesty of tests and structure

1. **Test invalidation / false positives**
   - Problem: tests that pass without proving behavior (weak asserts, frozen snapshots,
     tests owned by the same change that implements the code).
   - Direction: freeze / test-ownership phases (human or specifier owns the red test);
     then mutation testing (Stryker on `src/domain`) as a gauntlet gate. Survivors must
     die before merge.
   - Out of scope here: no Stryker config, no coverage-threshold changes.

2. **Architectural drift**
   - Problem: domain starts importing HTTP adapters, UI, or persistence.
   - Direction: dependency-cruiser (or equivalent) arch rules: `src/domain` must not
     import `src/api`, `src/web`, or infra. Optional Design Specs for allowed patterns
     (ports/adapters).
   - Out of scope here.

3. **Spec gaps (devil's advocate)**
   - Problem: Gherkin/OpenAPI can be internally consistent and still miss abuse cases,
     empty states, or auth.
   - Direction: a Spec Review AI step *before coding* — challenge scenarios, propose
     missing `@op` cases, require human accept/reject. Complements D3 (link coverage)
     rather than replacing it.
   - Out of scope here.

### Phase 3 — cost, supply chain, and ops honesty

4. **Invisible cost / performance**
   - Problem: green verify with unbounded queries, N+1, or unbounded payloads.
   - Direction: benchmark budgets on critical paths; later ORM/SQL static checks.
     Fail the gauntlet when a budget regresses.
   - Out of scope here.

5. **Hallucinated deps / supply chain**
   - Problem: the coding agent adds packages (or the wrong packages) to go green.
   - Direction: `package.json` / lockfile changes require human approval; SBOM plus
     Dependabot/Snyk in CI. Agents must not add dependencies unless the human asked
     in the current turn.
   - Partial today: AGENTS.md already forbids secrets; make the package.json rule an
     explicit future gate.

Phase 2/3 must not weaken D1–D8 or lower coverage floors.
