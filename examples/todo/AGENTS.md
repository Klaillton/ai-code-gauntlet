# AGENTS.md — AI Code Gauntlet

Rules for any AI coding agent working in this repository.
Discipline lives in **gates and tools**, not in prompt politeness.

**protect-specs**, **deps-lock**, **secrets-scan**, **arch-bound**, and
**no-cheat** are hard tools. They fail `npm run verify`. They are not requests.

### Reopening a closed spec (SDD)

If a gate or the human shows a **closed** Gherkin/OpenAPI is wrong: stop,
ask, get a protect-specs grant, edit the SDD, run `npm run docs:generate`,
commit `docs/generated` **in the same change** (**D10**), then implement.
See skill `reopen-spec`. Do not patch production to match a stale spec.

## Mission

Ship behavior that is:

1. Specified in human-approved **Gherkin** (`features/**/*.feature`)
2. Contracted in human-approved **OpenAPI** (`openapi/openapi.yaml`)
3. Proven by **two test streams**: unit (Vitest) + acceptance (Cucumber + Playwright)
4. Shaped by **static gates**: TypeScript, ESLint, Prettier, coverage, complexity
5. Kept honest by **spec-sync** (D1–D8, **D10**, **D11**), **no-cheat** (D9), **protect-specs**,
   **deps-lock**, **secrets-scan**, and **arch-bound**

You implement. Humans defend the specs and dependency manifests.

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
must not edit specs. On a full-tree local verify with no diff, the same rule
applies: do not touch those paths.

### Dependencies — deps-lock

Do not edit without a human grant:

- kit root `package.json` / `package-lock.json`
- `examples/*/package.json` / `package-lock.json`
- `templates/*/package.json` / `package-lock.json`

Same git-diff surfaces as protect-specs. Grants:

1. `ALLOW_DEPS_EDIT=1` (document in the PR; do **not** bake into CI permanently)
2. `.gauntlet/allow-deps-edit` (human-only, gitignored, local)
3. `allowDepsEdit: true` in `gauntlet.config.json` (default **false**)
4. GitHub pull_request label `deps-approved`

CI exports `ALLOW_DEPS_EDIT=1` **only if** the PR has label `deps-approved`.

### Secrets & privacy — secrets-scan

Hard tool. Fails verify. Not a request. There is **no** `ALLOW_SECRETS=1`.

Do not:

- Commit `.env`, `.netrc`, or credential files (including `git add -f`). Use
  `.env.example` with placeholders
- Hardcode API keys, tokens, passwords, or private keys in `src/**`, tests,
  docs, or scripts
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

Keep domain pure. Adapters live outside `src/domain`.

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
Do not silently rewrite the contract.

## What you may change freely

- `src/**` production code
- `tests/unit/**` unit tests
- `e2e/steps/**` and `e2e/support/**` (drivers) — keep domain language in Gherkin
- Non-breaking OpenAPI additions only when the human asked for a new endpoint
  **and** granted protect-specs
- `docs/generated/**` only via `npm run docs:generate`
- Docs under `README.md`, `.agent/**` when improving agent guidance

## How to add a new endpoint (SDD)

0. Run **spec-review** (`.agent/skills/spec-review.md`) — devil's advocate;
   get human approval before coding.
1. Human writes Gherkin tagged `@op:<operationId>` with happy + `@unhappy`/`@edge` (D11; grant protect-specs).
2. Human approves the OpenAPI path, operationId, and schemas.
3. Add a contract case when the operation is HTTP-visible.
4. Implement domain, unit tests, and the HTTP adapter.
5. Run `npm run docs:generate` then `npm run verify`.
6. Non-product routes use the typed allowlist:
   `kind`, `method`, `path`, `reason`, `exemptFrom`, `owner`, `expires`.
   Kinds: `test-harness` | `static-ui` | `internal` | `wip-red` only.

Keep CSS, `data-testid`, and raw HTTP paths in step defs, not in `.feature`
files (D8).

## Workflow (ATDD-style)

```
1. For new behavior: run spec-review → human approval (gaps / edges / security)
2. Confirm Feature + scenarios exist (or human is writing them)
3. Confirm scenarios FAIL for the new behavior (red)
4. Align OpenAPI if HTTP-visible (human approves + protect-specs grant)
5. Write / update failing unit tests for domain rules
6. Implement the minimum code to pass unit + acceptance
7. npm run docs:generate && npm run verify
8. Fix until green — max 5 verify cycles, then hand back
9. Do not claim done without a green verify in this session
```

Do **not** start `implement-feature` until spec-review is approved when the
change introduces new behavior.

### Layer responsibilities

