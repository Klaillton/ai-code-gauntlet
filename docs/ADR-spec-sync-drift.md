# ADR: Spec-sync drift gates

- **Status:** Accepted
- **Date:** 2026-09-03
- **Context:** AI Code Gauntlet kit (`Klaillton/ai-code-gauntlet`)

## Decision

Treat **inventory-driven spec-sync** as a first-class gauntlet surface, next to
format/lint/types/unit/contract/e2e.

**protect-specs** and **no-cheat** are hard tools, not polite requests.

Humans defend three artifacts:

| Surface         | Artifact                     | Truth                    |
| --------------- | ---------------------------- | ------------------------ |
| Behavior (WHAT) | `features/**/*.feature`      | Gherkin, domain language |
| HTTP            | `openapi/openapi.yaml`       | operationId + schema     |
| Domain HOW      | `src/domain` vs `tests/unit` | unit tests, not E2E      |

HTTP operations are linked to scenarios with Cucumber tags `@op:<operationId>`.

## Strictness

| App                     | Strictness | D3 (operationId without `@op` scenario) | D6                                       |
| ----------------------- | ---------- | --------------------------------------- | ---------------------------------------- |
| `examples/todo`         | `strict`   | **fail**                                | **fail** if git missing or unmatched src |
| `templates/ts-node-web` | `lenient`  | **warn**                                | **warn** if git missing or unmatched src |

Other implemented drifts (D1, D2, D5, D7, D8, D9) fail in both apps.
protect-specs fails in both apps when specs change without a human grant.
Without a usable git checkout (`rev-parse` fails), **protect-specs**, **deps-lock**, and **crap** fail closed (`git required for this gate`) — no soft skip.

## Allowlist

Routes that are not product HTTP must be explicitly allowlisted. Required fields:

- `kind`: `test-harness` | `static-ui` | `internal` | `wip-red`
- `method`, `path`
- `reason`
- `exemptFrom`: `openapi` | `gherkin` | `unit` | `docs`
- `owner`
- `expires`: ISO date (`YYYY-MM-DD`)

Expired entries do not grant exemption. Unknown kinds fail closed.

Todo seed (owner `klaillton`, expires **`2027-06-02`** — renew before that date):

- `POST /api/test/reset` — `test-harness`, exempt `openapi`+`gherkin`, E2E harness (`GAUNTLET_E2E=1`)
- `GET /` — `static-ui`, exempt `openapi`, HTML shell

## Drift catalog (implemented)

| Id                | Rule                                                                                                                                | Default                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **D1**            | Route in `src/api/app.ts` not in OpenAPI                                                                                            | fail unless allowlisted (`exemptFrom: openapi`)                                                                               |
| **D2**            | OpenAPI path+method has no matching route                                                                                           | fail                                                                                                                          |
| **D3**            | `operationId` has no `@op:<operationId>` scenario                                                                                   | fail if `strict`, warn if `lenient`; skip if exempt `gherkin`                                                                 |
| **D5**            | `src/domain` module with no unit test (same-stem or import)                                                                         | fail (unless internal allowlist exempts `unit`)                                                                               |
| **D6**            | Changed `src/api` / `src/domain` without matching spec/unit in git diff                                                             | fail-closed in **strict** (including git missing); warn in **lenient**; empty diff = info                                     |
| **D7**            | Committed `docs/generated/*` does not match a fresh generate                                                                        | fail                                                                                                                          |
| **D8**            | `.feature` steps leak CSS, `data-testid`, or raw HTTP paths                                                                         | fail                                                                                                                          |
| **D9**            | skip/only/pending, disabled gates, lowered coverage floors                                                                          | fail                                                                                                                          |
| **D10**           | Gherkin/OpenAPI in the git diff without `docs/generated` in the same diff                                                           | fail (info if no SDD change)                                                                                                  |
| **D11**           | `@op` with Gherkin but no exclusive scenario-level `@unhappy`/`@edge` (exactly one `@op` on that scenario)                          | **fail** in both strict and lenient                                                                                           |
| **D12**           | `src/**` (implementation) in git diff without holes-review artifact or grant                                                        | **fail**; docs/specs-only diffs skip                                                                                          |
| **D13**           | OpenAPI op (`operationId` or method+path) with zero `contract.cases` entries                                                        | **fail**; skip if OpenAPI absent/disabled; invalid case path/method fails; `caseAllowlist` needs committed config + `expires` |
| **D14**           | New/changed `docs/adr/**` missing Context/Decision/Consequences/Discarded/Status, empty Discarded/Status, bad Status, or ADR delete | **fail**; skip if diff does not touch `docs/adr/**`; Superseded needs existing `ADR-` ref                                     |
| **D15**           | SDD-active app missing/empty `docs/sdd/Security.md` or `Observability.md` (or config paths), or file lacks heading + ≥1 requirement | **fail**; skip if `sdd: false`                                                                                                |
| **protect-specs** | git diff touches features/OpenAPI/`protectedGlobs` without a human grant                                                            | fail; also **fail** if git/`rev-parse` unavailable (`git required for this gate`)                                             |

