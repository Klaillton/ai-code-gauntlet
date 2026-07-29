# O “filtro” do Uncle Bob para código gerado por IA

Pesquisa sintética das práticas que **Robert C. Martin (Uncle Bob)** propõe/usa para que código de agentes de IA seja considerado válido. Fontes: `empire-2025` (AGENTS.md + tooling), `Acceptance-Pipeline-Specification`, série *Clean AI: Agentic Discipline* (Clean Coders), posts em X (jul/2026), e formalizações da comunidade (DAE / swingerman).

**Tese central:** não confiar na “inteligência” do agente; **cercá-lo de constraints determinísticos** (specs + métricas + testes em múltiplas camadas). O humano deixa de ser revisor linha a linha do código e vira dono do **comportamento esperado** e do **gauntlet de verificação**.

> “My current strategy is to not read any of the code written by my agents. […] What I do instead is to surround the agents with extreme constraints.” — Uncle Bob

---

## 1. Princípio: o que o humano revisa vs. o que a máquina verifica

| Artefato | Quem escreve | Quem revisa / valida |
|---|---|---|
| Código de produção | Agente | **Ninguém** (por design) |
| Unit tests | Agente | **Ninguém** (por design) — qualidade via mutation |
| Gherkin / acceptance tests | Agente (co-autoria) | **Humano** (full ou spot check, conforme criticidade) |
| QA procedures (perspectiva humana/UI) | Agente | **Humano** (spot check) |
| Exploratory testing final | — | **Humano** (juiz final) |

**Não é “vibe coding”.** É: *não leio o código para não matar a produtividade; leio/defendo as specs e deixo o gauntlet provar o resto.*

**Nota de calibragem (do próprio Bob):** empilhar *todos* os tipos de teste em *toda* tarefa pode ser overkill. Ele admite: *“Lots of times I just use unit tests and crap.”* A profundidade do pipeline escala com **criticidade**.

---

## 2. O gauntlet completo (camadas de filtro)

Ordenado do “o quê o sistema deve fazer” até “as provas são honestas”:

### Camada A — Spec-Driven Design (SDD) / ATDD

1. **Intent / stories** informais → formalizados.
2. **Acceptance Criteria** em linguagem de domínio (sem vazamento de implementação).
3. **Gherkin / Given-When-Then** como contrato executável de comportamento.
4. **Regra de ouro:** specs descrevem *o que* o sistema faz, não *como* (nada de `UserService`, `/api/users`, `users table`).
5. Humanos **aprovam e defendem ferozmente** as specs (“Specs will be co-authored… final approval ferociously defended by the humans”).

### Camada B — Acceptance Pipeline (não é Cucumber “puro”)

Pipeline portátil que Bob formalizou:

```
Gherkin feature
  → parser → JSON IR (ou EDN no empire-2025)
  → (opcional) IR-DRY checker (duplicatas / sinônimos de steps)
  → generator → testes de aceitação executáveis
  → project test runner
```

- Gerador + handlers têm **conhecimento profundo do projeto** (híbrido estranho de Cucumber + fixtures).
- Acceptance mutation (mutar *valores de exemplo do Gherkin no IR*) verifica se os dados do cenário estão de fato ligados à app — se mudar “bob@example.com” e o teste ainda passar, o teste é teatro.

### Camada C — TDD estrito (unit stream)

Workflow no `AGENTS.md` do empire-2025:

1. Novo comportamento → **cenários de aceitação** (perguntar antes de alterar existentes).
2. Confirmar que **falham** (red).
3. Escrever **unit tests falhando** e implementar até ambos os streams passarem.
4. **Dois streams em paralelo:** acceptance (WHAT) + unit (HOW).  
   > “The two different streams… [prevent] willy-nilly plop code around and write a unit test for it.”

### Camada D — Métricas de qualidade / “não deixe a IA se enrolar”

