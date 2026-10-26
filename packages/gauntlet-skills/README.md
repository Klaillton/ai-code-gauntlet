# gauntlet-skills

Canonical agent skills. Copies live in `examples/todo/.agent/skills` and
`templates/ts-node-web/.agent/skills`.

```bash
npm run skills:sync
npm run skills:check
```

## skills-lint (part of `skills:check`)

`skills:check` also fails if a canonical skill (`*.md` here, except this README)
instructs an agent to bypass the gauntlet:

| Rule               | Catches                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `skip-hooks`       | `--no-verify`, `HUSKY=0`, "skip the pre-commit hook"                                                                                          |
| `disable-tests`    | `it/test/describe.only/.skip`, `xit`, `@Disabled`, `-DskipTests`, "skip / delete the failing tests"                                           |
| `lower-thresholds` | lowering / reducing / relaxing coverage, thresholds, floors, kill-score                                                                       |
| `apply-grant`      | a grant label or env (`*-approved`, `POLICY_CHANGE_APPROVED=1`, …) next to an apply verb (`apply`, `add`, `set`, `--add-label`, `gh pr edit`) |
| `gh-without-token` | a `gh pr/api/issue/…` call with no `GH_TOKEN=` in the same paragraph or code fence                                                            |

**False-positive rule:** a match is allowed only when the **same clause** states a
prohibition: `never`, `do not`, `don't`, `must not`, `cannot`, `forbidden`,
`prohibited`, `not allowed`, or `revert`. A clause is one sentence or one
`;`-separated part of a paragraph or list item (soft-wrapped lines are joined); in a
code fence each line is a clause. There is no allow marker: write the line as a
prohibition. "Do not wait; run `--no-verify`" still fails (different clause).

Residual: this is a phrase lint, not intent analysis. A bypass worded so it carries a
negation in the same clause passes; skills still get human review. Adversarial tests:
`lint.test.mjs` (run by `skills:check`).

The `*.mjs` here (`check`, `lint`, `lint.test`, `sync`) are policy-protected:
`isProtectedPolicyPath` matches `packages/gauntlet-skills/*.mjs` (top level only), and
CODEOWNERS has the same line. A change to them needs `policy-change-approved` plus code
owner review. `adopt` copies only the skill `*.md` files into `.agent/skills`. The lint
runs from the pinned kit and is never vendored into the adopting project.
