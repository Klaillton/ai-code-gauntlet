# ADR: gherkin-mutation + differential unit mutation

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** [ADR-phase2-mutation-complexity.md](./ADR-phase2-mutation-complexity.md)

## Decision

### Differential unit mutation

On a PR (git divergence from main) only mutate `src/domain` files in the diff.
Main push or a clean tree still mutates the **whole** include set (fail-closed).
A PR that does not touch domain skips domain mutants (score 100, info).

### Gherkin-level mutation

`scripts/gherkin-mutation.ts` mutates quoted Then/And examples and HTTP-status
integers in `features/**/*.feature`. If cucumber still passes, the scenario did
not pin that value.

- Kill score floor **80%**, cap **12** sites, timeout 120s per run.
- Template and Todo verify: **after e2e**. Empty/health domain scores 100 on
  unit mutation when there are no sites.
- Findings do not echo the mutated example text in the console summary beyond
  operator + location (the JSON report keeps original/replacement like unit
  mutation).

### Still deferred

- Official Stryker (lockfile + overlapping operators)
- Acceptance IR / step-def generator
- Multi-agent six-pack swarm (playbook only: [six-pack.md](./six-pack.md))
