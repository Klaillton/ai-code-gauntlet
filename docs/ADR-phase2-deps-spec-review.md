# ADR: Phase 2 — deps-lock + spec-review

- **Status:** Accepted
- **Date:** 2026-09-03
- **Context:** AI Code Gauntlet kit (`Klaillton/ai-code-gauntlet`)
- **Related:** [ADR-spec-sync-drift.md](./ADR-spec-sync-drift.md)

## Decision

Ship the first Phase 2 honesty controls that do **not** require Stryker or
dependency-cruiser:

1. **deps-lock** — hard gate (same family as protect-specs)
2. **spec-review** — agent skill (process), run before `implement-feature`

Mutation testing and architectural drift remain a later overnight chunk.

## deps-lock

### Problem

Agents can hallucinate or casually bump dependencies. A changed
`package.json` / `package-lock.json` is a supply-chain and reproducibility
event; it must not land without a human grant.

### Rule

`scripts/deps-lock.ts` inspects `git diff` for `HEAD`, the index,
`origin/main...HEAD`, `main...HEAD`, and `GITHUB_BASE_REF` when CI sets it.

It **fails** when any of these change without a grant:

- kit root `package.json` / `package-lock.json`
- `examples/*/package.json` / `package-lock.json`
- `templates/*/package.json` / `package-lock.json`

(Standalone apps still match root-level `package.json` / lockfile.)

### Grants (human-only)

1. `ALLOW_DEPS_EDIT=1` (document in the PR; do **not** bake into CI permanently)
2. `.gauntlet/allow-deps-edit` (gitignored, local)
3. `allowDepsEdit: true` in `gauntlet.config.json` (default **false**)
4. GitHub PR label `deps-approved`

On `pull_request`, `.github/workflows/verify.yml` exports `ALLOW_DEPS_EDIT=1`
**only when** the PR has label `deps-approved`. Unlabeled PRs and pushes to
main stay fail-closed.

If git is unavailable, the gate records **info** and does not fail; agents
must still not edit dependency manifests.

### Wiring

- Gate id `deps-lock` in `examples/todo` and `templates/ts-node-web`
  `gauntlet.config.json`, after `protect-specs` and before `no-cheat`
- `npm run deps-lock` → `tsx scripts/deps-lock.ts`
- Report: `deps-lock-report.json` (gitignored); folded into `gauntlet-report.json`

## spec-review

### Problem

Inventory gates (D1–D9) catch structural drift. They do not force a devil's
advocate pass over edges, security, and ambiguities **before** coding.

### Rule

Add `.agent/skills/spec-review.md` (template + example). When new behavior is
requested, agents run **spec-review before implement-feature**. Output is a
handoff for human approval; durable gaps feed `docs/generated/gaps.md` after
the human agrees (via normal docs generate / inventory — do not hand-edit
generated docs).

Checklist covers: edges, security/abuse, contract ambiguity, testability
(D8-safe Gherkin). Stop if the human has not approved.

### Wiring

- Skill files under `examples/todo/.agent/skills/` and
  `templates/ts-node-web/.agent/skills/`
- `AGENTS.md` workflow updated to require spec-review for new behavior

## Consequences

- Dependency edits need an explicit human grant (label or env)
- New behavior work starts with a documented devil's-advocate review
- Stryker / complexity / dependency-cruiser stay out of this chunk
- Does not weaken D1–D9, protect-specs, or coverage floors

## Out of scope (next overnight)

- Stryker mutation / test-ownership freeze
- dependency-cruiser (domain must not import infra)
- Perf budgets / SBOM automation beyond this gate
