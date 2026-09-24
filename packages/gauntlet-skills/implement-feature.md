# Skill: implement-feature

Use when the human asks to implement a feature that already has (or will have) Gherkin + OpenAPI.

## Inputs required

- Feature name / path under `features/`
- Confirmation that scenarios are human-approved (or draft mode explicitly allowed)
- Whether OpenAPI needs new paths/schemas

## Steps

1. **Read the contract**
   - Open the relevant `.feature` file(s)
   - Open `openapi/openapi.yaml` for HTTP surface
   - Skim existing `src/domain` and related unit tests

2. **Prove red**
   - Run the acceptance scenarios for this feature if possible
   - Add failing unit tests for domain rules first

3. **Implement minimum**
   - Domain first (`src/domain`)
   - API adapter (`src/api`)
   - UI only if scenarios require it
   - Step defs only if new step text was approved (prefer reusing existing steps)

4. **Green loop**
   - `npm run test:unit`
   - `npm run test:contract` (if HTTP touched)
   - `npm run test:e2e`
   - `npm run verify` before claiming done (includes secrets-scan)

5. **Stop conditions**
   - If Gherkin or OpenAPI must change → **reopen-spec** (do not edit SDD
     without a protect-specs grant; then `docs:generate` for D7+D10; D11 needs `@unhappy`/`@edge`; D13 needs a `contract.cases` entry)
   - If Gherkin must change → ask human
   - If OpenAPI breaking change → ask human
   - If secrets-scan fails → stop and ask human (do not invent credentials,
     do not `git add -f .env`, do not add allowlist entries)
   - If still red after 5 focused fix cycles → hand back with failing gate output

## Output to human

- What scenarios now pass
- Files changed
- Any residual risk / flaky notes
- Exact `npm run verify` result

## ADR template (D14)

New ADRs go in `docs/adr/` from `TEMPLATE.md`. Do not delete superseded ADRs — change Status.

## Contract cases (D13)

Every OpenAPI op needs ≥1 `gauntlet.config.json` → `contract.cases` entry. Invalid
path/method fails. Gaps only via committed `contract.caseAllowlist` + `expires`.

## Holes review (D12)

Before implementing `src/**` changes, ensure a human-approved holes-review artifact exists
in `docs/holes-review/` (same PR) with non-empty **Ambiguities**, **Contradictions**,
**Missing AC**, and **Unhappy/edge** — or a human grant (`holes-approved` /
`HOLES_REVIEW_APPROVED=1`). Do not invent AC. Do not create working-tree allow files.