Scripts:

- `scripts/inventory.ts` — routes, OpenAPI via `js-yaml`, feature tags, domain/unit
- `scripts/spec-sync.ts` — D1-D6, D8, D10, D11, D13; exit 1 on fails
- `scripts/no-cheat.ts` — D9; does **not** scan `scripts/` (self-match)
- `scripts/protect-specs.ts` — spec-edit grant; `GITHUB_BASE_REF` in CI
- `scripts/holes-review.ts` — D12 implementation requires holes-review artifact or grant
- `scripts/adr-lint.ts` — D14 ADR template light gate (diff-based on `docs/adr/**`)
- `scripts/sdd-presence.ts` — D15 Security + Observability presence (heading + ≥1 requirement)
- `scripts/mutation.ts` / `gherkin-mutation.ts` — CHANGE-2 empty surface ≠ 100%
- `scripts/spec-code.ts` — CHANGE-3 DoD spec↔code pairing
- `scripts/deps-lock.ts` — package manifest grant (see ADR-phase2-deps-spec-review.md)
- `scripts/generate-docs.ts` — `docs/generated/{api,behaviors,gauntlet,gaps}.md`
- `scripts/check-docs-fresh.ts` — D7 content compare
- `scripts/verify.ts` — ordered gates + `gauntlet-report.json`; `enabled:false` fails

`scripts/check-openapi.ts` remains the **runtime** contract gate. Spec-sync is static drift.

### protect-specs grants (human-only)

Verify fails if the diff includes protected globs unless one of:

1. `ALLOW_SPEC_EDIT=1` (document in the PR; do **not** bake this into CI as a permanent env)
2. `allowSpecEdit: true` in config (default **false**; committed human config; keep fail-closed)
3. GitHub PR label `specs-approved`

On `pull_request`, `.github/workflows/verify.yml` exports `ALLOW_SPEC_EDIT=1`
**only when** the PR has label `specs-approved`. That is CI wiring for grant
(3), not a standing override. Unlabeled PRs and pushes to main stay fail-closed.

## How to add a new endpoint (SDD)

1. Human writes Gherkin tagged `@op:<operationId>` with **happy + ≥1 `@unhappy`/`@edge`** (scenario-level; D11).
2. Human approves the OpenAPI path, operationId, and schemas (protect-specs grant).
3. Add a contract case when the operation is HTTP-visible.
4. Implement domain, unit tests, and the HTTP adapter.
5. Run `npm run docs:generate` then `npm run verify`.
6. Non-product routes use the typed allowlist (kind, reason, exemptFrom, owner, expires).

Keep selectors and raw paths in step defs, not in feature files (D8).
D11 is inventory of scenario tags — not a prose “edge cases” checklist. Multi-`@op` on one edge/unhappy scenario covers none (explicit fail). Mutation remains separate.

D13 is inventory of OpenAPI ↔ `contract.cases` — not assertion strength. Weak asserts on existing cases remain a residual false-green (mutation/runtime). Ops without a case fail unless covered by a non-expired committed `contract.caseAllowlist` entry (`expires` mandatory; no local allow-file).

## D6 / D7 notes