| Ferramenta / métrica | Papel no filtro | Threshold típico (Bob) |
|---|---|---|
| **CRAP** (Change Risk Anti-Patterns / Predictions) | Complexidade ciclomática × (falta de) cobertura | **≤ 8** por módulo alterado; refatorar até passar |
| **Coverage** | Gate de cobertura | “very high 90s” |
| **Tamanho / complexidade de módulo** | Evitar monólitos que agentes não conseguem desenrolar | Ex.: módulos com >50 mutation sites → split |
| **Structure check** (ex. `speclj-structure-check`) | Forma dos testes unitários | Antes de rodar specs alterados |
| **Dependency / architecture boundaries** | Camadas, ciclos, acesso proibido | Checks no CI (`dependency-checker`, boundary scripts) |
| **DRY / duplicate detection** | Cleaner agent | Refatorar até satisfazer |

**Sobre SonarQube:** Bob **não** centra o discurso em SonarQube. O papel análogo no stack dele é **CRAP + coverage + complexity + arch boundaries** — métricas *acionáveis* pelo agente (refatorar até o número), não só “quality gate de dashboard”. SonarQube *pode* servir como implementador de parte disso (complexity, smells, coverage), mas **não é a peça que ele prega**; CRAP + mutation são.

### Camada E — Mutation testing (firewall semântico)

Terceira validação, depois de acceptance e unit:

1. **Language-level mutation** — muta o código de produção; testes devem falhar (kill mutants).
2. **Gherkin-level mutation** — muta exemplos no IR de aceitação.
3. **Differential mutation** — só re-muta funções cujo código, testes cobridores ou set de operadores mudou (manifest).
4. Survivors → escrever testes até matar.

Isso responde: *“como confiar em unit tests que eu não leio?”* — mutation, não review humano.

### Camada F — QA procedures + exploratory

- Specifier gera **procedimento de QA manual/UI** em perspectiva humana.
- QA agent (ou pipeline) **automatiza** esses procedimentos (scripts que dirigem a UI).
- Jitter / concurrency tests se houver threads/race.
- **Humano** faz exploratory testing final: *“My exploratory testing is the final judge.”*

### Camada G — CI/CD como execução do gauntlet

Do próprio Bob (X, jul/2026): agents + CI/CD só fazem sentido se o pipeline:

- roda mutation e mata survivors;
- mede complexidade e reduz até threshold;
- aplica quality standards rígidos;
- inclui procedimentos de QA automáticos;
- **não** assume “código de agent sem gauntlet = merge”.

---

## 3. Pipeline multi-agente (“six-pack” / Swarm Forge)

Da série *Agentic Discipline* (Clean Coders) e posts recentes:

| # | Papel | O que faz | Gate de saída |
|---|---|---|---|
| 1 | **Specifier** | Stories → Gherkin + QA procedures manuais | Specs legíveis/aprováveis |
| 2 | **Coder** | Implementa + unit tests + harness de aceitação | Ambos streams green |
| 3 | **Cleaner** | DRY + CRAP até thresholds | CRAP ≤ 8, sem lixo estrutural |
| 4 | **Architect** | Módulos, grafo de dependências, property-based tests | Arquitetura limpa / boundaries |
| 5 | **Hardener** | Mutation (código + Gherkin) | Mutants mortos / cobertura semântica |
| 6 | **QA** | Automata QA procedures, executa na UI | Comportamento esperado no UI |

Cada agente em worktree isolada; handoffs estruturados; **menos interação humana a cada estágio** (humano pesa mais no início: specs/QA intent).

Treinees (ideia recente do Bob): passar um ano rodando *cada* papel do six-pack para aprender a *dirigir* agents.

---

## 4. Workflow mínimo “empire-2025” (receita operacional)

Do `AGENTS.md` real:

1. Novo/alterado comportamento → acceptance scenarios (pedir permissão para mudar existentes).
2. Confirmar red nos acceptance.
3. Unit tests red → green até acceptance green.
4. Structure-check nos specs alterados.
5. **CRAP** em cada módulo alterado → refatorar até **≤ 8**.
6. **Differential mutation** módulo a módulo; cobrir uncovered sites; matar survivors.
7. Nunca rodar CRAP e mutate em paralelo com outros comandos pesados.
8. Boundaries de arquitetura (ex.: AI do jogo não pode ler `game-map`, só `computer-map`).
9. Acceptance `.txt`/Gherkin **nunca** alterados pelo agent sem permissão explícita.

