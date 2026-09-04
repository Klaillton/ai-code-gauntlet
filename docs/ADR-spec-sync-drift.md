# ADR: Spec-sync drift gates

- **Status:** Accepted
- **Date:** 2026-09-03
- **Context:** AI Code Gauntlet kit (`Klaillton/ai-code-gauntlet`)

## Decision

Treat **inventory-driven spec-sync** as a first-class gauntlet surface, next to
format/lint/types/unit/contract/e2e.

**protect-specs** and **no-cheat** are hard tools, not polite requests.

Humans defend three artifacts:

| Surface | Artifact | Truth |
| --- | --- | --- |
| Behavior (WHAT) | `features/**/*.feature` | Gherkin, domain language |
| HTTP | `openapi/openapi.yaml` | operationId + schema |
| Domain HOW | `src/domain` vs `tests/unit` | unit tests, not E2E |

HTTP operations are linked to scenarios with Cucumber tags `@op:<operationId>`.

## Strictness

| App | Strictness | D3 (operationId without `@op` scenario) | D6 |
| --- | --- | --- | --- |
| `examples/todo` | `strict` | **fail** | **fail** if git missing or unmatched src |
| `templates/ts-node-web` | `lenient` | **warn** | **warn** if git missing or unmatched src |

Other implemented drifts (D1, D2, D5, D7, D8, D9) fail in both apps.
protect-specs fails in both apps when specs change without a human grant.

## Allowlist

Routes that are not product HTTP must be explicitly allowlisted. Required fields:

- `kind`: `test-harness` | `static-ui` | `internal` | `wip-red`
- `method`, `path`
- `reason`
- `exemptFrom`: `openapi` | `gherkin` | `unit` | `docs`
- `owner`
- `expires`: ISO date (`YYYY-MM-DD`)

Expired entries do not grant exemption. Unknown kinds fail closed.

Todo seed (owner `klaillton`, expires **`2026-12-02`** — renew before that date):

- `POST /api/test/reset` — `test-harness`, exempt `openapi`+`gherkin`, E2E harness (`GAUNTLET_E2E=1`)
- `GET /` — `static-ui`, exempt `openapi`, HTML shell

## Drift catalog (implemented)

| Id | Rule | Default |
| --- | --- | --- |
| **D1** | Route in `src/api/app.ts` not in OpenAPI | fail unless allowlisted (`exemptFrom: openapi`) |
| **D2** | OpenAPI path+method has no matching route | fail |
| **D3** | `operationId` has no `@op:<operationId>` scenario | fail if `strict`, warn if `lenient`; skip if exempt `gherkin` |
| **D5** | `src/domain` module with no unit test (same-stem or import) | fail (unless internal allowlist exempts `unit`) |
| **D6** | Changed `src/api` / `src/domain` without matching spec/unit in git diff | fail-closed in **strict** (including git missing); warn in **lenient**; empty diff = info |
| **D7** | Committed `docs/generated/*` does not match a fresh generate | fail |
| **D8** | `.feature` steps leak CSS, `data-testid`, or raw HTTP paths | fail |
| **D9** | skip/only/pending, disabled gates, lowered coverage floors | fail |
| **protect-specs** | git diff touches features/OpenAPI/`protectedGlobs` without a human grant | fail (info if git unavailable) |

Scripts:

- `scripts/inventory.ts` — routes, OpenAPI via `js-yaml`, feature tags, domain/unit
- `scripts/spec-sync.ts` — D1-D6, D8; exit 1 on fails
- `scripts/no-cheat.ts` — D9; does **not** scan `scripts/` (self-match)
- `scripts/protect-specs.ts` — spec-edit grant; `GITHUB_BASE_REF` in CI
- `scripts/deps-lock.ts` — package manifest grant (see ADR-phase2-deps-spec-review.md)
- `scripts/generate-docs.ts` — `docs/generated/{api,behaviors,gauntlet,gaps}.md`
- `scripts/check-docs-fresh.ts` — D7 content compare
- `scripts/verify.ts` — ordered gates + `gauntlet-report.json`; `enabled:false` fails

`scripts/check-openapi.ts` remains the **runtime** contract gate. Spec-sync is static drift.

### protect-specs grants (human-only)

Verify fails if the diff includes protected globs unless one of:

1. `ALLOW_SPEC_EDIT=1` (document in the PR; do **not** bake this into CI as a permanent env)
2. `.gauntlet/allow-spec-edit` (gitignored, local, human-only)
3. `allowSpecEdit: true` in config (default **false**; keep fail-closed)
4. GitHub PR label `specs-approved`

On `pull_request`, `.github/workflows/verify.yml` exports `ALLOW_SPEC_EDIT=1`
**only when** the PR has label `specs-approved`. That is CI wiring for grant
(4), not a standing override. Unlabeled PRs and pushes to main stay fail-closed.

## How to add a new endpoint (SDD)

1. Human writes a Gherkin scenario tagged `@op:<operationId>` in domain language.
2. Human approves the OpenAPI path, operationId, and schemas (protect-specs grant).
3. Add a contract case when the operation is HTTP-visible.
4. Implement domain, unit tests, and the HTTP adapter.
5. Run `npm run docs:generate` then `npm run verify`.
6. Non-product routes use the typed allowlist (kind, reason, exemptFrom, owner, expires).

Keep selectors and raw paths in step defs, not in feature files (D8).

## D6 / D7 notes

CI checkout uses `fetch-depth: 0` and fetches `origin/main` so
`origin/main...HEAD` works. Empty diff vs HEAD/main is **info** ("nothing to
check"), not a silent pass of unmatched src. D6 is fail-closed in strict when
git cannot prove the diff.

Generated `gaps.md` does **not** snapshot live D6/D9 text; those findings
appear in `gauntlet-report.json` and CI logs so D7 stays deterministic.

Allowlist seed entries expire **2026-12-02** — renew before that date
(expired entries do not exempt).

## Consequences

- A route needs OpenAPI or an expiry-bounded allowlist.
- Product operations without a tagged scenario fail in the Todo example.
- Generated docs are a committed, checkable artifact (D7).
- Coverage thresholds and existing gates are unchanged.
- Agents cannot skip tests, disable gates, or edit specs without a human grant.

## Phase 2 / Phase 3 — additional failure modes

Mutation + complexity are wired. See
[ADR-phase2-mutation-complexity.md](./ADR-phase2-mutation-complexity.md).
Gherkin leakage is D8 and **is** wired (`checkD8` in spec-sync).

### Phase 2 — semantic honesty of tests and structure

1. **deps-lock** — human grant required for `package.json` / `package-lock.json`
   edits (root, examples/*, templates/*); CI grant via label
   `deps-approved` -> `ALLOW_DEPS_EDIT=1`.
2. **spec-review** — `.agent/skills/spec-review.md` devil's-advocate checklist
   before `implement-feature`; feeds human approval / gaps.md.
3. **Test invalidation** — mutation gate on `src/domain` (Todo gate enabled;
   template script stays opt-in). Initial kill-score floor **60%** (TODO: raise).
4. **Complexity budget** — cyclomatic max **10** per domain function (both apps).
   CRAP <= 8 needs a coverage combo; later.
5. **Architectural drift** — dependency-cruiser: `src/domain` must not import
   `src/api` / infra. Still roadmap.

### Phase 3 — cost, supply chain, and ops honesty

6. **Invisible cost / performance** — benchmark budgets; later ORM/SQL checks.
7. **Supply chain beyond deps-lock** — SBOM; Dependabot/Snyk.

Phase 2/3 must not weaken D1-D9 or lower coverage floors.
