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
4. `create-ai-gauntlet adopt --stack maven`: config (`stack: maven`, `gates[]` = the L0 ids
   only, plus the L0 keys: protected globs, holes-review and spec-code globs per reactor module),
   agent docs, SDD docs, and `.github/workflows/policy-base.yml` (base-run enforcer, same
   hardening as the kit's: `pull_request_target`, `permissions: {}` with per-job
   `contents: read` + `pull-requests: read`, `persist-credentials: false`, head fetched as data
   only, PR number/SHAs only via env, actions pinned by SHA). It checks out the kit at a pinned
   commit (`--kit-ref <sha>` or the kit checkout's HEAD; neither = FAIL) and runs
   `run.mjs --root . --policy-head <sha>` (policy-base `--head` from the pinned kit).
5. L0 in every stack (`l0.ts`): built-in `l0-config` step after `stack` — every L0 id
   (protect-specs, holes-review, spec-code, adr-lint, sdd-presence, secrets-scan, spec-sync)
   must be in `gates[]`, for npm too (npm entries exactly `npm run <id>`; non-npm entries are
   ids only). The maven runner runs the L0 scripts from the pinned kit (never the consumer's),
   in that order, before the maven capabilities; spec-sync runs `--l0` (D11 + D13 only; the
   other D-checks read TypeScript).
6. Maven walking skeleton (`maven.ts`):
   - ONE reactor invocation: `mvn -B -ntp -f <stage>/pom.xml -Dmaven.repo.local=<core repo>
<forced -D skip=false flags> process-test-classes
org.apache.maven.plugins:maven-surefire-plugin:3.5.4:test`. The lifecycle up to
     `process-test-classes` gives the reactor (sibling module classes and resources on the
     classpath); the test goal is the pinned coordinate, not the pom's `test` phase binding;
   - build runs in a core-chosen tmp copy outside the workspace; `target/`, `.mvn/`, `.git`,
     `node_modules` and symlinks are not copied. The local repo is core-chosen
     (`GAUNTLET_MAVEN_REPO` or `<tmp>/gauntlet-m2-repo`, refused inside the workspace), a
     download cache the core never installs into;
   - reports: surefire 3.5.4 `reportsDirectory` has no user property (plugin.xml: no
     `property=`), so `-DreportsDirectory` would be silently ignored and is not passed. The
     reports are read per module from `<stage>/<module>/target/surefire-reports` (the stage is
     the core's tmp dir), so they are core-owned and attributed to their module; a pom
     redirect is caught by the pom guard and by the cross-check (no report = FAIL);
   - the core enumerates reactor modules from the poms (including profile modules);
     a jar module with no surefire report is FAIL; total tests == 0 is FAIL;
   - surefire reports cross-checked against the compiled concrete test classes in both
     directions, `tests=` against `<testcase>` count; failed, errored or skipped tests FAIL;
   - freshness: every main/test source has a class compiled in this run, and no class or
     report predates the run;
   - pom guard: skip/filter/redirect tags and threshold-like elements in any module pom FAIL.
7. Fixtures in `packages/gauntlet-gates/fixtures/maven` (green: `ok-single`, `ok-multi`,
   `reactor-dep` — B depends on A and reads classpath resources — and the adopted walking
   skeleton; red: `stack-mismatch`, `zero-tests`, `module-no-report`, `report-mismatch`,
   `pom-cheat`, `pom-includes`, `reactor-dep-no-test`, `missing-l0`) run for real by
   `npm --prefix packages/gauntlet-gates test` and by the CI job `maven-skeleton` (temurin 21,
   Maven 3.9.11 sha512-checked).

## Consequences

- Any tree whose base config has no `stack` fails verify until a PR with
  `policy-change-approved` adds it (intended: fail closed).
- A pom using `<includes>`, `<excludes>`, `<directory>`, `<outputDirectory>` etc. anywhere
  fails the pom guard in S1, even when the use is innocent (e.g. resource filtering). S2's
  semantic pom diff replaces this blunt check.
- A test-named class with no test methods fails the cross-check (it would have run nothing).
- pom surefire config still cannot change what runs: `<skip>`/`<includes>` etc. fail the pom
  guard, and a test class surefire did not run fails the cross-check (`pom-includes` fixture).
- Every tree's config must list all L0 gates; a config that drops one fails `l0-config`.
- The kit runner now needs `js-yaml` (inventory for D11/D13), pinned in
  `packages/gauntlet-gates/package-lock.json`.

**Residuals (S1):**

- The lifecycle up to `process-test-classes` runs every plugin the pom binds to those phases
  (e.g. exec, antrun, a code generator). The consumer's build code is trusted until S2
  protects pom paths with grants; the pom guard only covers skip/filter/redirect/threshold.
- gitleaks (history scan) stays a CI job in the kit; the maven runner runs `secrets-scan`.
- `holesReview`/`specCode` implementation globs are written per module at adopt time; a new
  module needs a config update (a policy change) or its code is not covered.
- The local repo is a shared download cache between runs (not installed into by the core).

**Not done yet (explicit):**

- S2: JaCoCo by the core, pom dependency diff,
  no-cheat Java (`@Disabled`, `assume*`, ...), protected paths and grants for pom.xml, `.mvn/**`,
  `mvnw*`, lombok.config; Enforcer rules.
- S3: PIT, CRAP from JaCoCo, ArchUnit. S4: Cucumber + Testcontainers, openapi-diff.
- Gradle; gherkin-mutation Java; D16-Java. Bumping the pinned kit SHA in a consumer is a
  manual policy change.
- The consumer's `policy-base.yml` only blocks once the consumer makes it a required check.

## Discarded

- Maven plugin (`gauntlet-maven-plugin`) as the runner — rejected: the pom would choose its
  version and configuration, which is exactly what the core must own.
- Running `mvn verify` and reading `target/` in the workspace — rejected: phases can be
  unbound (`<phase>none</phase>`) and committed or stale reports would count.
- Pinned goals without a lifecycle (first S1 cut) — replaced after Gate review: a module
  depending on a sibling could not resolve it.
- `-DreportsDirectory=<core dir>` — not a surefire user property; silently ignored.
- Rewriting the kit in Java — rejected: doubles the gate code and breaks npm parity.
- Defaulting a missing `stack` to `npm` — rejected: silent fallback is a false-green path.
