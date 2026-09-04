# Brownfield — adicionar o gauntlet a um app existente

## Princípio

Não exija green total no dia 1. Adote por **camadas** de trabalho humano, mas o
**config gerado é fail-closed**: `verify` não aceita `enabled: false` (D9 / verify).

| Camada | O quê | Dia 1? |
|--------|--------|--------|
| 0 | `AGENTS.md` + skills | Sim |
| 1 | format / lint / typecheck | Ideal |
| Hardening | protect-specs, no-cheat, spec-sync, docs (+ deps-lock se no template) | Sim (sempre no config) |
| 2 | unit + coverage | Ideal |
| 3 | OpenAPI contract | Se houver API |
| 4 | Gherkin + Playwright E2E | Poucos fluxos críticos |
| 5 | CI = verify | Quando local estável |

## CLI

```bash
# No clone do kit:
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt /path/to/existing-app

# Scaffold intent (default static+unit) — não desliga gates no config
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt . --gates static,unit

# Também scaffolding de features/e2e/openapi
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js adopt . --gates static,unit,contract,e2e
```

`static` expande para format + lint + typecheck **só no checklist / scaffolds**.
`--gates` **não** escreve `enabled: false`.

## O que o adopt faz

- Copia `.agent/skills`, `scripts/` completo do template (incluindo
  `protect-specs.ts`, `no-cheat.ts`, `spec-sync.ts`, `generate-docs.ts`,
  `check-docs-fresh.ts`, `inventory.ts`, `verify.ts`, …)
- Se o template tiver `scripts/deps-lock.ts`, copia e **inclui** o gate `deps-lock`
- Escreve `gauntlet.config.json` alinhado a `templates/ts-node-web`:
  - lista completa de gates (sem `enabled: false`)
  - `strictness: "lenient"`, `allowSpecEdit: false`
  - `allowDepsEdit: false` quando deps-lock estiver presente
  - allowlist seed do template (ajustar owner/expires no app)
- Merge **não destrutivo** de scripts no `package.json` (incluindo
  `protect-specs`, `no-cheat`, `spec-sync`, `docs:generate`, `docs:check`,
  e `deps-lock` se aplicável)
- Copia baseline `docs/generated/` se faltar (gate `docs` / D7)
- Merge entradas de `.gitignore` para reports e grants locais
- Não apaga `src/` nem testes existentes
- Gera `ADOPT-STATUS.md` checklist

Greenfield `create` continua a copiar o template inteiro (já hardenado).

## Hardening gates

| Gate | Script | Função |
|------|--------|--------|
| `protect-specs` | `npm run protect-specs` | Diff em features/OpenAPI/`protectedGlobs` exige grant humano |
| `deps-lock` | `npm run deps-lock` | Diff em `package.json` / lockfile exige grant (só se no template) |
| `no-cheat` | `npm run no-cheat` | D9: skip/only/pending, `enabled:false`, coverage floors |
| `spec-sync` | `npm run spec-sync` | Drift D1–D6, D8 (inventory) |
| `docs` | `npm run docs:check` | D7: `docs/generated/*` fresco |

Ordem típica (template): format → lint → typecheck → protect-specs →
[`deps-lock`] → no-cheat → spec-sync → docs → unit → contract → e2e.

## Grants humanos (não bakear no CI)

### Specs (`protect-specs`)

Verify falha se o diff tocar specs protegidos **a menos que** um destes exista:

1. `ALLOW_SPEC_EDIT=1` (documentar no PR; **não** env permanente no CI)
2. `.gauntlet/allow-spec-edit` (gitignored, local)
3. `allowSpecEdit: true` no config (default **false**)
4. Label de PR **`specs-approved`** — o workflow exporta `ALLOW_SPEC_EDIT=1` só nesse caso

### Deps (`deps-lock`, quando presente — Phase 2 / PR #5)

1. `ALLOW_DEPS_EDIT=1`
2. `.gauntlet/allow-deps-edit` (gitignored)
3. `allowDepsEdit: true` no config (default **false**)
4. Label de PR **`deps-approved`**

Pushes a `main` e PRs sem label continuam fail-closed. Detalhes:
[`ADR-spec-sync-drift.md`](./ADR-spec-sync-drift.md) e, após merge do Phase 2,
`ADR-phase2-deps-spec-review.md`.

## Depois do adopt

1. Instalar devDependencies que faltarem (vitest, eslint, cucumber, playwright, js-yaml, …)
2. Ajustar scripts se o projeto já usa Jest/Maven/etc.
3. Adaptar allowlist / `contract.cases` / `protectedGlobs` ao domínio real
4. `npm run docs:generate` e então `npm run verify` até green
5. **Não** desligar gates com `enabled: false` — remova um gate do array só com
   decisão humana consciente (e espere D9/no-cheat se algo ficar inconsistente)
6. Colocar CI com `npm run verify` (+ labels de grant no workflow do kit)

## Apps não-TypeScript

Nesta versão o adapter de produção é **TypeScript**. Para Java/Spring:

- Use a **Camada 0** (copiar premissas do `AGENTS.md` / `docs/PREMISES.md`)
- Mapeie gates no `gauntlet.config.json` para `mvn verify`, etc. (commands livres)
- Adapter Maven completo = roadmap multi-stack

## Segurança

- Adopt **nunca** deve apagar features ou testes legados
- Não força Hono se o app for Nest/Express/Next — só traga charter + verify + harness que você escolher
- Grants de specs/deps são **human-only**; agentes não devem criar `.gauntlet/allow-*` nem labels