---

## 5. Mapa “o que você citou” → posição do Uncle Bob

| Prática / ferramenta | É do Bob? | Papel |
|---|---|---|
| **TDD** | Sim, central | Stream unit; red-green obrigatório |
| **BDD / Gherkin / ATDD** | Sim, central | Stream acceptance; contrato de comportamento que o humano defende |
| **Mutation testing** | Sim, central | Firewall sobre testes que o humano *não* lê |
| **CRAP metric** | Sim, central | Complexidade × cobertura; gate ≤ 8 |
| **Coverage alta (90%+)** | Sim | Parte do CRAP e do discurso de semantic stability |
| **Clean Code / SOLID / small functions** | Sim (agora *enforced* por tools) | Constraints *antes* do mess; agents se enrolam em código sujo |
| **Architecture boundaries / dependency rules** | Sim | Checks determinísticos no projeto |
| **QA procedures + exploratory** | Sim | Camada humana final |
| **Multi-agent pipeline** | Sim (2025–26) | Specifier → Coder → Cleaner → Architect → Hardener → QA |
| **SonarQube** | **Não é o foco** | Pode implementar *parte* dos gates (complexity, smells, coverage), mas o stack canônico dele é CRAP + mutation + ATDD pipeline, não “Sonar quality gate” |
| **Code review linha a linha** | **Rejeitado como gate principal** | Substitído por specs + gauntlet; review pontual/global sob demanda |
| **Property-based tests** | Usado (Architect agent) | Complemento |
| **Cucumber clássico** | Parcial | Pipeline *inspirado*, mas gerador com deep project knowledge (não step defs manuais genéricos) |

---

## 6. O “filtro de validade” em uma checklist prática

Código de IA só é **válido** se passar (conforme criticidade):

- [ ] **Spec humana aprovada** (Gherkin/ACs em linguagem de domínio, sem leakage)
- [ ] **Acceptance red → green** (pipeline parse → IR → generate → run)
- [ ] **Unit stream green** (TDD; structure check)
- [ ] **Ambos streams de acordo** entre si e com o código
- [ ] **CRAP ≤ 8** (ou threshold do projeto) em módulos tocados
- [ ] **Coverage** no patamar alto do projeto
- [ ] **Mutation:** survivors mortos (código ± Gherkin IR, conforme pipeline)
- [ ] **Arch/dependency boundaries** intactos
- [ ] **QA procedures** (pelo menos spot-checked) e, se UI, scripts de QA green
- [ ] **Exploratory humano** como juiz final em features críticas

Se falhar qualquer gate **determinístico**, o agent **não discute** — corrige. Discipline vive em **tools**, não em “prompt rules que erodem”.

---

## 7. O que *não* é a proposta dele

- Confiar no agent “porque o código compila”.
- Code review humano de *todo* o diff como único safety net.
- Unit tests escritos pelo agent sem mutation (testes que passam sem provar nada).
- Specs cheias de detalhes de implementação.
- Empilhar 6 tipos de teste em *todo* commit trivial (ele mesmo calibra).
- Substituir engenharia por vibe: *“AI plops code around”* é o anti-padrão explícito.

---

## 8. Fontes primárias para aprofundar

