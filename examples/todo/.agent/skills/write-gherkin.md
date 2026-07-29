# Skill: write-gherkin

Use when drafting or refining Cucumber features **with the human**.

## Rules

- Language of the domain, never framework/DOM/API internals
- One Feature = one capability
- Scenarios: happy path, edge, error, security (as relevant)
- Prefer `data-testid`-agnostic wording; leave selectors to step defs
- Do not invent product decisions — ask

## Template

```gherkin
Feature: <capability>
  As a <role>
  I want <outcome>
  So that <value>

  Background:
    Given <shared precondition>

  Scenario: <observable behavior>
    Given ...
    When ...
    Then ...
```

## Leakage checklist (reject if present)

- Class names, CSS selectors, React components
- HTTP methods/paths in business scenarios (API-focused scenarios may mention “via the API” but not headers/JSON keys unless essential)
- Database table/column names
- “click the blue button in the navbar”

## Handoff

Human must explicitly approve before implementation begins.
Mark draft scenarios clearly if not yet approved.
