# ADR-0002: app-identity-2 — grant = repo OWNER approve on the exact head SHA

## Status

Accepted — 2026-11-05 (design closed by Gate with Challenge for the 2026-11-11 batch; implemented 2026-11-20)

## Context

Every human grant in the kit (`policy-change-approved`, `deps-approved`, `specs-approved`,
`holes-approved`, `spec-sync-approved`) was a PR label, and `verify.yml` turned those labels
into `ALLOW_*` / `*_APPROVED` env flags. A label proves nothing about who decided:

- the agents' GitHub App (`klaillton-gauntlet-agents[bot]`) can add labels;
- the owner's token (`Klaillton`) is still shared with agents on the box, so a label or review
  "by Klaillton" may have been made by a bot;
- a label added for one commit keeps granting after new commits are pushed.

The first proposal (accept the label when the actor is not the App) was rejected: a bot using
the shared token adds the label as "Klaillton" and passes.

## Decision

1. **Grant = review APPROVED on the exact head SHA by the repo OWNER.** The review's
   `author_association` (reviews API) must be `OWNER`; `NONE`, `CONTRIBUTOR`, `COLLABORATOR`,
   `MEMBER` or a missing value never grant (fail closed). The repo is public, so any GitHub
   account can leave an APPROVED review that the API returns even though GitHub does not count
   it (Gate review, 2026-11-20). Agents never grant either: the App, any `*[bot]` /
   `type: Bot`, or `GAUNTLET_AGENT_LOGINS`. Read live from the GitHub API (PR, labels,
   reviews). The latest decisive review per login wins (`CHANGES_REQUESTED` / `DISMISSED`
   after an approval revokes it).
2. **Shared token = human-unattributed.** While a human's token is shared with agents, that
   login is listed in `GAUNTLET_SHARED_TOKEN_LOGINS` and its review **fails** with reason
   `human-unattributed` (no exception). After the token is revoked the login leaves the list and
   the same review passes. In this repo the workflows default the list to `Klaillton`
   (`vars.GAUNTLET_SHARED_TOKEN_LOGINS || 'Klaillton'`); after revoking the token a repo admin
   sets the Actions variable `GAUNTLET_SHARED_TOKEN_LOGINS` to `none`.
3. **Exact head only.** A review on an older SHA does not count, even when GitHub did not
   dismiss it. A run whose head is no longer the PR's live head fails (`head moved`).
4. **The label never grants alone.** It stays as the intent signal naming which grant is asked
   for; review without the matching label does not grant it either.
5. **Fail closed.** Missing token, missing PR context, API error or a direct push (no merged PR)
   = no grant.
6. **Env flags are local-only.** `ALLOW_SPEC_EDIT`, `ALLOW_DEPS_EDIT`, `HOLES_REVIEW_APPROVED`,
   `SPEC_SYNC_APPROVED`, `POLICY_CHANGE_APPROVED` still grant on a local run (non-authoritative
   fast check) and are ignored inside GitHub Actions. Base-committed `allow*` flags (CHANGE-4)
   are unchanged.

Implementation: `packages/gauntlet-gates/src/human-grant.ts` (synced to `scripts/`), used by
policy-base, deps-lock, protect-specs, holes-review and spec-code. Adversarial tests:
`tests/unit/app-identity-2.test.ts` (template + Todo):

1. label without review = FAIL
2. review from the App (or a listed agent) = FAIL
3. review on an older SHA = FAIL
4. approved review followed by a new commit = FAIL (and a stale run on the old head = FAIL)
5. review by a shared-token login on the head = FAIL `human-unattributed`; PASS after revocation
6. no label and no review = FAIL
7. APPROVED review from an outside account (`author_association` NONE / CONTRIBUTOR /
   COLLABORATOR / MEMBER / missing) on the head with the label = FAIL (Gate review, 2026-11-20)

## Consequences

- While `Klaillton` is in the shared list, **no PR that needs a human grant can go green** in
  CI. This is intended pressure to revoke the shared token (Challenge, 2026-11-05).
- `verify.yml` also runs on `pull_request_review` (submitted, dismissed). `policy-base.yml`
  stays on `pull_request_target`, which does not fire on reviews: approve first and then add
  the label (the `labeled` event re-runs it), or re-run the job.
- The push job of `policy-base.yml` still exports the legacy label-derived
  `POLICY_CHANGE_APPROVED` only so the pre-app-identity-2 base enforcer can judge the merge of
  this change (bootstrap); app-identity-2 enforcers ignore it inside Actions.
- Every gate run in CI makes a few read-only API calls with the job token (cached per process).

## Discarded

- Label accepted when the label actor is not the App (timeline API) — a bot holding the shared
  owner token adds the label as the owner and passes.
- Review by `Klaillton` passes with a note "unattributed" while the token is shared — circular:
  with a shared token the review is not proof of a human, and the exception would live forever.
- Any human login outside the agent list grants — on a public repo any GitHub account can
  approve; the API returns it even though GitHub does not count it (Gate review, 2026-11-20).
- Trust a review on an earlier SHA until GitHub dismisses it — depends on a ruleset setting the
  gate does not control.
