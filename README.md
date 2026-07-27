# AI Code Gauntlet

Scaffold for **disciplined AI-assisted development** (Uncle Bob–style constraints on a modern TS web stack).

```
📝 Cucumber (Gherkin)     → human-defended behavior
🎭 Playwright             → UI + API acceptance drivers
🧪 Vitest                 → unit stream + coverage floors
📜 OpenAPI                → HTTP contract checks
🔍 ESLint + Prettier + TS → static shape
🤖 AGENTS.md + skills     → agent rules
🔁 npm run verify         → full automatic gauntlet
```

## Quick start

```bash
cd ai-code-gauntlet
npm install
npm run prepare:browsers
npm run verify
```

Local app:

```bash
npm run dev
# http://localhost:3000
```

## Project layout

```
features/               # Gherkin specs (human-owned)
e2e/steps|support/      # Cucumber + Playwright drivers
openapi/openapi.yaml    # API contract (human-owned)
src/domain              # pure business rules
src/api                 # HTTP adapters (Hono)
src/web                 # minimal UI for E2E demo
tests/unit              # Vitest
scripts/verify.ts       # ordered quality gates
.agent/skills           # agent playbooks
AGENTS.md               # hard rules for agents
.github/workflows       # CI = same gates
```

## Verify pipeline

`npm run verify` runs, in order:

| #   | Gate             | Command                    |
| --- | ---------------- | -------------------------- |
| 1   | Format           | `prettier --check`         |
| 2   | Lint             | `eslint`                   |
| 3   | Types            | `tsc --noEmit`             |
| 4   | Unit + coverage  | `vitest run --coverage`    |
| 5   | OpenAPI contract | `scripts/check-openapi.ts` |
| 6   | E2E acceptance   | Cucumber + Playwright      |

Coverage floors (see `vitest.config.ts`): **80%** lines/functions/statements, **70%** branches on domain/API sources.

## Agent workflow

1. Human writes/approves **Feature + scenarios**
2. Human approves **OpenAPI** changes when HTTP is involved
3. Agent implements against red tests
4. Agent runs **`npm run verify`** and fixes until green (max ~5 cycles)
5. Human does a short exploratory check

See **[AGENTS.md](./AGENTS.md)** and **[.agent/skills](./.agent/skills)**.

### Skills

| Skill             | File                                 | When                         |
| ----------------- | ------------------------------------ | ---------------------------- |
| implement-feature | `.agent/skills/implement-feature.md` | Build against approved specs |
| write-gherkin     | `.agent/skills/write-gherkin.md`     | Draft scenarios with human   |
| fix-until-green   | `.agent/skills/fix-until-green.md`   | Restore failing verify/CI    |

## Sample domain

In-memory **Todo** app:

- `GET /health`
- `GET|POST /api/todos`
- `POST /api/todos/:id/complete`
- Thin UI at `/` for Playwright scenarios

## CI

[`.github/workflows/verify.yml`](./.github/workflows/verify.yml) runs the same gauntlet on push/PR.

## Phase 2 (optional next)

- Mutation testing (Stryker) on `src/domain`
- Complexity / CRAP-like budget
- Gherkin leakage linter
- Differential E2E selection

## License

MIT (template). Use freely as a starter for agentic projects.
