# Security Policy

## Escopo

Este repositório é um **kit** (CLI + gates + template + exemplo Todo), não um produto autenticado em produção.

O que este documento cobre:

- o kit em `Klaillton/ai-code-gauntlet` (`packages/`, `templates/ts-node-web`, `examples/todo`, CI)
- vazamento de secrets/PII no código e no histórico git
- enfraquecimento dos gates (verify, grants, workflows)

O que **não** cobre:

- apps gerados por `create-ai-gauntlet` / `adopt` depois que saem deste repo — cada app precisa da própria política
- ameaças de aplicação web “completas” (sessão, CSRF, TLS) que o SDD `docs/sdd/Security.md` só lista como requisito de presença (D15)

## Versões suportadas

Branch default: **`main`**. Correções de segurança entram só aí.

| Superfície                         | Suportada |
| ---------------------------------- | --------- |
| `main`                             | Sim       |
| Tags / releases pontuais           | Não (sem SLA de backport) |
| Branches de feature, forks, adopt  | Não       |
| Apps gerados a partir do template  | Responsabilidade do dono do app |

## Reportando uma vulnerabilidade

**Não abra uma issue pública** para secret vazado, bypass de `secrets-scan` / gitleaks, grant que desliga gate, ou RCE no CLI.

Use o reporte privado do GitHub:

1. Aba **Security** do repositório
2. **Report a vulnerability**
3. Descreva com o máximo de detalhe operacional

Inclua:

- superfície (`packages/create-ai-gauntlet`, `packages/gauntlet-gates`, `templates/ts-node-web`, `examples/todo`, workflow `verify.yml`, `.gitleaks.toml`)
- passos de reprodução ou PoC (sem colar o valor do secret no texto público do advisory)
- se o finding passa `npm run verify` local e/ou o job `gitleaks` da CI
- impacto (ex.: secret no histórico, agent consegue `ALLOW_*` sem label, SBOM/audit cego)

**Prazo esperado:** confirmação inicial em até 5 dias úteis.

Não divulgue em issue, PR ou gist até haver correção ou mitigação aceita.

Se o problema for um **secret já commitado**:

1. reporte em privado
2. não abra PR que só “apaga a linha” — o histórico continua sujo
3. rotação do credencial é do dono do secret; este repo não tem vault

## O que o kit realmente implementa

Isto está no tree atual (`main`):

### Gates locais (`npm run verify`)

Ordem relevante (após `protect-specs` / `deps-lock`):

- **`secrets-scan`** — fail-closed, zero dep extra, **sem** `ALLOW_SECRETS`
  - conjunto: tracked/staged (`git ls-files`, inclusive `git add -f`) + untracked não-ignorado
  - `.env` local gitignored **não** falha; `.env` tracked / `git add -f` **falha**
  - reports não ecoam o valor do secret (`path` + `rule` + `line`)
  - PII de alta confiança só em `features/` / `e2e/` / `fixtures/`
  - allowlist humana: `gauntlet.config.json` → `secretsScan.allowPaths` ou `.gauntlet/allow-secrets-paths` (gitignored)
  - allowlist **não** dispensa `forbidden-path` / PEM
- **`deps-lock`** — manifesto de dependência é grant humano (`ALLOW_DEPS_EDIT` / label `deps-approved` no PR)
- **`protect-specs`** — Gherkin + OpenAPI humanos (`ALLOW_SPEC_EDIT` / `specs-approved`)
- **`policy-base`** (CHANGE-4, primeiro passo built-in do verify) — política lida do **base**; mudança em `gauntlet.config.json` (exceto add/alter de `contract.cases`), `scripts/**`, configs de teste/mutação, `tsconfig*.json`, `eslint.config.*`, `.eslintrc*` ou qualquer coisa em `.github/**` na raiz (workflows, composite actions, CODEOWNERS, dependabot.yml) exige `POLICY_CHANGE_APPROVED` / label `policy-change-approved`. **Enforcer autoritativo roda do base**: workflow `.github/workflows/policy-base.yml` (`pull_request_target` + push em main) faz checkout do base, instala deps do base (`npm ci --ignore-scripts`), busca o head só como dado (`git fetch origin refs/pull/<n>/head`, sem checkout/`npm ci`/execução) e roda o `scripts/policy-base.ts` do base com `--head <sha>`; em push, `git worktree` em `github.event.before`. O policy-base dentro do `npm run verify` é só check local rápido (é código do head). Residual: o grant ainda não é verificável como humano (agentes usam a identidade do owner) e o job só bloqueia de verdade quando for status required no ruleset (pendente da decisão de identidade) — ver ADR
- **`arch-bound`** — `src/domain` sem HTTP/UI/fs
- **`no-cheat`** — skip/only, gate desligado, piso rebaixado

Detalhe normativo: `docs/ADR-secrets-privacy.md`.

