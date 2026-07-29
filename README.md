# AI Code Gauntlet

**Kit** for disciplined AI-assisted development (Uncle Bob–style constraints on a modern TS stack).

This repo is **not** “only a Todo app”. It is:

| Path | Role |
|------|------|
| [`templates/ts-node-web`](./templates/ts-node-web) | **Greenfield skeleton** (health-only) |
| [`examples/todo`](./examples/todo) | **Full demo** that proves every gate |
| [`packages/create-ai-gauntlet`](./packages/create-ai-gauntlet) | CLI: `create` + `adopt` |
| [`docs/`](./docs) | Premisses, greenfield, adopt, original plan |

```
📝 Gherkin (human-owned)     → behavior
🎭 Playwright drivers        → acceptance
🧪 Vitest + coverage         → unit stream
📜 OpenAPI contracts         → HTTP shape
🔍 ESLint + Prettier + tsc   → static shape
🤖 AGENTS.md + skills        → agent rules
🔁 npm run verify            → ordered gauntlet
```

## Quick paths

### 1) Try the demo (Todo)

```bash
cd examples/todo
npm install
npm run prepare:browsers
npm run verify
npm run dev
```

### 2) Start a new app (greenfield)

```bash
# from kit root
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js create ../my-app
cd ../my-app
npm install && npm run prepare:browsers && npm run verify
```

Or copy `templates/ts-node-web`. Details: [docs/GREENFIELD.md](./docs/GREENFIELD.md).

### 3) Add gauntlet to an existing app (adopt)

```bash
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt /path/to/app --gates static,unit
```

Details: [docs/ADOPT.md](./docs/ADOPT.md).

### 4) Verify the whole kit (CI locally)

```bash
npm run install:all
npm run prepare:browsers
npm run verify   # template + example
```

## Premisses

See [docs/PREMISES.md](./docs/PREMISES.md) and [docs/original-plan.md](./docs/original-plan.md).

**You** defend Gherkin + OpenAPI. **The agent** implements. **`verify` / CI** are the filter.

## Config

Apps use `gauntlet.config.json` to enable/order gates. Example:

```json
{
  "gates": [
    { "id": "format", "command": "npm", "args": ["run", "format"] },
    { "id": "unit", "command": "npm", "args": ["run", "test:unit:coverage"] }
  ]
}
```

Set `"enabled": false` on a gate during gradual adopt.

## Phase 2 (quality, not template)

Optional later: mutation testing, complexity/CRAP-like, Gherkin leakage linter, differential E2E.

## License

MIT
