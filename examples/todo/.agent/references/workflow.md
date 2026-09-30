# Workflow map

```
Human intent
    │
    ▼
Feature + scenarios (Gherkin)     ◄── human approves
    │
    ▼
OpenAPI (if HTTP)                 ◄── human approves contract
    │
    ▼
RED: unit + cucumber/playwright
    │
    ▼
Agent implements (domain → api → ui → step defs)
    │
    ▼
npm run verify
  format → lint → typecheck → complexity → arch-bound → protect-specs → deps-lock
  → holes-review → spec-code → adr-lint → sdd-presence → secrets-scan
  → no-cheat → spec-sync → docs → unit+cov → crap → mutation
  → contract → e2e → gherkin-mutation
    │
    ├─ red → fix-until-green (max 5) → verify
    │
    ▼
Human exploratory spot-check
    │
    ▼
Done / PR
```

Todo and the template both run this order (`gauntlet.config.json`).

## CI

GitHub Actions workflow: `.github/workflows/verify.yml`  
Same gates as local `npm run verify`.

## Pirâmide

- Many unit tests (Vitest)
- Some OpenAPI contract checks
- Few critical UI E2E scenarios (Cucumber + Playwright)
