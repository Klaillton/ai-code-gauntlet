# AI Code Gauntlet

**Kit** for disciplined AI-assisted development (Uncle Bob-style constraints on a modern TS stack).

This repo is **not** only a Todo app. It is:

| Path | Role |
|------|------|
| [`templates/ts-node-web`](./templates/ts-node-web) | **Greenfield skeleton** (health-only, lenient D3) |
| [`examples/todo`](./examples/todo) | **Full demo** that proves every gate (strict) |
| [`packages/create-ai-gauntlet`](./packages/create-ai-gauntlet) | CLI: `create` + `adopt` |
| [`docs/`](./docs) | Premisses, greenfield, adopt, original plan |
| [`docs/ADR-spec-sync-drift.md`](./docs/ADR-spec-sync-drift.md) | Spec-sync drift catalog (D1-D9) |
| [`docs/ADR-phase2-mutation-complexity.md`](./docs/ADR-phase2-mutation-complexity.md) | Phase 2: mutation + complexity |

```
Gherkin (human-owned)      -> behavior (protect-specs)
OpenAPI (human-owned)      -> HTTP shape (protect-specs)
Playwright drivers         -> acceptance
Vitest + coverage          -> unit stream (no-cheat)
Mutation (src/domain)      -> test honesty (Todo gate; template opt-in)
Complexity (src/domain)    -> cyclomatic max 10
spec-sync inventory        -> D1-D8 drift (D8 = gherkin leak)
no-cheat                   -> skip/only, disabled gates, lowered floors
ESLint + Prettier + tsc    -> static shape
AGENTS.md + skills         -> agent rules (tools, not politeness)
npm run verify             -> ordered gauntlet
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
npm run verify   # template + example; needs Chromium
```

## Premisses

See [docs/PREMISES.md](./docs/PREMISES.md) and [docs/original-plan.md](./docs/original-plan.md).

**You** defend Gherkin + OpenAPI. **The agent** implements. **`verify` / CI** are the filter.

protect-specs and no-cheat are **hard tools**. Agents cannot edit `features/**` or
`openapi/openapi.yaml` without a human grant (`ALLOW_SPEC_EDIT=1`,
`.gauntlet/allow-spec-edit`, or PR label `specs-approved`).

## Config

Apps use `gauntlet.config.json` to order gates. Mainline verify is **fail-closed**:
`enabled: false` on a gate fails no-cheat / verify. Do not use that flag to sneak
past the gauntlet.

Todo is `strict` (D3 fail). The template is `lenient` (D3 warn).

## Phase 2 / 3

**Wired now (this branch):** mutation + complexity on `src/domain`. See
[docs/ADR-phase2-mutation-complexity.md](./docs/ADR-phase2-mutation-complexity.md).

- Mutation: Stryker-equivalent, **60%** kill-score floor (TODO: raise after CI
  measures). Todo has the `mutation` gate; template has `test:mutation` only.
- Complexity: cyclomatic **max 10** per domain function (CRAP ≤8 needs coverage
  combo — later). Both apps have the `complexity` gate.
- Gherkin leakage is **D8** (already in spec-sync; confirmed, not changed).

**Open on PR #5 (do not duplicate):** deps-lock + spec-review skill.
Merge **#5 first**, then rebase this branch. Remaining later:

- Architectural drift -> dependency-cruiser (domain must not import infra)
- Invisible cost / perf -> benchmark budgets; ORM/SQL later
- Official Stryker package + raised mutation threshold
- Hallucinated deps / SBOM (deps-lock on PR #5)

## License

MIT
