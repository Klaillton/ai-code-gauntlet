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
hardened (protect-specs, no-cheat, spec-sync, docs; deps-lock when present).

### Brownfield adopt

```bash
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt ./existing-app
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt . --gates static,unit
```

Adopt writes a **fail-closed** `gauntlet.config.json` matching the current
template gate list (no `enabled: false`). Hardening gates
(`protect-specs`, `no-cheat`, `spec-sync`, `docs`, and `deps-lock` if the
template ships it) are always wired; scripts are copied from the template.
`--gates` only guides scaffolding + `ADOPT-STATUS.md` (e.g. whether to seed
features/e2e/openapi).

See [`docs/ADOPT.md`](../../docs/ADOPT.md) for grants (`specs-approved`,
`deps-approved`, `ALLOW_*`).

## Note

This CLI resolves templates relative to the **repository root** (`templates/`, `examples/`). Run it from a clone of the kit, or install after publishing when templates are bundled.
