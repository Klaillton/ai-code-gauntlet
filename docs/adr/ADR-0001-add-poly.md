# ADR-0001: ADD-POLY — language-independent gauntlet (S1 landed)

## Status

Accepted — 2026-10-09

## Context

The first non-TS consumer is the Webhook & Idempotency Gateway, a Spring Boot starter
(Maven, JDK 21), starting 2026-10-12. Today every gate is an npm script inside a tree with a
package.json. A Maven repo cannot adopt the kit without pretending to be an npm project, and
copying the npm gates to Maven by hand would reopen the false-green holes the TS gates closed
(pom-owned thresholds, `<skipTests>`, stale or committed reports, modules that never ran).

Design closed by Gate and revised by Challenge (REVISE, all points accepted). Delivered in
milestones S1-S4; this ADR records the decision and exactly what S1 ships.

## Decision

Three layers:

- **L0 core**: files + git only, identical for every stack (policy-base, protect-specs,
  secrets/gitleaks, adr-lint, sdd-presence, holes-review, spec-code, D11, D13).
- **L1 adapter contract** per capability: `{ command, args, parser }` -> `{ ran, total, metric }`
  (`packages/gauntlet-gates/src/adapter.ts`). The core, not the adapter, fails `ran == false`
  and `total == 0`.
- **L2 adapters**: npm (today's behavior), then maven, then gradle.

The kit stays TypeScript and runs as a **pinned runner**: a kit checkout at a fixed SHA,
`npm ci --prefix packages/gauntlet-gates` (tsx pinned by that lockfile), then
`node packages/gauntlet-gates/run.mjs --root <consumer>`. The consumer needs no package.json.

`stack` in `gauntlet.config.json` is required and read from the base config like every other
policy key. Missing, unknown, not implemented (gradle), not matching the build files present,
or a second stack's build file next to it: FAIL.

**S1 ships:**

1. Adapter contract; npm gates run behind it at parity (same commands from the base
   `gates[]`, same exit-code verdict, same exit code; the report gains a built-in `stack` step).
2. Fail-closed `stack` (built-in second step after policy-base; template + Todo declare `npm`).
3. Pinned runner (`run.mjs`) for consumers without package.json.
4. `create-ai-gauntlet adopt --stack maven`: config (`stack: maven`, `gates: []`), agent docs
   and SDD docs only. For non-npm stacks `gates[]` must be empty: the core chooses commands.
5. Maven walking skeleton (`maven.ts`):
   - goals invoked by plugin coordinates pinned in the runner (resources 3.3.1, compiler
     3.14.1, surefire 3.5.4), never pom phases;
   - build runs in a core-chosen tmp copy outside the workspace; `target/`, `.mvn/`, `.git`,
     `node_modules` and symlinks are not copied;
   - the core enumerates reactor modules from the poms (including profile modules);
     a jar module with no surefire report is FAIL; total tests == 0 is FAIL;
   - surefire reports cross-checked against the compiled concrete test classes in both
     directions, `tests=` against `<testcase>` count; failed, errored or skipped tests FAIL;
   - freshness: every main/test source has a class compiled in this run, and no class or
     report predates the run;
   - pom guard: skip/filter/redirect tags and threshold-like elements in any module pom FAIL.
6. Fixtures in `packages/gauntlet-gates/fixtures/maven` (2 green, 5 adversarial) run for real
   by `npm --prefix packages/gauntlet-gates test` and by the CI job `maven-skeleton` (temurin 21,
   Maven 3.9.11 sha512-checked).

## Consequences

- Any tree whose base config has no `stack` fails verify until a PR with
  `policy-change-approved` adds it (intended: fail closed).
- A pom using `<includes>`, `<excludes>`, `<directory>`, `<outputDirectory>` etc. anywhere
  fails the pom guard in S1, even when the use is innocent (e.g. resource filtering). S2's
  semantic pom diff replaces this blunt check.
- A test-named class with no test methods fails the cross-check (it would have run nothing).

**Not done yet (explicit):**

- S2: JaCoCo by the core, multi-module with inter-module dependencies (goals run without a
  lifecycle, so a module depending on a sibling cannot resolve it yet), pom dependency diff,
  no-cheat Java (`@Disabled`, `assume*`, ...), protected paths and grants for pom.xml, `.mvn/**`,
  `mvnw*`, lombok.config; Enforcer rules.
- S3: PIT, CRAP from JaCoCo, ArchUnit. S4: Cucumber + Testcontainers, openapi-diff.
- L0 gates other than policy-base are not wired into the maven runner yet.
- Gradle; gherkin-mutation Java; D16-Java. The pinned SHA for consumers is a manual step.
- The base-run enforcer (`policy-base.yml`) still covers only the two npm trees.

## Discarded

- Maven plugin (`gauntlet-maven-plugin`) as the runner — rejected: the pom would choose its
  version and configuration, which is exactly what the core must own.
- Running `mvn verify` and reading `target/` in the workspace — rejected: phases can be
  unbound (`<phase>none</phase>`) and committed or stale reports would count.
- Rewriting the kit in Java — rejected: doubles the gate code and breaks npm parity.
- Defaulting a missing `stack` to `npm` — rejected: silent fallback is a false-green path.
