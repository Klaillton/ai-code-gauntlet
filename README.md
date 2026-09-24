# AI Code Gauntlet

**Kit** for disciplined AI-assisted development (Uncle Bob-style constraints on a modern TS stack).

This repo is **not** only a Todo app. It is:

| Path | Role |
|------|------|
| [`templates/ts-node-web`](./templates/ts-node-web) | **Greenfield skeleton** (health-only, lenient D3) |
| [`examples/todo`](./examples/todo) | **Full demo** that proves every gate (strict) |
| [`packages/create-ai-gauntlet`](./packages/create-ai-gauntlet) | CLI: `create` + `adopt` |
| [`packages/gauntlet-gates`](./packages/gauntlet-gates) | Canonical verify scripts (`gates:sync` / `gates:check`) |
| [`docs/ADR-gates-source.md`](./docs/ADR-gates-source.md) | B1: one copy of gate scripts |
| [`docs/`](./docs) | Premises, greenfield, adopt, original plan, [roadmap](./docs/plan.md) |
| [`docs/ADR-spec-sync-drift.md`](./docs/ADR-spec-sync-drift.md) | Spec-sync drift catalog (D1-D12) |
| [`docs/ADR-phase2-deps-spec-review.md`](./docs/ADR-phase2-deps-spec-review.md) | Phase 2: deps-lock + spec-review |
| [`docs/ADR-phase2-mutation-complexity.md`](./docs/ADR-phase2-mutation-complexity.md) | Phase 2: mutation + complexity |
| [`docs/ADR-secrets-privacy.md`](./docs/ADR-secrets-privacy.md) | secrets-scan: credentials + PII hard gate |
| [`docs/ADR-arch-bound.md`](./docs/ADR-arch-bound.md) | arch-bound: domain must not import infra |
| [`docs/ADR-gherkin-mutation.md`](./docs/ADR-gherkin-mutation.md) | Gherkin mutation + differential unit mutation |
| [`docs/six-pack.md`](./docs/six-pack.md) | Role playbook (not a swarm) |

```
Gherkin (human-owned)      -> behavior (protect-specs)
OpenAPI (human-owned)      -> HTTP shape (protect-specs)
package manifests          -> deps-lock (human grant)
secrets / PII              -> secrets-scan (fail-closed; no ALLOW_SECRETS)
domain isolation           -> arch-bound (no HTTP/UI/fs in src/domain)
Playwright drivers         -> acceptance
Vitest + coverage          -> unit stream (no-cheat)
Mutation (src/domain)      -> test honesty 80% kill (template + Todo; timeouts ≠ kills)
Gherkin examples           -> gherkin-mutation after e2e (template + Todo)
SDD + docs                 -> D7 freshness; D10 same-diff docs/generated when SDD changes
Complexity (src/domain)    -> cyclomatic max 10
CRAP (touched domain)      -> complexity × coverage ≤ 8 after unit
spec-sync inventory        -> D1-D8 + D10-D11 drift (D8 = gherkin leak; D11 = edge/@unhappy inventory)
holes-review (D12)         -> src/** needs docs/holes-review artifact or human grant
no-cheat                   -> skip/only, disabled gates, lowered floors
ESLint + Prettier + tsc    -> static shape
AGENTS.md + skills         -> agent rules (incl. spec-review before implement)
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

## Premises

See [docs/PREMISES.md](./docs/PREMISES.md) and [docs/original-plan.md](./docs/original-plan.md).

**You** defend Gherkin + OpenAPI + dependency manifests. **The agent** implements.
**`verify` / CI** are the filter.

protect-specs, deps-lock, secrets-scan, arch-bound, holes-review (D12), and no-cheat are **hard tools**. Agents
cannot edit `features/**` or `openapi/openapi.yaml` without a protect-specs
grant, cannot edit `package.json` / `package-lock.json` (root, examples,
templates) without a deps-lock grant (`ALLOW_DEPS_EDIT=1`, committed
`allowDepsEdit: true`, or PR label `deps-approved` — working-tree
`.gauntlet/allow-*` files are **not** grants; no usable git → these gates
**fail**), and cannot land
credentials / private keys / high-confidence PII dumps (there is **no**
`ALLOW_SECRETS` standing override).

## Config

Apps use `gauntlet.config.json` to order gates. Mainline verify is **fail-closed**:
`enabled: false` on a gate fails no-cheat / verify. Do not use that flag to sneak
past the gauntlet.

Todo is `strict` (D3 fail). The template is `lenient` (D3 warn).

## Phase 2 (partial) / Phase 3 (roadmap)

**Wired now:** deps-lock + spec-review skill. See
[docs/ADR-phase2-deps-spec-review.md](./docs/ADR-phase2-deps-spec-review.md).
**secrets-scan** is wired on template + Todo. See
[docs/ADR-secrets-privacy.md](./docs/ADR-secrets-privacy.md).

**Also wired:** mutation + complexity on `src/domain`. See
[docs/ADR-phase2-mutation-complexity.md](./docs/ADR-phase2-mutation-complexity.md).

- Mutation: Stryker-equivalent, **80%** kill-score floor. **Template and Todo**
  both run the gate (empty domain → 100%). Timeouts are not kills.
- Complexity: cyclomatic **max 10** per domain function. **CRAP ≤ 8** on
  touched domain after unit. Domain coverage floors **90/90/70/90**.
- Gherkin leakage is **D8** (already in spec-sync; confirmed, not changed).
- Edge/unhappy inventory is **D11** (fail-closed in strict and lenient; scenario-level `@unhappy`/`@edge` with exactly one `@op`).
- Implementation without holes-review is **D12** (fail-closed when `src/**` changes; artifact `docs/holes-review/**/*.md` with non-empty sections, or human grant — no allow-file).

Remaining (not default kit gates):

- Official dependency-cruiser (arch-bound is the stand-in)
- Perf/ORM budgets in the **consuming** app, when it has a workload
- Official Stryker (custom runner is the gate)
- Another stack via `adopt` in that repo
- Regex inflation in secrets-scan — gitleaks covers history in CI instead

## License

MIT
