# Skill: diagnose-red

> Adapted from [`diagnosing-bugs`](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/diagnosing-bugs/SKILL.md)
> in mattpocock/skills (commit `5beb35b`), MIT License, Copyright (c) 2026 Matt Pocock.
> Full notice at the end of this file. Gauntlet changes: done means a full green
> `npm run verify`; tests and gates are never weakened to get there.

Use when a bug, a failing scenario, or a performance regression has no obvious cause.
For a red gate with a known cause, use `fix-until-green` instead.

## Redact

Show commands and output, never secrets. Write `<REDACTED>` in place of any token,
key, or password, and read credentials from env vars (secrets-scan applies).

## 1. Build a red loop

Find **one command** that goes red on _this_ bug and green once it is fixed. Run it at
least once and show the invocation and its output. In order of preference:

1. A failing unit test at the seam that reaches the bug (`npm run test:unit -- <file>`)
2. A contract case or e2e scenario that already describes the behavior
3. A curl / CLI script against the dev server, diffing output against a known-good value
4. A bisection harness (`git bisect run <command>`) between a good and a bad commit

The loop must be **red-capable** (asserts the user's exact symptom), **deterministic**
(pin time, seed randomness, isolate the filesystem), and **fast** (seconds).

If you cannot build a loop, stop and tell the human what you tried. Do not guess a fix.

## 2. Reproduce and minimise

Confirm the loop shows the symptom the human reported, not a nearby one. Shrink the
repro one element at a time until every remaining element is load-bearing.

## 3. Hypothesise

List 3-5 ranked, falsifiable hypotheses ("if X is the cause, changing Y makes it go
green"). Show the list to the human before testing; continue with your ranking if they
are away.

## 4. Instrument

Change one variable at a time. Tag temporary logs with a unique prefix (for example
`[DEBUG-a4f2]`) so cleanup is one grep.

## 5. Regression test, then fix

1. Turn the minimised repro into a failing test at the correct seam, **before** the fix.
2. Watch it fail. If you forced the red by mutating code or a fixture, diff against a
   pristine copy to prove the mutation landed.
3. Apply the smallest fix in `src/**`.
4. Watch the test pass, then re-run the original loop.

If the only seam is too shallow to reproduce the real bug pattern, report that as a
finding instead of writing a false-confidence test.

If the bug is in the spec (the code matches Gherkin / OpenAPI and the spec is wrong),
stop and use `reopen-spec`.

## Done

- The original loop is green and the regression test passes.
- All `[DEBUG-...]` instrumentation is removed.
- Full `npm run verify` is green. Report its exact result.
- The confirmed hypothesis is written in the commit or PR message.

## Do not

- Never skip, focus, or delete a test to get green (no-cheat / D9 fails it anyway).
- Do not loosen asserts or lower coverage, mutation, or complexity floors.
- Do not edit `gauntlet.config.json`, `scripts/**`, test-runner configs, or `.github/**`
  without a human `policy-change-approved` grant; never apply a grant label yourself.
- Do not edit `.feature` / OpenAPI to match the buggy behavior.

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
