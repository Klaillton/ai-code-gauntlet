# Skill: review-two-axis

> Adapted from [`code-review`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/code-review/SKILL.md)
> in mattpocock/skills (commit `5beb35b`), MIT License, Copyright (c) 2026 Matt Pocock.
> Full notice at the end of this file. Gauntlet changes: the Spec axis reads the PR's
> Gherkin, OpenAPI, and holes review; the Standards axis reads `AGENTS.md`.

Use when reviewing a PR, a branch, or work in progress before handing it to a human.
This review does not replace `npm run verify`; it looks for what the gates cannot see.

## 1. Pin the fixed point

Use the base the human names (usually `origin/main`). Capture once:

```bash
git diff origin/main...HEAD
git log origin/main..HEAD --oneline
```

Confirm the ref resolves and the diff is non-empty before going further.

## 2. Collect the sources

- **Spec sources:** the `features/**/*.feature`, `openapi/openapi.yaml`, and
  `docs/holes-review/**/*.md` touched by or relevant to the diff, plus any issue the
  commits reference. If none exist, the Spec axis reports "no spec available".
- **Standards sources:** `AGENTS.md`, `.agent/skills/**`, `docs/adr/**`, and any
  `CONTRIBUTING.md` / coding-standards file in the repo.

## 3. Review both axes in parallel

Run two independent reviewers (sub-agents if available) so one axis does not mask the
other.

**Spec axis** — report, quoting the scenario, OpenAPI line, or holes-review item:

- (a) behavior the spec asks for that is missing or partial
- (b) behavior in the diff that no spec asked for (scope creep, invented AC)
- (c) behavior that looks implemented but wrong
- (d) holes-review items (`Missing AC`, `Unhappy/edge`) the diff ignores

**Standards axis** — report, citing the file and rule:

- (a) every place the diff breaks a documented rule in `AGENTS.md` or an ADR
  (for example protected paths, deps, arch-bound layering, synthetic data)
- (b) judgement-call smells (unclear names, duplication, speculative generality,
  pass-through layers), labelled as possible, never as hard violations

Skip anything a gate already enforces; the review is for what the gates miss.

## 4. Report

Present the findings under `## Spec` and `## Standards`, unmerged and unranked across
axes. End with one line per axis: number of findings and the worst one.

## Do not

- Do not fix the code inside the review; hand findings back.
- Never approve the PR or apply a grant label; approval and grants are human-only.
- Do not mark a gate failure as acceptable; a red verify is a blocking finding.

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