### CI (Phase 3 — não substitui verify local)

Workflow `.github/workflows/verify.yml` em push para `main`/`master`, em todo PR (qualquer base, inclusive eventos `labeled`/`unlabeled`) e via `workflow_dispatch`:

- **gitleaks** `detect` no histórico completo (`fetch-depth: 0`), report redigido, config `.gitleaks.toml`
- **SBOM** CycloneDX do template e do Todo (artifact)
- **npm audit** com `--audit-level=critical` no template e no Todo
- **gates-sync** — scripts canônicos em `packages/gauntlet-gates` não divergem
- verify do template, do Todo e smoke `create` + verify

Permissions do workflow (nível do workflow, sem override por job): `contents: read` + `actions: write` + `pull-requests: read` (CHANGE-4: em push lê a label `policy-change-approved` do PR mergeado).

Workflow `.github/workflows/policy-base.yml` (CHANGE-4, enforcer do base): `pull_request_target` (opened, synchronize, reopened, labeled, unlabeled) + push em `main`/`master`. Permissions exatamente `contents: read` + `pull-requests: read`, sem secrets, `persist-credentials: false`, número do PR e SHAs só via `env` (nada controlado pelo head interpolado em `run:`), nenhum código do head executado. Bootstrap: o PR que introduz o CHANGE-4 (#61) não é coberto por esse job (o workflow ainda não existe no base); a label humana `policy-change-approved` no #61 é o grant de bootstrap. PRs de fork e do Dependabot sob `pull_request_target` recebem token read-only e nenhum secret (o job não usa); esse caminho só é exercitado depois do merge do #61 e o Nightly confirma no primeiro PR do Dependabot. Bumps do Dependabot do ecossistema github-actions tocam `.github/**` e por isso sempre exigem `policy-change-approved` — intencional. `.prettierrc` fica fora do CHANGE-4 de propósito (só formatação).

### Supply chain / ownership

- Actions pinadas por SHA no `verify.yml` e no `policy-base.yml`
- Dependabot **version updates**: somente `github-actions` na raiz, weekly, máx. 5 PRs (`.github/dependabot.yml`)
- Dependabot **security updates** ligados nas settings do repo: alerta npm → PR de lockfile no template/Todo. Esses PRs passam pelo `deps-lock` como qualquer outro (label `deps-approved`). **Não** há version update de npm
- CODEOWNERS em specs, `package.json` / lockfiles dos apps do kit, e `.github/workflows/**`

### SDD (presença, não hardening)

`docs/sdd/Security.md` (D15) exige heading + ≥1 requisito. Qualidade do texto não é gate. Requisitos atuais do SDD:

- autenticar APIs que mutam
- não logar secret / PII
- deny-by-default em rota desconhecida

O exemplo Todo é in-memory + API fina. Não trate isso como auth de produção.

## O que NÃO está implementado (não invente na policy)

- HTTPS/TLS, rate limit, brute-force no “login” (não há form login neste kit)
- Spring Security, BCrypt, roles, CSRF, Flyway, S3, Docker user `brewer`
- Dependabot version updates de npm (só security updates) e qualquer coisa Maven
- OSSAR / CodeQL / secret scanning nativo do GitHub como gate documentado aqui (CodeQL default setup está ligado nas settings e abre alertas, mas não é required check nem gate do kit)
- Scan de ofuscação (`"AKIA" + "…"`, JWT genérico) no `secrets-scan` local
- SLA de CVE em apps adoptados

## Práticas esperadas de quem contribui ou adopta

1. Nunca commitar `.env`, PEM, `.netrc`, `sk_live_`, `AKIA…`, `ghp_`, `github_pat_`.
2. Fixture e Gherkin: dados sintéticos (`example.com`, telefones `555`). CPF/CNPJ real falha o gate.
3. Agent não adiciona `secretsScan.allowPaths`. Para se humano.
4. Não desligar gate no `gauntlet.config.json` para “ficar verde”.
5. Grants (`ALLOW_SPEC_EDIT`, `ALLOW_DEPS_EDIT`, labels `*-approved`) são humanos. Workflow que afrouxa isso é mudança de segurança — CODEOWNERS em `.github/workflows/**`.
6. App gerado: copie esta política e **apague** o que for só do kit; adicione auth/TLS do *seu* runtime.

## Referências no repo

- `docs/ADR-secrets-privacy.md`
- `docs/PREMISES.md` (item secrets-scan + Phase 3)
- `docs/sdd/Security.md`
- `.gitleaks.toml`
- `.github/workflows/verify.yml`
- `.github/workflows/policy-base.yml`
- `.github/dependabot.yml`
- `.github/CODEOWNERS`
- `examples/todo/AGENTS.md` / `templates/ts-node-web/AGENTS.md` (seção secrets)