| Fonte | O que contém |
|---|---|
| [unclebob/empire-2025](https://github.com/unclebob/empire-2025) + `AGENTS.md` | Workflow real, CRAP ≤ 8, differential mutation, acceptance pipeline |
| [unclebob/Acceptance-Pipeline-Specification](https://github.com/unclebob/Acceptance-Pipeline-Specification) | Gherkin → JSON IR → generator; Gherkin mutation |
| Clean Coders: *Clean AI: Agentic Discipline* (ep. 6 Swarm Forge) | Specifier/Coder/Cleaner/Architect/Hardener/QA |
| Tools: `crap4clj`, `clj-mutate`, `speclj-structure-check` | Implementações dele das métricas |
| X @unclebobmartin (jul/2026) | “I don’t read unit tests / I do read Gherkin & QA”; semantic stability |
| Comunidade: `swingerman/disciplined-agentic-engineering` | Empacota ATDD + mutation + charter gates no espírito empire-2025 |

---

## Resposta em uma frase

O filtro do Uncle Bob **não é SonarQube** — é um **gauntlet de constraints**: **ATDD/Gherkin (humano defende) + TDD unit (dois streams) + CRAP/complexity/coverage + mutation (código e specs) + QA procedures + exploratory humano**, orquestrado por um pipeline multi-agente, com profundidade calibrada pela criticidade.

---

## 9. Sua proposta: Cucumber + Playwright + stack TS (análise)

### 9.1 Fluxo proposto

```
1. Escrever Feature (Gherkin)
2. Escrever cenários
3. Escrever testes Playwright
4. IA implementa
5. IA corrige até todos passarem
```

### 9.2 Stack proposta

| Camada | Ferramenta | Papel |
|---|---|---|
| Spec funcional | Cucumber (Gherkin) | Contrato de comportamento (WHAT) |
| E2E / UI / API | Playwright | Execução real (browser + request) |
| Unit | Vitest ou Jest | HOW interno (funções, hooks, pure logic) |
| Contrato HTTP | OpenAPI | Schema request/response, breaking changes |
| Estática | ESLint + Prettier + TypeScript | Forma, tipos, style |
| Cobertura | Coverage threshold (CI) | Gate mínimo |
| Implementação | Agente de IA | Código de produção + (idealmente) unit |
| Orquestração | Pipeline até 100% green | Loop red→green |

### 9.3 É possível?

**Sim — totalmente viável** e já é um padrão maduro na indústria (BDD + Playwright + contract tests + unit + lint).

Referências de encaixe real:

- **@cucumber/cucumber** + **Playwright** (step defs chamam page objects / `page.goto`, `expect`).
- Playwright também cobre **API** via `request` fixture (não só UI).
- **OpenAPI** → validação com spectral / openapi-typescript / contract tests no CI.
- **Vitest/Jest** com coverage thresholds no `vitest.config` / Jest.
- Agent loop: “implemente até `npm test` + `npm run e2e` + lint passarem” é o padrão de agentic coding com hooks/CI.

Nada disso exige inventar ferramenta nova. O difícil não é a stack — é a **disciplina dos gates** e **quem escreve/aprova o quê**.

### 9.4 Vale a pena?

**Sim, com ressalvas.** É um dos melhores “filtros pragmáticos” para apps web/TS. Alinha bem com a tese do Uncle Bob (cercar o agent de constraints), **mas** a proposta atual tem buracos que o Bob trataria como críticos.

#### O que está forte

| Ponto | Por quê vale |
|---|---|
| Gherkin primeiro | Humano defende o comportamento; agent não inventa o “done” |
| Playwright E2E | Prova o sistema real (UI + fluxos); Bob tem camada “QA/UI” equivalente |
| Playwright API | Complementa OpenAPI com comportamento runtime |
| OpenAPI | Contrato estável entre front/back; IA não pode “mudar a API no silêncio” sem quebrar o gate |
| Unit (Vitest/Jest) | Segundo stream (HOW) — essencial no modelo dos “dois streams” |
| TS + ESLint + Prettier | Constraints de forma *antes* do mess (análogo parcial a Cleaner) |
| Coverage mínima | Gate barato e acionável |
| Loop até green | O agent *não discute* com o CI |

#### O que falta ou é arriscado (em relação ao gauntlet do Bob)

| Risco | Problema | Mitigação recomendada |
|---|---|---|
| **Passo 3 antes da implementação** | Playwright escrito cedo demais vira “testes de seletor/DOM”, não de domínio — leakage de implementação | Manter **Gherkin estável**; step defs/Playwright podem ser **esqueleto falhando** ou gerados *depois* da UI estabilizar; page objects finos |
| **“100% dos testes passam” ≠ qualidade** | Agent pode enfraquecer asserts, hardcode, ou apagar cenários | **Proibir** o agent de alterar Feature/cenários sem aprovação humana (regra do empire-2025); mutation testing opcional em unit |
| **Sem mutation / CRAP** | Unit tests fracos passam; complexidade explode | Fase 2: Stryker/mutmut-like + métrica de complexidade (ou Sonar/CRAP-like) em módulos tocados |
| **Cucumber + Playwright “gordo” em tudo** | E2E é lento e frágil; overkill para lógica pura | Pirâmide: **muitos unit**, **alguns API contract**, **poucos E2E** críticos |
| **Quem escreve unit tests?** | Se só o agent escreve unit *e* implementação sem gate extra, stream fraco | Agent escreve unit; coverage + (idealmente) mutation; humano *não* precisa ler unit se mutation/CRAP existirem |
| **OpenAPI só como doc** | Se ninguém valida request/response contra o schema no CI, o contrato é teatro | Gate: spectral + testes de contrato (Pact ou assert schema nas respostas Playwright API) |
| **Loop infinito “até passar”** | Agent pode trapacear (skip, `.only`, flaky retries) | CI rejeita skip/fixos, flaky quota zero em main; max N iterações depois falha e pede humano |
| **Sem exploratory final** | UI “passa” e UX está errada | Spot check humano em features críticas (Bob: juiz final) |

### 9.5 Fluxo recomendado (ajustado — “Uncle Bob × sua stack”)

Mais seguro e ainda automatizável:

```
0. Humano: intent / ACs em linguagem de domínio
1. Humano (+ IA rascunha): Feature.feature  ──► HUMANO APROVA (ferozmente)
2. Cenários Gherkin (happy + edge + error + security)  ──► HUMANO APROVA
3. OpenAPI: endpoints/schemas da feature  ──► diff de contrato revisado
4. RED gates preparados:
   a. Step defs Cucumber → Playwright (UI e/ou API) — podem falhar (app não existe)
   b. Unit specs esqueleto (Vitest) para regras de domínio
   c. Contract checks OpenAPI
5. IA implementa (código + completa unit) sob TDD quando possível
6. Pipeline automático (loop):
   lint/typecheck → unit → contract/OpenAPI → cucumber/playwright
   até tudo green OU max iterations
7. Gates de qualidade (não só “passou”):
   coverage ≥ N%  |  sem skip  |  (fase 2) mutation / complexity
8. Humano: spot check Gherkin + exploratory rápido na UI
```

**Diferença crítica vs. sua lista de 5 passos:**  
o passo “escrever Playwright” **não deve congelar seletores/DOM cedo** como se fossem a spec. A **spec é o Gherkin**. Playwright é o *driver* que prova o Gherkin. Se a IA reescrever page objects durante a implementação, ok — **desde que os cenários Gherkin não mudem sem você**.

### 9.6 Quem escreve o quê (regra operacional do agent)

| Artefato | Humano | IA |
|---|---|---|
| Feature + cenários Gherkin | **Aprova / defende** | Rascunha |
| OpenAPI da feature | **Aprova breaking changes** | Propõe e implementa |
| Step defs / page objects Playwright | Spot check se frágil | Escreve/ajusta |
| Unit tests | Não precisa ler se houver mutation/coverage | Escreve |
| Código de produção | Não precisa ler linha a linha | Escreve |
| ESLint/TS config | Define uma vez | Obedece |
| Alterar `.feature` existentes | **Só com permissão explícita** | Proibido por default |

### 9.7 Pirâmide de testes (para não quebrar o pipeline)

```
        /\
       /E2E\          poucos: fluxos críticos (login, checkout, …) — Cucumber+Playwright UI
      /------\
     / API E2E\       médios: Playwright request + OpenAPI schema
    /----------\
   /   Unit     \     muitos: Vitest — regras, pure functions, hooks
  /--------------\
```

**Não** coloque 100% da confiança em Cucumber+Playwright UI. É o stream mais caro e instável. Bob usa acceptance + unit; E2E UI é a camada QA, não o único filtro.

### 9.8 Mapa: sua stack ↔ gauntlet do Bob

| Bob | Sua stack | Status |
|---|---|---|
| Gherkin / ATDD | Cucumber | ✅ Excelente |
| Acceptance runner | Playwright (UI+API) via step defs | ✅ Bom (é mais “QA/E2E” que o IR custom dele, mas serve) |
| Unit TDD | Vitest/Jest | ✅ |
| Cleaner (CRAP/DRY) | ESLint + TS (+ Sonar/complexity fase 2) | ⚠️ Parcial |
| Mutation | — | ❌ Falta (fase 2) |
| Coverage | Threshold CI | ✅ |
| Spec protection | — | ⚠️ Precisa de regra no AGENTS.md |
| QA procedures | Gherkin E2E + exploratory | ✅ Parcial |
| OpenAPI | OpenAPI | ✅ Extra valioso (Bob não enfatiza; você ganha em APIs) |

### 9.9 Veredito

| Pergunta | Resposta |
|---|---|
| **É possível?** | **Sim.** Stack padrão, pipeline automatizável, agent loop viável. |
| **Vale a pena?** | **Sim**, para apps web/TS com UI e API — especialmente se você for o “Specifier” (dono do Gherkin/OpenAPI) e a IA for o “Coder+Cleaner”. |
| **É o gauntlet completo do Bob?** | **Não ainda** — falta mutation, métrica de complexidade/CRAP-like, e proteção explícita das specs. Mas é um **MVP excelente** do mesmo espírito. |
| **Maior armadilha** | Tratar “todos os testes verdes” como prova de correção **e** deixar a IA alterar Gherkin/OpenAPI livremente. |
| **Maior alavanca** | Gherkin + OpenAPI **human-approved**, Playwright como executor, unit em volume, CI com coverage/lint, loop com teto de iterações. |

### 9.10 MVP vs. fase 2 (quando for criar o agent)

**MVP (vale começar assim):**

1. Cucumber features (humano aprova).
2. Playwright step defs (UI críticos + API).
3. Vitest unit + coverage mínima.
4. OpenAPI + validação no CI.
5. ESLint + Prettier + `tsc --noEmit`.
6. Agent: implementa; **não** edita `.feature` sem flag; loop até green (max N).
7. Script único: `npm run verify` = lint + typecheck + unit + contract + e2e.

**Fase 2 (quando o MVP mentir com testes fracos):**

- Mutation (Stryker) em unit.
- Complexity budget / Sonar quality gate / CRAP-like.
- Gherkin DRY check (cenários duplicados).
- Differential E2E (só cenários impactados).
- Charter/AGENTS.md estilo empire-2025.

### 9.11 Resposta direta

> **Sim, é possível e vale a pena** — desde que o Gherkin (e o OpenAPI) sejam o contrato que *você* defende, o Playwright seja o *executor* (não a spec), a pirâmide de testes seja respeitada, e “100% green” seja só o **primeiro** gate, não o único. Sua stack é um ótimo backbone para um agent disciplinado em TypeScript; complete depois com mutation/complexity se quiser chegar ao nível do filtro do Uncle Bob.

---

## 10. Escopo do agent a criar (quando sair do plan mode)

Quando for implementar o agent / template de projeto, o entregável sugerido é:

1. **Template de repo** (ou skills/AGENTS.md) com:
   - pastas `features/`, `e2e/`, `src/`, `openapi/`
   - scripts `verify`, `test:unit`, `test:e2e`, `lint`, `typecheck`
   - regras: IA não altera `.feature` sem permissão; max iterações do loop
2. **Workflow documentado** (os 8 passos da §9.5)
3. **CI** com os gates do MVP
4. (Opcional) hooks do agent que rodam `verify` após cada mudança

---

## Próximo passo

Isto continua como **design / pesquisa**. Quando aprovar e quiser construir:

- **A)** Scaffold do projeto TS (Cucumber + Playwright + Vitest + OpenAPI + AGENTS.md)
- **B)** Só o `AGENTS.md` + skills do agent (sem app de exemplo)
- **C)** Mapa de CI (GitHub Actions) do pipeline `verify`

Diga A, B, C ou um mix após aprovar o plano.
