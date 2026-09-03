# AGENTS.md — AI Code Gauntlet

Rules for any AI coding agent working in this repository.
Discipline lives in **gates and tools**, not in prompt politeness.

**protect-specs** and **no-cheat** are hard tools. They fail `npm run verify`.
They are not requests.

## Mission

Ship behavior that is:

1. Specified in human-approved **Gherkin** (`features/**/*.feature`)
2. Contracted in human-approved **OpenAPI** (`openapi/openapi.yaml`)
3. Proven by **two test streams**: unit (Vitest) + acceptance (Cucumber + Playwright)
4. Shaped by **static gates**: TypeScript, ESLint, Prettier, coverage thresholds
5. Kept honest by **spec-sync** (D1–D8), **no-cheat** (D9), and **protect-specs**

You implement. Humans defend the specs.

This template is **lenient**: D3 (operationId without `@op` scenario) **warns**.
D1, D2, D5, D7, D8, D9, and protect-specs still **fail**.
D6 warns when git diffs are unmatched (fail-closed in the Todo example).

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
2. File `.gauntlet/allow-spec-edit` (human-only, gitignored, local)
3. `allowSpecEdit: true` in `gauntlet.config.json` (default **false**; do not flip it)
4. GitHub pull_request label `specs-approved`

On GitHub Actions `pull_request` jobs, `.github/workflows/verify.yml` exports
`ALLOW_SPEC_EDIT=1` **only if** the PR has label `specs-approved`. That is the
CI wiring for grant (4), not a standing override. Unlabeled PRs and pushes to
main stay fail-closed.

If git is unavailable, the gate records info and does not fail. Agents still
must not edit specs.

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

- Do not commit secrets or `.env` files with credentials
- Do not add dependencies unless the human asked in the current turn
- Do not lower coverage floors

If a gate fails because the **spec is wrong**, stop and ask the human.

## What you may change freely

- `src/**` production code
- `tests/unit/**` unit tests
- `e2e/steps/**` and `e2e/support/**` — keep domain language in Gherkin
- Non-breaking OpenAPI additions only with a human protect-specs grant
- `docs/generated/**` only via `npm run docs:generate`

## How to add a new endpoint (SDD)

1. Human writes a Gherkin scenario tagged `@op:<operationId>` (grant protect-specs).
2. Human approves the OpenAPI path, operationId, and schemas.
3. Add a contract case when the operation is HTTP-visible.
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
npm run no-cheat
npm run spec-sync
npm run docs:generate
npm run docs:check
npm run prepare:browsers    # Playwright Chromium, once
```

`npm run verify` order: format, lint, typecheck, protect-specs, no-cheat,
spec-sync, docs, unit+coverage, contract, e2e.

## Coverage

Do not lower thresholds in `vitest.config.ts`.
Floors: lines/functions/statements **80%**, branches **70%** on `src/**`.

## Phase 2 / 3 (not wired)

Mutation (Stryker), architecture (dependency-cruiser), perf budgets, and
deps-lock are **not** implemented. Gherkin leakage is **D8** and is wired.
