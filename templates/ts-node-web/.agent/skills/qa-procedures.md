# Skill: qa-procedures

Use **after** `npm run verify` is green, before claiming a user-visible change
is done. This is a **human** spot-check, not a substitute for e2e or
gherkin-mutation.

## Do

1. Open the app (`npm run dev`) as a person, not via Playwright.
2. Pick **2–3** scenarios from `features/*.feature` that you touched.
3. Follow Given/When/Then in domain language (titles, not CSS).
4. Check one unhappy path (empty title, 404, disabled action).
5. Note anything the specs never mentioned (layout, copy, focus).

## Stop and ask the human if

- The UI contradicts a Then that still passes in CI
- You need a new scenario (then spec-review + protect-specs grant)
- Auth, payments, or personal data is involved

## Do not

- Skip this because e2e is green
- Edit `.feature` files to match a buggy UI
- Invent product copy
