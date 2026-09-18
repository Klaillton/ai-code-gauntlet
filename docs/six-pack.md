# Six-pack playbook (not a gate)

Uncle Bob’s six roles, mapped onto **existing** skills. This is orchestration
guidance for humans, not a swarm that can bypass verify.

| Role | This kit |
|------|----------|
| Specifier | `write-gherkin` + `spec-review` (human approves Gherkin/OpenAPI) |
| Coder | `implement-feature` |
| Cleaner | `fix-until-green` (no new behavior) |
| Architect | `arch-bound` + complexity/CRAP gates |
| Hardener | protect-specs, deps-lock, secrets-scan, mutation, gherkin-mutation |
| QA | `qa-procedures` skill (human UI spot-check) |

Do **not** spawn six agents that share one verify. The gates stay fail-closed
in a single `npm run verify`. Multi-agent fan-out is out of scope until a
second domain exists (Acceptance IR).
