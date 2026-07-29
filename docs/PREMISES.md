# Premissas do AI Code Gauntlet

Stack-agnostic. Discipline lives in **gates and tools**, not prompt politeness.

## Tese

Não confiar na “inteligência” do agente. Cercá-lo de **constraints determinísticos**:

1. **Comportamento** em Gherkin (humano defende)
2. **Contrato HTTP** em OpenAPI (humano aprova breaking changes)
3. **Dois streams de teste**: unit (HOW) + acceptance (WHAT)
4. **Forma estática**: lint, format, types
5. **Pipeline único** (`verify`) local e no CI
6. Agent **não** reescreve specs para ficar green

## Quem escreve o quê

| Artefato | Humano | Agente |
|----------|--------|--------|
| Feature + cenários Gherkin | Aprova / defende | Rascunha |
| OpenAPI (breaking) | Aprova | Propõe |
| Unit tests | Não precisa ler se coverage/mutation | Escreve |
| Código de produção | Spot check / exploratory | Escreve |
| Drivers E2E (steps) | Spot se frágil | Escreve/ajusta |

## Pirâmide

```
        /\
       /E2E\      poucos fluxos críticos
      /------\
     /Contract\   OpenAPI + checks runtime
    /----------\
   /   Unit     \ muitos (domínio)
  /--------------\
```

## O que o MVP prova

- Cucumber + Playwright (acceptance)
- Vitest + coverage floors (unit)
- OpenAPI contract checks
- ESLint + Prettier + TypeScript
- `AGENTS.md` + skills
- CI = mesmos gates

## Fase 2 (opcional, qualidade semântica)

- Mutation testing
- Complexity / CRAP-like budget
- Gherkin leakage / DRY linter

Ver [original-plan.md](./original-plan.md) para o mapa completo Uncle Bob × stack TS.
