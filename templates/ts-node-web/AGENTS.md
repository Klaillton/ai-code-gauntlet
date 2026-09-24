# AGENTS.md — AI Code Gauntlet

Rules for any AI coding agent working in this repository.
Discipline lives in **gates and tools**, not in prompt politeness.

**protect-specs**, **deps-lock**, **secrets-scan**, **arch-bound**, and **no-cheat**
are hard tools. They fail `npm run verify`. They are not requests.

If a **closed** Gherkin/OpenAPI is wrong: stop, ask, protect-specs grant,
edit SDD, `npm run docs:generate`, commit `docs/generated` in the same change
(**D10**). Skill: `reopen-spec`.

## Mission

Ship behavior that is:

1. Specified in human-approved **Gherkin** (`features/**/*.feature`)
2. Contracted in human-approved **OpenAPI** (`openapi/openapi.yaml`)
3. Proven by **two test streams**: unit (Vitest) + acceptance (Cucumber + Playwright)
4. Shaped by **static gates**: TypeScript, ESLint, Prettier, coverage, complexity
5. Kept honest by **spec-sync** (D1–D8, **D10**, **D11**, **D13**), **no-cheat** (D9), **protect-specs**,
   **deps-lock**, **secrets-scan**, and **arch-bound**

You implement. Humans defend the specs.

This template is **lenient**: D3 (operationId without `@op` scenario) **warns**.
D11 (edge inventory) still **fails** here: every `@op` needs scenario-level `@unhappy`/`@edge`.
D1, D2, D5, D7, D8, D9, protect-specs, deps-lock, secrets-scan, and arch-bound still **fail**.
D6 warns when git diffs are unmatched (fail-closed in the Todo example).
Complexity, mutation, and gherkin-mutation are verify gates. Zero domain
mutants scores 100 (empty/health skeleton).

## Hard prohibitions (enforced)

A prompt “please don’t” is not enough. These fail the gauntlet.

### Specs — protect-specs

Do not edit:

- `features/**/*.feature`
- `openapi/openapi.yaml`
- any path in `agent.protectedGlobs` (`gauntlet.config.json`)

The gate inspects `git diff` for `HEAD`, the index, `origin/main...HEAD`,
`main...HEAD`, and `GITHUB_BASE_REF` when CI sets it.

If those files change, verify **fails** unless a **human grant** exists:

1. `ALLOW_SPEC_EDIT=1` (document why in the PR; do **not** bake this into CI as a permanent env)
2. `allowSpecEdit: true` in `gauntlet.config.json` (default **false**; committed human config; do not flip it)
3. GitHub PR label `specs-approved`

On GitHub Actions `pull_request` jobs, `.github/workflows/verify.yml` exports
`ALLOW_SPEC_EDIT=1` **only if** the PR has label `specs-approved`. That is the
CI wiring for grant (3), not a standing override. Unlabeled PRs and pushes to
main stay fail-closed.

Working-tree `.gauntlet/allow-*` files are **not** grants. If git is unavailable,
protect-specs / deps-lock / crap **fail** (`git required for this gate`).

### Dependencies — deps-lock

Do not edit without a human grant:

- kit root `package.json` / `package-lock.json`
- `examples/*/package.json` / `package-lock.json`
- `templates/*/package.json` / `package-lock.json`

Grants: `ALLOW_DEPS_EDIT=1`, `allowDepsEdit: true` (committed config, default false),
or PR label `deps-approved`. CI exports `ALLOW_DEPS_EDIT=1`
only when the PR has `deps-approved`.

### Holes review — D12 (holes-review)

Implementation without a reviewed holes list invents product decisions. Hard gate.

When the git diff touches `src/**` (configurable), verify **fails** unless:

1. `docs/holes-review/**/*.md` in the **same diff**, with non-empty sections:
   `Ambiguities`, `Contradictions`, `Missing AC`, `Unhappy/edge` (headers-only = fail), or
2. Grant: `HOLES_REVIEW_APPROVED=1`, committed `allowHolesReviewSkip: true`, or PR label `holes-approved`

Artifact paths are protect-specs protected. Docs/specs-only diffs skip D12.

### Contract cases inventory — D13 (spec-sync)

Every OpenAPI operation (`operationId` or method+path) needs ≥1 `contract.cases` entry.
Invalid cases (path/method not in OpenAPI) fail. Temporary gaps: committed
`contract.caseAllowlist` with mandatory `expires` (no local allow-file; expired = fail).
Skip only if OpenAPI is absent or `contract.enabled` / `contract.casesInventory` is false.
Residual: weak asserts on existing cases are out of D13 scope (mutation/runtime).

No `.gauntlet/allow-*` file grant. Config/label grants are **human-only** (agents must not self-apply).

