# Brownfield — adicionar o gauntlet a um app existente

## Princípio

Não exija green total no dia 1. Adote por **camadas** de trabalho humano, mas o
**config gerado é fail-closed**: `verify` não aceita `enabled: false` (D9 / verify).

| Camada    | O quê                                                                                                                                                                                                       | Dia 1?                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 0         | `AGENTS.md` + skills                                                                                                                                                                                        | Sim                    |
| 1         | format / lint / typecheck                                                                                                                                                                                   | Ideal                  |
| Hardening | protect-specs, secrets-scan, arch-bound, no-cheat, holes-review (D12), spec-code (CHANGE-3), adr-lint (D14), sdd-presence (D15), spec-sync, docs, complexity (+ deps-lock se no template; mutation no Todo) | Sim (sempre no config) |
| 2         | unit + coverage                                                                                                                                                                                             | Ideal                  |
| 3         | OpenAPI contract                                                                                                                                                                                            | Se houver API          |
| 4         | Gherkin + Playwright E2E                                                                                                                                                                                    | Poucos fluxos críticos |
| 5         | CI = verify                                                                                                                                                                                                 | Quando local estável   |

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

- Copia `.agent/skills` do template e `scripts/` de
  `packages/gauntlet-gates/src` (incluindo
  scripts canônicos — `protect-specs.ts`,
  `no-cheat.ts`, `spec-sync.ts`, `complexity.ts`, `mutation.ts`,
  `generate-docs.ts`, `check-docs-fresh.ts`, `inventory.ts`, `verify.ts`,
  `deps-lock.ts`, `holes-review.ts`, `secrets-scan.ts`, `arch-bound.ts`, `crap.ts`,
  `gherkin-mutation.ts`, …)
- Inclui o gate `deps-lock` quando o template tem `scripts/deps-lock.ts`
- Escreve `gauntlet.config.json` alinhado a `templates/ts-node-web`:
  - lista completa de gates (sem `enabled: false`), incluindo `complexity`
  - `strictness: "lenient"`, `allowSpecEdit: false`
  - `allowDepsEdit: false` quando deps-lock estiver presente
  - allowlist seed do template (ajustar owner/expires no app)
- Merge **não destrutivo** de scripts no `package.json` (incluindo
  `complexity`, `test:mutation`, `protect-specs`, `no-cheat`, `spec-sync`,
  `docs:generate`, `docs:check`, `secrets-scan`, `arch-bound`, `crap`,
  `gherkin-mutation`, e `deps-lock` se aplicável)
- Copia baseline `docs/generated/` se faltar (gate `docs` / D7)
- Merge entradas de `.gitignore` para reports e grants locais
- Não apaga `src/` nem testes existentes
- Gera `ADOPT-STATUS.md` checklist

Greenfield `create` continua a copiar o template inteiro (já hardenado).

## Hardening gates

| Gate              | Script                  | Função                                                                                         |
| ----------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `complexity`      | `npm run complexity`    | Cyclomatic max 10 em `src/domain`                                                              |
| `crap`            | `npm run crap`          | CRAP ≤ 8 em `src/domain` tocado (depois de unit+coverage)                                      |
| `arch-bound`      | `npm run arch-bound`    | `src/domain` não importa HTTP/UI/fs                                                            |
| `protect-specs`   | `npm run protect-specs` | Diff em features/OpenAPI/`protectedGlobs` exige grant humano                                   |
| `deps-lock`       | `npm run deps-lock`     | Diff em `package.json` / lockfile exige grant (só se no template)                              |
| `secrets-scan`    | `npm run secrets-scan`  | Credenciais, PEM, tokens de alta confiança, PII em fixtures — fail-closed; sem `ALLOW_SECRETS` |
| `no-cheat`        | `npm run no-cheat`      | D9: skip/only/pending, `enabled:false`, coverage floors                                        |
| `spec-sync`       | `npm run spec-sync`     | Drift D1–D6, D8, D10, **D11** (edge), **D13** (OpenAPI ↔ contract.cases)                       |
| `adr-lint`        | `npm run adr-lint`      | **D14** ADR template on new/changed `docs/adr/**`                                              |
| `sdd-presence`    | `npm run sdd-presence`  | **D15** `docs/sdd/Security.md` + `Observability.md` presence (heading + ≥1 requirement)        |
| `docs`            | `npm run docs:check`    | D7: `docs/generated/*` fresco                                                                  |
| `mutation` (Todo) | `npm run test:mutation` | Kill-score floor on domain; template is opt-in only                                            |

