# Skill: reopen-spec

Use when **implementation, a failing gate, or a human** shows that a spec
already closed (Gherkin / OpenAPI) is wrong. The agent must **not** silently
reshape the product around a stale SDD, and must **not** edit specs without a
protect-specs grant.

## Detect

These already fail `npm run verify` when a closed phase is wrong:

| Signal                                    | Meaning                                                   |
| ----------------------------------------- | --------------------------------------------------------- |
| e2e / contract red, code matches the spec | Spec may be wrong — stop                                  |
| D6 src changed without specs/tests        | You are inventing behavior                                |
| D1–D3/D5/D8 spec-sync                     | Code and SDD drifted                                      |
| gherkin-mutation survivor                 | Example does not pin behavior                             |
| protect-specs red                         | You tried to edit SDD without a grant                     |
| **D10**                                   | SDD changed but `docs/generated` was not in the same diff |
| D7                                        | Generated docs stale vs current inventory                 |

## Correct

1. **Stop coding.** Do not weaken tests or skip gates.
2. **Ask the human** (AGENTS.md checkpoint: Gherkin/OpenAPI/product).
3. Human grants protect-specs (`ALLOW_SPEC_EDIT=1`, `.gauntlet/allow-spec-edit`,
   or PR label `specs-approved`).
4. Run **spec-review**, then edit `features/**` and/or `openapi/openapi.yaml`.
5. `npm run docs:generate` — D7 + **D10** require generated docs in the **same
   change set** as the SDD.
6. `npm run spec-sync` and `npm run verify` until green.
7. Only then implement.

## Do not

- Edit `.feature` / OpenAPI to make a buggy UI “correct”
- Leave generated docs for a follow-up PR
- Invent product copy or new operations without the human
