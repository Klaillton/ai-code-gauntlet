# ADR: arch-bound — domain must not import infra

- **Status:** Accepted
- **Date:** 2026-09-15
- **Context:** AI Code Gauntlet kit (`Klaillton/ai-code-gauntlet`)
- **Related:** [ADR-spec-sync-drift.md](./ADR-spec-sync-drift.md),
  [ADR-phase2-mutation-complexity.md](./ADR-phase2-mutation-complexity.md)

## Decision

Ship **`arch-bound`** as a fail-closed verify gate after `complexity` and before
`protect-specs`. Zero new npm dependencies. TypeScript compiler API (already
used by complexity/mutation) walks `src/domain` imports.

`src/domain` must not import:

- Relative infra: `src/api/**`, `src/web/**`, `src/server.ts`
- Modules: `hono`, `@hono/node-server`, `express`, `fastify`, `playwright`,
  `@playwright/test`, `@cucumber/cucumber`, `node:fs` / `fs`, `node:http` /
  `http`, `https`, `net`, `child_process`

Same-layer `./todo.js` imports are allowed. Official dependency-cruiser remains
optional later; this gate is the local, agent-runnable stand-in.

## Wiring

- `npm run arch-bound` → `tsx scripts/arch-bound.ts`
- Todo + template `gauntlet.config.json`
- Adopt CLI `HARDENING_GATE_IDS` + `ensureGate` after complexity
- Report: `arch-bound-report.json` (gitignored)

## Also in this slice

- Allowlist seed expiry renewed to **2027-06-02** (was 2026-12-02).
- `includeGitBranchDivergence()`: on GitHub `push` to `main`/`master`,
  protect-specs and deps-lock skip `origin/main...HEAD` so a merged PR is not
  re-litigated without labels.
