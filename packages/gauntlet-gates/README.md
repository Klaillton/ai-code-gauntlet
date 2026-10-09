# @ai-code-gauntlet/gates

Canonical TypeScript sources for gauntlet verify scripts.

`examples/todo/scripts` and `templates/ts-node-web/scripts` are **distribution
copies** so `create` / `adopt` stay self-contained. Edit files here, then:

```bash
npm run gates:sync    # copy src/*.ts into todo + template
npm run gates:check   # fail if those copies drifted
```

Root `npm run verify` runs `gates:check` first.

## Pinned runner (ADD-POLY S1)

`run.mjs` runs this checkout's `src/verify.ts` against a consumer tree that has no
package.json (tsx comes from this package's lockfile):

```bash
npm ci --prefix packages/gauntlet-gates
node packages/gauntlet-gates/run.mjs --root /path/to/consumer
npm --prefix packages/gauntlet-gates test   # maven fixtures, needs JDK 21 + mvn
```

- `src/adapter.ts` — L1 contract `{command,args,parser}` -> `{ran,total,metric}`, fail-closed `stack`.
- `src/maven.ts` — maven L2 skeleton: one reactor run (`process-test-classes` + pinned
  surefire), per-module reports, freshness, pom guard.
- `src/l0.ts` — L0 gate list, `l0-config` validation (every stack; for maven also build-file
  protectedGlobs and reactor-module coverage of the implementation globs), runner-owned L0
  commands.
- `run.mjs --root <base> --policy-head <sha>` — base-run policy-base (used by the consumer's
  `.github/workflows/policy-base.yml` that `adopt --stack maven` writes).
- `fixtures/maven/` — `ok-single`, `ok-multi`, `reactor-dep` (green) and `stack-mismatch`,
  `zero-tests`, `module-no-report`, `report-mismatch` (also a forged report under `target/`),
  `pom-cheat`, `pom-includes`, `reactor-dep-no-test`, `missing-l0` (red); `_shared` SDD docs.
