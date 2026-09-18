# Melhorias do AI Code Gauntlet

Documento vivo do roadmap. Origem: sessão 2026-09-15. Atualizado 2026-09-18 (faixa D).

O kit prova a tese: disciplina em **gates fail-closed**, não em prompt. Não
empilhar tudo de uma vez — cada item é um PR independente.

## Status da faixa A

| Id | Item | Status |
|----|------|--------|
| A4 | Allowlist seed expiry → 2027-06-02 | **Feito** (#21) |
| A5 | Push `main` não relitiga `origin/main...HEAD` | **Feito** (#21) |
| A2 | `arch-bound` (domain sem HTTP/UI/fs) | **Feito** (#21) |
| A1 | Subir mutation threshold após medir kill score | **Feito** (CI 100% kill → floor 80%) |
| A3 | CRAP ≤ 8 em `src/domain` tocado | **Feito** (`scripts/crap.ts` após unit) |

## Já wired

- protect-specs, deps-lock, secrets-scan, no-cheat, spec-sync (D1–D3, D5–D8), D9
- complexity max 10 em `src/domain`
- arch-bound
- mutation custom 80% no Todo (template opt-in); CRAP ≤ 8 em domain tocado
- spec-review skill
- CI = `npm run verify`

---

## Faixa A (fechada)

### A1. Mutation 80%

CI `mutation-report.json` (main, 2026-09-16): **100%** kill, 7/7, 0 timeout.
Floor `mutation.threshold` **80%**. Template continua opt-in. Stryker oficial
fica na faixa D.

### A3. CRAP ≤ 8

`scripts/crap.ts` depois de unit+coverage. Fórmula
`complexity² × (1 − coverage)³ + complexity` por função em `src/domain` do
git diff. Sem diff: info. Sem `coverage-summary.json`: fail.

---

## Faixa B — kit engineering

| Id | Item | Status |
|----|------|--------|
| B1 | Fonte única `packages/gauntlet-gates` + sync/check | **Feito** |
| B3 | Coverage 90 no domain | **Feito** |
| B4 | SBOM CycloneDX job no CI | **Feito** |
| B2 | Adapter Maven / Java | **Adiado** — só se larfin/Spring for o próximo consumidor |

### B1. Uma cópia dos scripts de gate

`packages/gauntlet-gates/src` é a fonte. `npm run gates:sync` copia para Todo e
template; `gates:check` falha em drift (root verify + CI). Adopt copia do
pacote. Sem `file:` dep (quebraria `create` fora do clone). Ver
[ADR-gates-source.md](./ADR-gates-source.md).

### B2. Adapter Maven / Java

Camada 0 (premissas) já existe. Template `java-spring` **não** neste corte.

### B3. Coverage floors

`src/domain`: lines/functions/statements **90%**, branches **70%**.

### B4. SBOM

Job CI `sbom` gera CycloneDX para template e Todo e sobe artifact. **Não** é
gate local.

---

## Faixa C — secrets-scan follow-ups

| Id | Item | Status |
|----|------|--------|
| C1 | gitleaks job no CI (histórico; report redacted) | **Feito** |
| C2 | `.netrc` / `_netrc` forbidden-path | **Feito** |
| C3 | Inflar regex (concat, JWT, entropy) | **Não** — ruído |
| C4 | Globs Java `*.yml` / `*.properties` | Já cobertos no scan de tracked files; extra Java espera B2 |

gitleaks **não** substitui `secrets-scan` local. Config: `.gitleaks.toml`.

---

## Faixa D — Uncle Bob (honestidade de aceitação)

| Id | Item | Status |
|----|------|--------|
| D1 | Mutation diferencial (só domain do PR) | **Feito** |
| D2 | Gherkin-mutation no Todo após e2e | **Feito** |
| D3 | Skill `qa-procedures` (spot-check humano) | **Feito** |
| D4 | Playbook six-pack (`docs/six-pack.md`) | **Feito** (não é swarm) |
| D5 | Stryker oficial | **Adiado** — runner custom em 80%/100% kill |
| D6 | Acceptance IR / gerador de step defs | **Adiado** — espera segundo domínio |

Ver [ADR-gherkin-mutation.md](./ADR-gherkin-mutation.md).

---

## Faixa E — não fazer (ou por último)

SonarQube como gate principal; `enabled: false` / standing `ALLOW_*`;
gitleaks-only no lugar do scanner local; perf/ORM no Todo in-memory; “completar
D4” (o catálogo pula D4 de propósito).

---

## Ordem de PRs

```
A4 allowlist expiry          feito (#21)
A5 CI grants on main push    feito (#21)
A2 arch-bound                feito (#21)
A1 mutation threshold        feito (80%)
A3 CRAP on touched domain    feito
B1 dedupe scripts            feito
B3 coverage 90 no domain     feito
B4 SBOM CI job               feito
B2 Java adapter              adiado (larfin/Spring)
C  secrets follow-ups        feito (gitleaks CI extra; sem inflar regex)
D  Gherkin mutation / swarm  D1–D4 feitos; Stryker + IR adiados
```