CI checkout uses `fetch-depth: 0` and fetches `origin/main` so
`origin/main...HEAD` works. Empty diff vs HEAD/main is **info** ("nothing to
check"), not a silent pass of unmatched src. D6 is fail-closed in strict when
git cannot prove the diff.

Generated `gaps.md` does **not** snapshot live D6/D9 text; those findings
appear in `gauntlet-report.json` and CI logs so D7 stays deterministic.

Allowlist seed entries expire **2027-06-02** — renew before that date
(expired entries do not exempt).

## Consequences

- A route needs OpenAPI or an expiry-bounded allowlist.
- Product operations without a tagged scenario fail in the Todo example.
- Operations with Gherkin but no scenario-level `@unhappy`/`@edge` fail in **both** apps (D11).
- Generated docs are a committed, checkable artifact (D7).
- Coverage thresholds and existing gates are unchanged.
- Agents cannot skip tests, disable gates, or edit specs without a human grant.

## Phase 2 / Phase 3 — additional failure modes (roadmap)

### Phase 2 (see ADR-phase2-deps-spec-review.md + ADR-phase2-mutation-complexity.md)

**Wired:**

- **deps-lock** — human grant required for `package.json` / `package-lock.json` edits (root, examples/_, templates/_); CI grant via label `deps-approved` → `ALLOW_DEPS_EDIT=1`
- **spec-review** — `.agent/skills/spec-review.md` devil's-advocate checklist before `implement-feature`; feeds human approval / gaps.md
- **complexity** — cyclomatic max 10 on `src/domain` (`scripts/complexity.ts`); verify gate on template + Todo
- **mutation (custom)** — `scripts/mutation.ts` on **template + Todo** verify (80%; timeouts are not kills)
- **secrets-scan** — credentials / private keys / high-confidence PII; see [ADR-secrets-privacy.md](./ADR-secrets-privacy.md)
- **arch-bound** — `src/domain` must not import HTTP/UI/fs infra; see [ADR-arch-bound.md](./ADR-arch-bound.md)
- **mutation 80%** / **crap ≤ 8** — see [ADR-phase2-mutation-complexity.md](./ADR-phase2-mutation-complexity.md)
- **canonical gates** — [ADR-gates-source.md](./ADR-gates-source.md); domain coverage 90/90/70/90
- **gherkin-mutation** / differential unit mutation — [ADR-gherkin-mutation.md](./ADR-gherkin-mutation.md)

**Not kit gates (conscious substitutes):**

1. **Official Stryker / test-ownership freeze** — custom runner is the mutation gate.
2. **Official dependency-cruiser** — arch-bound is the zero-dep stand-in.

### Phase 3 — cost, supply chain, and ops honesty

3. **Invisible cost / performance** — optional in the **consuming app** when it has a workload; not a default on the health skeleton.
4. **Supply chain** — **wired as CI extras:** SBOM CycloneDX job, gitleaks history, Dependabot. Not local verify gates.

Gherkin leakage is D8 and **is** wired. Phase 2/3 must not weaken D1-D9 or lower coverage floors.

### CHANGE-2 — empty mutation ≠ 100%

When the mutation or gherkin-mutation gate is enabled, zero mutants/sites **fail** with
an “empty mutation surface” finding (score 0, never 100). Escape hatch: committed
`mutation.skipReason` / `gherkinMutation.skipReason` plus `expires` (ISO date).
A PR that does not touch the include set soft-skips (ok, not 100).

### CHANGE-3 — DoD spec↔code

Implementation (`src/**`) in a PR must also touch a protected spec (Gherkin, OpenAPI,
or holes-review) in the **same** PR, or carry a human grant (`SPEC_SYNC_APPROVED=1`,
label `spec-sync-approved`, or committed `allowSpecCodeSkip` / `specCode.approved`).
No local allow-file. Docs-only / spec-only diffs skip.

### Security + Observability presence (D15)

Greenfield / SDD-active apps must ship `docs/sdd/Security.md` and `docs/sdd/Observability.md`
(override with `sdd.securityPath` / `sdd.observabilityPath`). Each file needs a markdown
heading and ≥1 requirement list item (`-` / `*` / `1.`). Adopt installs the same files or fails.
Skip with `sdd: false`. **Residual:** lorem/TODO-only bodies still pass presence — quality is Spec review.

### ADR template (D14)

Canonical template: `docs/adr/TEMPLATE.md`. Required sections: Context, Decision,
Consequences, Discarded (non-empty), Status (`Accepted` or `Superseded by ADR-XXXX` + ISO date).
Diff-based: skip when the PR does not touch `docs/adr/**`. Do not delete ADRs — only mark
Superseded. Residual: generic `Discarded: n/a` passes the light check; quality is human review.

### contract.caseAllowlist (D13)

Temporary exemption for an OpenAPI op that has no `contract.cases` entry yet.
Committed in `gauntlet.config.json` only (no local allow-file). Required fields:

- `operationId` and/or `method`+`path`
- `reason`, `owner`
- `expires` (ISO `YYYY-MM-DD`) — expired entries do not grant

Disable inventory only via `contract.enabled: false` or `contract.casesInventory: false`
(or by omitting OpenAPI). Invalid cases (path/method not in OpenAPI) always fail.

### holes-review grants (human-only) — D12

When the git diff touches implementation globs (default `src/**`):

1. A `docs/holes-review/**/*.md` artifact **in the same diff** with non-empty sections
   `Ambiguities`, `Contradictions`, `Missing AC`, `Unhappy/edge` (headers-only fails), or
2. `HOLES_REVIEW_APPROVED=1`, or
3. `allowHolesReviewSkip: true` / `holesReview.approved: true` in committed config, or
4. PR label `holes-approved` (CI exports `HOLES_REVIEW_APPROVED=1`)

No working-tree allow-file. Artifact paths are in `protectedGlobs` (protect-specs).
Docs/specs-only diffs without `src/` skip D12 (not a false pass for implementation).
