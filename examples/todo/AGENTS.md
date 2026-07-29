# AGENTS.md — AI Code Gauntlet

Rules for any AI coding agent working in this repository.
Discipline lives in **gates and tools**, not in prompt politeness.

## Mission

Ship behavior that is:

1. Specified in human-approved **Gherkin** (`features/**/*.feature`)
2. Contracted in human-approved **OpenAPI** (`openapi/openapi.yaml`)
3. Proven by **two test streams**: unit (Vitest) + acceptance (Cucumber + Playwright)
4. Shaped by **static gates**: TypeScript, ESLint, Prettier, coverage thresholds

You implement. Humans defend the specs.

## Hard prohibitions

Unless the human **explicitly** grants permission in the current turn:

- **Do not** edit `features/**/*.feature`
- **Do not** edit `openapi/openapi.yaml` in a breaking way (removing fields, changing required, renumbering statuses)
- **Do not** weaken tests to make them pass (delete scenarios, loosen asserts, add `.skip` / `xit` / `test.skip`, raise timeouts to hide flakes)
- **Do not** disable coverage thresholds or ESLint rules to go green
- **Do not** commit secrets or `.env` files with credentials

If a gate fails because the **spec is wrong**, stop and ask the human. Do not silently rewrite the contract.

## What you may change freely

- `src/**` production code
- `tests/unit/**` unit tests
- `e2e/steps/**` and `e2e/support/**` (drivers / page wiring) — keep domain language in Gherkin
- Non-breaking OpenAPI additions only when the human asked for a new endpoint/field
- Docs under `README.md`, `.agent/**` when improving agent guidance

## Workflow (ATDD-style)

For every new or changed behavior:

```
1. Confirm Feature + scenarios exist (or human is writing them)
2. Confirm scenarios FAIL for the new behavior (red)
3. Align OpenAPI if the behavior is HTTP-visible (human approves contract)
4. Write / update failing unit tests for domain rules
5. Implement the minimum code to pass unit + acceptance
6. Run `npm run verify`
7. Fix until green — max 5 verify cycles, then hand back
8. Do not claim done without a green verify in this session
```

### Layer responsibilities

| Layer         | Artifact                    | Owner of truth                     |
| ------------- | --------------------------- | ---------------------------------- |
| Behavior WHAT | `features/*.feature`        | Human                              |
| HTTP contract | `openapi/openapi.yaml`      | Human                              |
| Domain HOW    | `tests/unit` + `src/domain` | Agent (under unit gate)            |
| UI/API driver | `e2e/**` Playwright steps   | Agent (must not leak into Gherkin) |
| Static shape  | ESLint / Prettier / `tsc`   | Config + CI                        |

### Gherkin golden rule

Steps describe **domain outcomes**, not DOM trivia.

- Good: `Then I should see a todo titled "Ship it"`
- Bad: `Then the div.todo-list li:nth-child(1) has class completed`

`data-testid` in the app is allowed for stable automation; keep those details in step defs, not in `.feature` files.

## Commands

```bash
npm run dev                 # local server
npm run test:unit           # Vitest
npm run test:unit:coverage  # Vitest + thresholds
npm run test:contract       # OpenAPI runtime contract checks
npm run test:e2e            # Cucumber + Playwright (starts server)
npm run verify              # FULL gauntlet — required before "done"
npm run agent:loop          # re-run verify (use after fixes; max iterations via MAX_ITERATIONS)
```

`npm run verify` order:

1. Prettier check
2. ESLint
3. `tsc --noEmit`
4. Unit + coverage thresholds
5. OpenAPI contract
6. Cucumber + Playwright E2E

## Coverage

Configured in `vitest.config.ts`. Do not lower thresholds without human approval.
Current floors: lines/functions/statements **80%**, branches **70%** on `src/**` (server bootstrap and static HTML helper excluded).

## E2E notes

- Server is started by `scripts/run-e2e.ts` with `GAUNTLET_E2E=1`
- Reset endpoint `POST /api/test/reset` only works when `GAUNTLET_E2E=1`
- Prefer Chromium; run `npm run prepare:browsers` once locally

## Architecture constraints

- Domain logic lives in `src/domain` — pure, unit-tested, no HTTP
- HTTP adapters live in `src/api`
- UI is intentionally thin (`src/web`) for demo E2E; keep business rules out of the HTML string when possible
- Prefer small functions and early returns
- No god-files: if a module is hard to test, split it

## Definition of done

A change is done only when:

- [ ] Relevant Gherkin scenarios pass (and still express domain language)
- [ ] Unit tests cover new domain rules
- [ ] OpenAPI still validates for touched endpoints
- [ ] `npm run verify` is green
- [ ] No skipped tests introduced
- [ ] Human was asked if any `.feature` or breaking OpenAPI change seemed necessary

## Human checkpoints

Agents must pause for human review when:

- Changing acceptance scenarios
- Breaking or expanding API contracts
- Security, auth, payments, or personal data behavior
- Flaky E2E that “needs” retries/skips
- Max agent fix iterations exhausted

## Phase-2 gates (not wired yet)

When tests start lying, add:

- Mutation testing (e.g. Stryker) on `src/domain`
- Complexity budget / CRAP-like metric per touched module
- Gherkin DRY / leakage checks

Do not pretend these exist today.
