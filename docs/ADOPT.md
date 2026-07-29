# Brownfield — adicionar o gauntlet a um app existente

## Princípio

Não exija green total no dia 1. Adote por **camadas**.

| Camada | O quê | Dia 1? |
|--------|--------|--------|
| 0 | `AGENTS.md` + skills | Sim |
| 1 | format / lint / typecheck | Ideal |
| 2 | unit + coverage | Ideal |
| 3 | OpenAPI contract | Se houver API |
| 4 | Gherkin + Playwright E2E | Poucos fluxos críticos |
| 5 | CI = verify | Quando local estável |

## CLI

```bash
# No clone do kit:
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt /path/to/existing-app

# Só static + unit (default)
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt . --gates static,unit

# Full
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt . --gates static,unit,contract,e2e
```

`static` expande para format + lint + typecheck.

## O que o adopt faz

- Copia `.agent/skills`, `scripts/verify.ts`, `scripts/check-openapi.ts`, etc.
- Escreve `gauntlet.config.json` com gates enabled/disabled
- Merge **não destrutivo** de scripts no `package.json`
- Não apaga `src/` nem testes existentes
- Gera `ADOPT-STATUS.md` checklist

## Depois do adopt

1. Instalar devDependencies que faltarem (vitest, eslint, cucumber, playwright, …)
2. Ajustar scripts se o projeto já usa Jest/Maven/etc.
3. Habilitar gates em `gauntlet.config.json` quando cada um estiver green
4. Colocar CI com `npm run verify`

## Apps não-TypeScript

Nesta versão o adapter de produção é **TypeScript**. Para Java/Spring:

- Use a **Camada 0** (copiar premissas do `AGENTS.md` / `docs/PREMISES.md`)
- Mapeie gates no `gauntlet.config.json` para `mvn verify`, etc. (commands livres)
- Adapter Maven completo = roadmap multi-stack

## Segurança

- Adopt **nunca** deve apagar features ou testes legados
- Não força Hono se o app for Nest/Express/Next — só traga charter + verify + harness que você escolher
