# create-ai-gauntlet

CLI for the [AI Code Gauntlet](https://github.com/Klaillton/ai-code-gauntlet) kit.

## Commands

### Greenfield

```bash
# From a clone of this repo (templates live next to the package):
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js create my-app
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js create my-app --sample todo
```

`create` copies `templates/ts-node-web` (or `examples/todo`) wholesale — already
hardened (complexity, arch-bound, protect-specs, secrets-scan, no-cheat, spec-sync, docs, crap; deps-lock when present).

### Brownfield adopt

```bash
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt ./existing-app
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt . --gates static,unit
```

Adopt writes a **fail-closed** `gauntlet.config.json` matching the current
template gate list (no `enabled: false`). Hardening gates
(`complexity`, `arch-bound`, `protect-specs`, `secrets-scan`, `no-cheat`,
`spec-sync`, `docs`, `crap`, and `deps-lock` if the template ships it) are
always wired; scripts are copied from the template.
`--gates` only guides scaffolding + `ADOPT-STATUS.md` (e.g. whether to seed
features/e2e/openapi).

See [`docs/ADOPT.md`](../../docs/ADOPT.md) for grants (`specs-approved`,
`deps-approved`, `ALLOW_*`).

## Pack / npx

`npm pack` (and `prepack`) copies `templates/`, `packages/gauntlet-gates`,
`packages/gauntlet-skills`, and `examples/todo` into `kit/` inside this
package. After publish:

```bash
npx create-ai-gauntlet create my-app
npx create-ai-gauntlet adopt .
```

From a clone, `findKitRoot()` still uses the repo layout (no `kit/` needed).
