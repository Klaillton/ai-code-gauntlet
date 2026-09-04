# Skill: spec-review

Use **before** `implement-feature` whenever the change introduces **new behavior**
(new scenarios, new endpoints, new domain rules, or material UX flows).

Act as a **devil's advocate**. Do not implement yet. Surface gaps for human
approval. Feed durable findings into `docs/generated/gaps.md` only after the
human agrees (or note them in the handoff for the human to approve into gaps).

## When to run

- Human asks for a new capability / feature / endpoint
- Existing Gherkin is thin or missing edge/error/security paths
- OpenAPI and scenarios disagree or leave room for interpretation

Skip only for pure refactors with **no** behavior change (still confirm with the
human if unsure).

## Inputs

- Draft or approved `.feature` files (or the human's prose intent)
- `openapi/openapi.yaml` if HTTP-visible
- Related `src/domain` + unit tests (read-only)
- Current `docs/generated/gaps.md` (context, do not invent product decisions)

## Checklist (devil's advocate)

Work the list. Mark each item **ok**, **gap**, or **n/a** with a one-line note.

### Behavior & edges

- [ ] Happy path is explicit and observable in domain language
- [ ] Empty / missing / whitespace inputs
- [ ] Boundary values (0, 1, max length, overflow)
- [ ] Idempotency / duplicate submits
- [ ] Concurrent or out-of-order actions (if relevant)
- [ ] Not-found / already-done / illegal state transitions
- [ ] Localization / timezone / clock skew (if relevant)

### Security & abuse

- [ ] Authn / authz assumptions stated (or explicitly out of scope)
- [ ] Injection / XSS / path traversal surfaces called out
- [ ] PII / secrets handling and logging redaction
- [ ] Rate limits / abuse (spam create, bulk delete)
- [ ] Test-only or admin routes are allowlisted with expiry, not product defaults

### Ambiguity & contract

- [ ] Vague words ("soon", "appropriate", "etc.") replaced or questioned
- [ ] `@op:<operationId>` tags planned for every product HTTP operation
- [ ] OpenAPI status codes + schemas cover error paths the scenarios imply
- [ ] UI vs API ownership clear (what the human sees vs what HTTP returns)
- [ ] Non-goals listed so the agent does not invent scope

### Testability

- [ ] Acceptance scenarios stay free of CSS / `data-testid` / raw paths (D8)
- [ ] Domain rules can be unit-tested without HTTP
- [ ] Failures produce clear red before implementation

## Output (handoff)

Produce a short review for the human:

1. **Summary** — one paragraph of intent as you understand it
2. **Gaps / risks** — bullet list (edges, security, ambiguities)
3. **Questions** — decisions only a human should make
4. **Suggested scenario / OpenAPI deltas** — drafts only; do not edit protected
   specs without a protect-specs grant
5. **Approval ask** — explicitly request human go/no-go before coding

After approval, the human (or an agent with a protect-specs grant) updates
Gherkin/OpenAPI. Durable unresolved gaps belong in `docs/generated/gaps.md`
via `npm run docs:generate` once the inventory reflects them — do not hand-edit
generated docs.

## Stop conditions

- If the human has not approved the review → **do not** start `implement-feature`
- If specs must change → pause for protect-specs grant
- If deps must change → pause for deps-lock grant (`deps-approved` / `ALLOW_DEPS_EDIT=1`)
