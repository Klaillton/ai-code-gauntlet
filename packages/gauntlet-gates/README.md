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
- `src/maven.ts` — maven L2 skeleton (compile, surefire, freshness, pom guard).
- `fixtures/maven/` — `ok-single`, `ok-multi` (green) and `stack-mismatch`, `zero-tests`,
  `module-no-report`, `report-mismatch` (also a forged report under `target/`), `pom-cheat` (red).
