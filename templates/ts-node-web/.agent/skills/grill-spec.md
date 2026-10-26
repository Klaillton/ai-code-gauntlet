# Skill: grill-spec

> Adapted from [`grilling`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/productivity/grilling/SKILL.md)
> in mattpocock/skills (commit `5beb35b`), MIT License, Copyright (c) 2026 Matt Pocock.
> Full notice at the end of this file. Gauntlet changes: output is a D12 holes-review
> draft plus spec-review suggestions; protected paths stay human-owned.

Use **before** `spec-review` / `implement-feature` when a human brings a new capability,
endpoint, or domain rule and the Gherkin / OpenAPI is thin, missing, or ambiguous.
Interview the human until every decision is settled. Do not implement.

## Rounds

Map the work as a **design tree**: every decision branches into the decisions that hang
off it. The **frontier** is every decision whose prerequisites are already settled.

1. Ask the whole frontier in one round. Number each question and give your recommended
   answer, worded so that "yes" accepts it:

   ```text
   Q1 - <title>: <question, options if any>
   Recommended: <answer>
   ```

2. Wait for the human's answers. Recompute the frontier and ask the next round. A
   question that depends on another open question belongs to a later round.
3. Facts are your job, decisions are the human's. Look up anything the repo can answer
   (existing `features/**`, `openapi/openapi.yaml`, `src/domain`, `docs/adr/**`,
   `docs/generated/gaps.md`) instead of asking. Never invent acceptance criteria.
4. Always probe the unhappy side: empty / missing input, boundaries, duplicates and
   idempotency, illegal state transitions, not-found, authn / authz, PII and secrets.
   Every `@op` needs happy plus at least one `@unhappy` / `@edge` scenario (D11).

The session is done when the frontier is empty and the human confirms a shared
understanding.

## Output

Write one draft, `docs/holes-review/<slug>.md`, with these four sections exactly, each
with real content (headers-only fails D12):

```markdown
# Holes review: <slug>

## Ambiguities

- <vague term or open decision, and the answer the human gave (or "open")>

## Contradictions

- <spec vs spec, spec vs code, or scenario vs OpenAPI conflict; or "none found" with what you checked>

## Missing AC

- <behavior the human wants that no scenario / OpenAPI response pins yet>

## Unhappy/edge

- <error, rejection, boundary, and edge paths per operation>
```

`docs/holes-review/**` is in `agent.protectedGlobs`. Do not commit the draft yourself
unless the human has granted protect-specs for this change; otherwise hand it over in
the conversation for the human to commit.

Then add the **spec-review** handoff (`.agent/skills/spec-review.md` → Output):
summary, gaps / risks, questions, and suggested Gherkin / OpenAPI deltas as drafts only.

## Do not

- Do not edit `features/**/*.feature`, `openapi/openapi.yaml`, or any path in
  `agent.protectedGlobs` without a human protect-specs grant.
- Never apply a grant label or set a grant env var yourself; grants are human-only.
- Do not start `implement-feature` from this skill.

## Handoff

End by asking the human for explicit approval of the holes review and the suggested
deltas. No approval, no implementation.

## Upstream license (MIT)

Adapted from mattpocock/skills. The upstream copyright and permission notice:

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
