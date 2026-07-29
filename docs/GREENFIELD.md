# Greenfield — começar um app com o gauntlet

## Opção A — CLI (a partir do clone do kit)

```bash
git clone https://github.com/Klaillton/ai-code-gauntlet.git
cd ai-code-gauntlet

# Skeleton health-only (recomendado)
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js create ../my-app

# Ou com sample Todo
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js create ../my-app --sample todo

cd ../my-app
npm install
npm run prepare:browsers
npm run verify
npm run dev
```

## Opção B — copiar o template

```bash
cp -r templates/ts-node-web ../my-app
cd ../my-app
# edite package.json name
npm install && npm run prepare:browsers && npm run verify
```

## Opção C — GitHub Template

Use o repositório kit e copie `templates/ts-node-web` (o default do monorepo **não** é o app Todo).

## Fluxo depois do create

1. Humano: intent → Feature Gherkin (aprova)
2. Humano: OpenAPI se HTTP (aprova)
3. Confirmar red nos cenários novos
4. Agent implementa sob `AGENTS.md`
5. `npm run verify` até green (max ~5 ciclos)
6. Exploratory humano curto

## O que o skeleton inclui

- `features/health.feature`
- OpenAPI só `/health`
- Unit de domínio mínimo (`src/domain/health.ts`)
- E2E harness Cucumber + Playwright
- `gauntlet.config.json` + `npm run verify`
- `AGENTS.md` + skills

**Não** inclui domínio de negócio. Todo está em `examples/todo` só para pedagogia.
