# Skill: write-gherkin

Use when drafting or refining Cucumber features **with the human**.

## Rules

- Language of the domain, never framework/DOM/API internals
- One Feature = one capability
- **Slots (hard):** for every `@op:<operationId>`, ship **happy** plus **≥1 unhappy/edge**
- Prefer `data-testid`-agnostic wording; leave selectors to step defs
- Do not invent product decisions — ask

## Tag convention (D11 — fail-closed in spec-sync)

| Tag                 | Meaning                                   | Required                               |
| ------------------- | ----------------------------------------- | -------------------------------------- |
| `@op:<operationId>` | Links scenario to OpenAPI operationId     | Yes for HTTP ops (D3)                  |
| `@happy`            | Primary success path for that op          | Recommended slot marker                |
| `@unhappy`          | Error / rejection / not-found path        | ≥1 of `@unhappy` **or** `@edge` per op |
| `@edge`             | Boundary / empty / unusual-but-valid path | ≥1 of `@unhappy` **or** `@edge` per op |

Tags must sit on the **scenario** (lines immediately above `Scenario:`). Feature-level
`@unhappy` / `@edge` alone do **not** satisfy D11.

An edge/unhappy scenario must carry **exactly one** `@op:<operationId>` at scenario
level. Multi-`@op` on the same edge/unhappy scenario covers **none** and fails D11
explicitly — split into one scenario per op.

spec-sync **fails** if an operationId has Gherkin and zero exclusive scenario-level
`@unhappy` / `@edge` coverage. This is inventory, not prose. Mutation stays a
separate gate (weak asserts / tag theater).

## Template

```gherkin
Feature: <capability>
  As a <role>
  I want <outcome>
  So that <value>

  Background:
    Given <shared precondition>

  @op:<operationId> @happy
  Scenario: <observable success behavior>
    Given ...
    When ...
    Then ...

  @op:<operationId> @unhappy
  Scenario: <observable rejection or failure>
    Given ...
    When ...
    Then ...

  # Or use @edge for a boundary (empty list, max length, idempotent repeat…):
  # @op:<operationId> @edge
  # Scenario: <boundary behavior>
```

## Leakage checklist (reject if present)

- Class names, CSS selectors, React components
- HTTP methods/paths in business scenarios (API-focused scenarios may mention “via the API” but not headers/JSON keys unless essential)
- Database table/column names
- “click the blue button in the navbar”
- Real names + addresses + phones + national IDs (use synthetic data)

## Handoff

Human must explicitly approve before implementation begins.
Mark draft scenarios clearly if not yet approved.