### Secrets & privacy — secrets-scan

Hard tool. Fails verify. Not a request. There is **no** `ALLOW_SECRETS=1`.

Do not:

- Commit `.env`, `.netrc`, or credential files (including `git add -f`). Use
  `.env.example` with placeholders
- Hardcode API keys, tokens, passwords, or private keys
- Log or print secret values in agent tool output / finish messages
- Paste real PII into Gherkin, fixtures, or seed data — use synthetic values
  (`Alice`, `+15550100`, `user@example.com`)
- Add `secretsScan.allowPaths` or `.gauntlet/allow-secrets-paths` to silence
  the gate

Do:

- Read secrets from `process.env` / secret managers
- Keep examples clearly fake (`sk_test_…` in docs is allowed; `sk_live_…` fails)
- If the gate fails on a false positive, **stop and ask the human**

Allowlist never waives `.env` / private-key findings. Agents must not invent
allowlist entries.

### Architecture — arch-bound

Hard tool. Fails verify. `src/domain` must not import HTTP, UI, filesystem, or
test-runner infra (`src/api`, `src/web`, `hono`, `playwright`, `node:fs`, …).

### Cheating — no-cheat / D9

Fails on detect:

- Focus/skip modifiers in tests (`test`/`it`/`describe` + skip or only;
  `xit` / `xdescribe` / `xtest`; Cucumber `pending(`; `@skip`;
  `Scenario (skipped)`)
- Comments that disable coverage thresholds
- Any gauntlet gate with `enabled: false` (mainline verify is fail-closed)
- Coverage floors lowered versus `HEAD` / `origin/main` / `main`
  `vitest.config.ts`

Do not go green by deleting tests. Fix the product or ask the human.

### Other

- Do not add dependencies unless the human asked **and** granted deps-lock
- Do not lower coverage floors

If a gate fails because the **spec is wrong**, stop and ask the human.

## What you may change freely

- `src/**` production code
- `tests/unit/**` unit tests
- `e2e/steps/**` and `e2e/support/**` — keep domain language in Gherkin
- Non-breaking OpenAPI additions only with a human protect-specs grant
- `docs/generated/**` only via `npm run docs:generate`

## How to add a new endpoint (SDD)

0. Run **spec-review** (`.agent/skills/spec-review.md`) — human approval first.
1. Human writes Gherkin tagged `@op:<operationId>` with happy + `@unhappy`/`@edge` (D11; grant protect-specs).
2. Human approves the OpenAPI path, operationId, and schemas.
3. Add a contract case when the operation is HTTP-visible (D13 inventories OpenAPI ↔ cases).
4. Implement domain, unit tests, and the HTTP adapter.
5. Run `npm run docs:generate` then `npm run verify`.
6. Non-product routes use the typed allowlist:
   `kind`, `method`, `path`, `reason`, `exemptFrom`, `owner`, `expires`.
   Kinds: `test-harness` | `static-ui` | `internal` | `wip-red` only.

Keep CSS, `data-testid`, and raw HTTP paths in step defs, not in `.feature`
files (D8).

## Commands

```bash
npm run verify              # FULL gauntlet — required before "done"
npm run protect-specs
npm run deps-lock
npm run secrets-scan
npm run arch-bound
npm run no-cheat
npm run spec-sync
npm run complexity          # domain cyclomatic max 10
npm run crap                # CRAP ≤ 8 on touched src/domain (needs coverage)
npm run test:mutation       # domain kill-score ≥ 80%
npm run gherkin-mutation    # after e2e; example theater fails
npm run docs:generate
npm run docs:check
npm run prepare:browsers    # Playwright Chromium, once
```

`npm run verify` order: format, lint, typecheck, complexity, arch-bound,
protect-specs, deps-lock, secrets-scan, no-cheat, spec-sync, docs, unit+coverage,
crap, mutation, contract, e2e, gherkin-mutation.

## Coverage

Do not lower thresholds in `vitest.config.ts`.
Floors: lines/functions/statements **90%**, branches **70%** on `src/domain`.

## Phase 2 / 3

**Wired:** deps-lock + spec-review; complexity; mutation; gherkin-mutation;
**secrets-scan**; **arch-bound**; **crap**; **D10** (SDD change requires
`docs/generated` in the same diff). D8 gherkin leak is already in spec-sync.

See `docs/ADR-phase2-mutation-complexity.md` and
`docs/ADR-phase2-deps-spec-review.md` in the kit repo.

**Phase 3 CI extras (not local verify):** SBOM, gitleaks.

**Not a kit gate:** official Stryker (custom runner), official
dependency-cruiser (arch-bound), perf/ORM budgets (need a workload).
