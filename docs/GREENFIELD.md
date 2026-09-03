# Greenfield — start an app with the gauntlet

## Option A — CLI (from a kit clone)

```bash
git clone https://github.com/Klaillton/ai-code-gauntlet.git
cd ai-code-gauntlet
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js create ../my-app
cd ../my-app
npm install
npm run prepare:browsers
npm run verify
npm run dev
```

## Option B — copy the template

```bash
cp -r templates/ts-node-web ../my-app
cd ../my-app
npm install && npm run prepare:browsers && npm run verify
```

## After create

1. Human writes Gherkin (grant protect-specs if an agent must edit features).
2. Human approves OpenAPI for HTTP behavior.
3. Confirm new scenarios are red.
4. Agent implements under AGENTS.md. no-cheat and spec-sync are hard gates.
5. `npm run docs:generate && npm run verify` (max ~5 cycles).
6. Short human exploratory check.

## Skeleton includes

- `features/health.feature` (`@op:getHealth`)
- OpenAPI `/health` only
- Domain unit (`src/domain/health.ts`)
- Cucumber + Playwright harness
- `gauntlet.config.json` **lenient** plus spec-sync, no-cheat, protect-specs, docs
- `AGENTS.md`

Template D3 warns (lenient). Todo D3 fails (strict).
Business domain lives in `examples/todo` only.
