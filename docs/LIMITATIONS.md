# What the gauntlet does NOT catch (D17a)

A green `npm run verify` means every configured gate passed. It does not mean the code is
correct, safe or reviewed. This page lists the known false-greens: changes that pass today.
Each entry says what passes, why, and whether a fix is planned. Facts are as of `main` on
2026-11-20; when a gate closes an entry, the PR that closes it updates this page.

## Scope in numbers

| What                            | npm stack (template, Todo)                                                  | Maven stack (ADD-POLY S1)               |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Gates in `gates[]`              | 21                                                                          | 7 L0 gates + reactor test run           |
| Built-in steps before `gates[]` | 3 (`policy-base`, `stack`, `l0-config`)                                     | 3 (`policy-base`, `stack`, `l0-config`) |
| Coverage floor                  | 90 lines / 90 functions / 70 branches / 90 statements, `src/domain/**` only | none (JaCoCo is S2)                     |
| Mutation                        | `src/domain` only, threshold 80, core operator set (not Stryker)            | none (PIT is S3)                        |
| Contract (`openapi-diff`, D13)  | yes                                                                         | none (S4)                               |
| Strictness                      | Todo `strict`; template `lenient` (D3 is a warning)                         | n/a                                     |
| Gradle                          | n/a                                                                         | not implemented; `stack: gradle` fails  |

## Human grants and enforcement

1. **A grant label is not proof of a human.** `policy-change-approved`, `deps-approved`,
   `specs-approved`, `holes-approved` and `spec-sync-approved` grant on their own today. The
   agents' GitHub App, or any agent that holds the owner's shared token, can add them. Planned:
   app-identity-2 (grant = APPROVED review by the repo OWNER on the exact head SHA; reviews from a login
   whose token is shared with agents fail as `human-unattributed`).
   Residual of that plan: while the `Klaillton` token is shared with agents, whoever holds it can
   set the Actions variable `GAUNTLET_SHARED_TOKEN_LOGINS` to `none` and make that login's
   reviews count. The mitigation is the order: Dante revokes the token first, then changes the
   variable himself. The variable is mandatory: missing or empty fails every grant closed
   (`GAUNTLET_SHARED_TOKEN_LOGINS por definir (fail closed)`); only an explicit `none` means an
   empty list.
2. **A grant does not prove the human read the diff.** Even with app-identity-2, the gate proves
   that someone approved, not that the approval was careful.
3. **The base-run `policy-base` job only blocks when it is required.** If the ruleset does not
   make it a required status (or an admin bypasses the ruleset), a red `policy-base` does not
   stop the merge. The same applies to a consumer's `policy-base.yml`.

## Agent instructions and CI configuration

4. **Agent instruction files are not protected.** `AGENTS.md`, `CLAUDE.md`, `.cursor/**` and
   `.claude/**` can be rewritten in a PR without any grant, so an agent can change its own
   rules. Only repo-root `.github/**` is protected. Planned: an explicit, protected list of
   instruction files.
5. **Workflow permissions have no semantic diff.** Any `.github/**` change needs
   `policy-change-approved`, but nothing flags a permission escalation inside it (a `write`
   scope, `pull_request_target`, `persist-credentials: true`, or a deleted `permissions:` block
   that falls back to the repo default). The approver has to spot it. Planned.

## Tests and measurement

6. **Deleting tests to go green is not caught.** No gate compares the number of tests with the
   base. Removing a failing test (or a whole file) passes as long as coverage floors and
   mutation still hold. Planned: measurement on the base SHA with `test-count-delta`.
7. **Coverage and mutation only look at `src/domain/**`.** Code outside it (routes, adapters,
   `src/api/**`) can ship without tests.
8. **Mutation uses a reduced operator set.** No string, optional-chaining or statement-removal
   mutants; surviving logic of those kinds is not detected.
9. **`no-cheat` (D9) is pattern-based.** It catches `.skip` / `.only` / `xit` / `xdescribe` /
   `xtest` / `pending(` and coverage-threshold disabling. It does not catch tests that assert
   nothing useful, hard-coded expected values, monkeypatched `Date` / `Math.random`, or code
   that special-cases the test input. D16 (cheat detection) is not merged.
10. **D13 counts contract cases, not their strength.** Every OpenAPI operation needs at least one
    `contract.cases` entry; a weak assertion on an existing case passes.

## Specs and documentation

11. **Presence is not truth.** D15 (`sdd-presence`) passes with a heading and one requirement,
    even if the text is lorem or TODO. D14 (`adr-lint`) passes with `Discarded: n/a`. A
    plausible but wrong spec or ADR is a human-review problem.
12. **D11 is a tag inventory.** An `@op` with one `@unhappy`/`@edge` scenario passes; it does not
    check that the edge cases that matter are covered.
13. **`docs` only checks generated docs are fresh.** README and hand-written docs are not checked
    against the code.

## Secrets

14. **`secrets-scan` misses obfuscated and generic secrets.** String concatenation
    (`"AKIA" + "…"`), hex or unicode tricks, generic high-entropy strings and JWTs pass. Local
    verify does not scan git history; only the kit's own `gitleaks` CI job does.

## Maven (S1 walking skeleton)

15. **Java gets L0 gates plus "tests ran", nothing about test quality.** No JaCoCo coverage, no
    PIT mutation, no ArchUnit, no Java no-cheat (`@Disabled`, `assume*`), no `openapi-diff` and
    no Maven D13 until S2-S4. Until then `openapi/openapi.yaml` changes are only caught as a
    protected path, and the contract is reviewed by hand.
16. **Any `pom.xml`, `.mvn/**` or `mvnw*` change needs `policy-change-approved` as a whole file.**
    There is no semantic pom diff yet, so a dependency bump and a plugin change look the same
    to the approver.
17. **Bumping the pinned kit SHA in a consumer is manual.** A consumer keeps the gates of the SHA
    it pins until someone opens that policy change.

## Reporting a new false-green

If you find a change that passes verify and should not, open an issue with the smallest diff
that reproduces it. Security-relevant cases follow [SECURITY.md](../SECURITY.md).
