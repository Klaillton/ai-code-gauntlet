# Melhorias do AI Code Gauntlet

Documento vivo do roadmap. Origem: sessão 2026-09-15. Atualizado 2026-09-16.

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

### B1. Uma cópia dos scripts de gate

Todo e template duplicam `scripts/*`. Pacote interno `packages/gauntlet-gates`
(ou `file:` na raiz). Sem runtime dep externo.

### B2. Adapter Maven / Java

ADOPT.md: Camada 0 já existe. Template `java-spring` mínimo só se larfin/Spring
for o próximo consumidor.

### B3. Coverage floors

Hoje 80/80/70/80 em `src/**` (api/web/server excluídos). Subir **só domain**
para 90 depois de A1.

### B4. SBOM

Dependabot já existe. `npm sbom` / CycloneDX como **job CI extra**, não gate
local.

---

## Faixa C — secrets-scan follow-ups

Não inflar o regex agora. gitleaks adicional no CI só se ruído real. Globs
`*.yml` / `*.properties` quando houver adopt Java.

---

## Faixa D — Uncle Bob adiado de propósito

Gherkin-level mutation, differential mutation, Stryker oficial, QA procedures,
six-pack, Acceptance IR. Só depois de A1–A3.

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
B1 dedupe scripts
B3 coverage 90 no domain
B2 Java adapter              só se larfin/Spring
C  secrets follow-ups        só se ruído
D  Gherkin mutation / swarm  depois da faixa A
```
