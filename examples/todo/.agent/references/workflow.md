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
npm run verify  ──format──lint──tsc──unit+cov──openapi──e2e──►
    │
    ├─ red → fix-until-green (max 5) → verify
    │
    ▼
Human exploratory spot-check
    │
    ▼
Done / PR
```

## CI

GitHub Actions workflow: `.github/workflows/verify.yml`  
Same gates as local `npm run verify`.

## Pirâmide

- Many unit tests (Vitest)
- Some OpenAPI contract checks
- Few critical UI E2E scenarios (Cucumber + Playwright)
