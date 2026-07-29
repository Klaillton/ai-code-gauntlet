# create-ai-gauntlet

CLI for the [AI Code Gauntlet](https://github.com/Klaillton/ai-code-gauntlet) kit.

## Commands

### Greenfield

```bash
# From a clone of this repo (templates live next to the package):
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js create my-app
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js create my-app --sample todo
```

### Brownfield adopt

```bash
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt ./existing-app
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt . --gates static,unit
```

Default adopt gates: `format`, `lint`, `typecheck`, `unit` (contract/e2e off until you enable them).

## Note

This CLI resolves templates relative to the **repository root** (`templates/`, `examples/`). Run it from a clone of the kit, or install after publishing when templates are bundled.