| Layer         | Artifact                    | Owner of truth                     |
| ------------- | --------------------------- | ---------------------------------- |
| Behavior WHAT | `features/*.feature`        | Human                              |
| HTTP contract | `openapi/openapi.yaml`      | Human                              |
| Dependencies  | `package.json` / lockfile   | Human (deps-lock)                  |
| Domain HOW    | `tests/unit` + `src/domain` | Agent (under unit + D5/D6)         |
| UI/API driver | `e2e/**` Playwright steps   | Agent (must not leak into Gherkin) |
| Static shape  | ESLint / Prettier / `tsc`   | Config + CI                        |

### Gherkin golden rule

Steps describe **domain outcomes**, not DOM trivia.

- Good: `Then I should see a todo titled "Ship it"`
- Bad: `Then the div.todo-list li:nth-child(1) has class completed`

`data-testid` in the app is allowed for stable automation; keep those details
in step defs, not in `.feature` files.

## Commands

```bash
npm run dev                 # local server
npm run test:unit           # Vitest
npm run test:unit:coverage  # Vitest + thresholds
npm run test:contract       # OpenAPI runtime contract checks
npm run test:e2e            # Cucumber + Playwright (starts server)
npm run complexity          # domain cyclomatic max 10
npm run arch-bound          # domain must not import HTTP/UI/fs infra
npm run crap                # CRAP ≤ 8 on touched src/domain (needs coverage)
npm run test:mutation       # mutation kill-score ≥ 80% (in Todo verify)
npm run gherkin-mutation    # mutate Gherkin examples; e2e must still fail them
npm run protect-specs       # fail if specs changed without a human grant
npm run deps-lock           # fail if package manifests changed without a grant
npm run secrets-scan        # fail on credentials, private keys, high-confidence PII
npm run no-cheat            # fail on skip/only, disabled gates, lowered floors
npm run spec-sync           # D1–D8 + D10–D11 inventory drift
npm run docs:generate       # write docs/generated/*
npm run docs:check          # D7 freshness
npm run verify              # FULL gauntlet — required before "done"
npm run agent:loop          # re-run verify (max iterations via MAX_ITERATIONS)
```

`npm run verify` order:

1. Prettier check
2. ESLint
3. `tsc --noEmit`
4. complexity
5. arch-bound
6. protect-specs
7. deps-lock
8. secrets-scan
9. no-cheat
10. spec-sync
11. docs (D7)
12. Unit + coverage thresholds
13. crap (touched domain)
14. mutation
15. OpenAPI contract (`check-openapi.ts`)
16. Cucumber + Playwright E2E
17. gherkin-mutation

Root `npm run verify` runs the template then the example. Install browsers
with `npm run prepare:browsers` first.

## Coverage

Configured in `vitest.config.ts`. Do not lower thresholds.
Current floors: lines/functions/statements **90%**, branches **70%** on `src/domain`
(server bootstrap and static HTML helper excluded).

## E2E notes

- Server is started by `scripts/run-e2e.ts` with `GAUNTLET_E2E=1`
- Reset endpoint `POST /api/test/reset` only works when `GAUNTLET_E2E=1`
- Prefer Chromium; run `npm run prepare:browsers` once locally

## Architecture constraints

- Domain logic lives in `src/domain` — pure, unit-tested, no HTTP
- HTTP adapters live in `src/api`
- UI is intentionally thin (`src/web`); keep business rules out of HTML
- Prefer small functions and early returns
- No god-files: if a module is hard to test, split it

## Definition of done

A change is done only when:

- [ ] Spec-review completed (new behavior) and human approved
- [ ] Relevant Gherkin scenarios pass (domain language)
- [ ] Unit tests cover new domain rules
- [ ] OpenAPI still validates for touched endpoints
- [ ] `npm run verify` is green (protect-specs, deps-lock, secrets-scan, arch-bound, crap, gherkin-mutation, no-cheat, spec-sync, D7)
- [ ] No skipped or focused tests introduced
- [ ] Human granted protect-specs if any `.feature` or OpenAPI change was required
- [ ] Human granted deps-lock if any package.json / lockfile change was required

## Human checkpoints

Agents must pause for human review when:

- Changing acceptance scenarios or OpenAPI (needs a protect-specs grant)
- Changing dependencies / lockfiles (needs a deps-lock grant)
- Security, auth, payments, or personal data behavior
- secrets-scan fails (false positive or real leak — ask; do not allowlist)
- Flaky E2E that “needs” retries or skipped tests
- Max agent fix iterations exhausted
- Spec-review found gaps that need product decisions

## Phase 2 / Phase 3

**Phase 2 is wired on the kit** (template + Todo): deps-lock, spec-review,
complexity, mutation (80%, timeouts are not kills), gherkin-mutation, crap,
secrets-scan, arch-bound, D8, D10. See kit `docs/plan.md`.

**Phase 3 extras in CI (not local verify):** SBOM CycloneDX, gitleaks history.

**Not a kit gate (substitutes we already have, or not generic):** official
Stryker (custom runner is the gate), official dependency-cruiser (arch-bound),
perf/ORM budgets (need a workload), test-ownership freeze.