Ordem típica (template): format → lint → typecheck → complexity → arch-bound →
protect-specs → [`deps-lock`] → holes-review → spec-code → adr-lint → sdd-presence → secrets-scan → no-cheat → spec-sync → docs → unit →
crap → mutation → contract → e2e → gherkin-mutation.

**D10:** mudança em Gherkin/OpenAPI no diff exige `docs/generated` no mesmo
diff (`docs:generate`). Reabrir spec fechada: grant protect-specs + skill
`reopen-spec`.

**D11:** todo `@op` com Gherkin precisa de ≥1 cenário com `@unhappy`/`@edge` (nível Scenario; falha em strict e lenient).
**D13:** cada op OpenAPI precisa de ≥1 `contract.cases`; case inválido falha; `caseAllowlist` committed + `expires`.
**D14:** ADRs novos/alterados em `docs/adr/**` precisam das secções do template; não apagar — marcar Superseded.

**D15:** Com SDD ativo, `docs/sdd/Security.md` e `Observability.md` são obrigatórios (heading + ≥1 requirement). Adopt falha se faltar. Skip com `sdd: false`. Residual: lorem/TODO passa presença.

**CHANGE-2:** mutation/gherkin-mutation com zero sites **falha** (nunca 100%); `skipReason`+`expires` ou soft-skip diferencial.

**CHANGE-3:** PRs com `src/**` precisam de Gherkin/OpenAPI/holes-review no mesmo PR, ou grant `SPEC_SYNC_APPROVED` / label `spec-sync-approved`.

## Grants humanos (não bakear no CI)

### Specs (`protect-specs`)

Verify falha se o diff tocar specs protegidos **a menos que** um destes exista:

1. `ALLOW_SPEC_EDIT=1` (documentar no PR; **não** env permanente no CI)
2. `allowSpecEdit: true` no config (default **false**; config commitada)
3. Label de PR **`specs-approved`** — o workflow exporta `ALLOW_SPEC_EDIT=1` só nesse caso

### Deps (`deps-lock`, quando presente)

1. `ALLOW_DEPS_EDIT=1`
2. `allowDepsEdit: true` no config (default **false**; config commitada)
3. Label de PR **`deps-approved`**

Pushes a `main` e PRs sem label continuam fail-closed no **working tree**.
Em evento `push` para `main`/`master`, protect-specs e deps-lock **não**
relitigam `origin/main...HEAD` (o merge já aconteceu). Labels de PR continuam
valendo só em `pull_request`. Detalhes:
[`ADR-spec-sync-drift.md`](./ADR-spec-sync-drift.md) e
[`ADR-phase2-deps-spec-review.md`](./ADR-phase2-deps-spec-review.md).

### Secrets (`secrets-scan`)

Não existe `ALLOW_SECRETS=1`. O gate falha em `.env` rastreado/`git add -f`,
PEM, tokens de alta confiança e dumps de PII em `features/` / `e2e/` /
`fixtures/`. Allowlist **nunca** isenta `.env` nem chaves privadas.

Escapes humanos (só falso-positivo de token/assignment/PII, visíveis no PR):

1. `gauntlet.config.json` → `secretsScan.allowPaths` (paths exactos)
2. `.gauntlet/allow-secrets-paths` (gitignored, local)

Agentes **não** adicionam entradas. Se o gate falhar, parem e perguntem.
Detalhes: [`ADR-secrets-privacy.md`](./ADR-secrets-privacy.md).

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
