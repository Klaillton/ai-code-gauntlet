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
   - `npm run verify` before claiming done

5. **Stop conditions**
   - If Gherkin must change → ask human
   - If OpenAPI breaking change → ask human
   - If still red after 5 focused fix cycles → hand back with failing gate output

## Output to human

- What scenarios now pass
- Files changed
- Any residual risk / flaky notes
- Exact `npm run verify` result
