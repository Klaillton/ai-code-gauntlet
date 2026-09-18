# ADR: canonical gate scripts (`packages/gauntlet-gates`)

- **Status:** Accepted
- **Date:** 2026-09-16
- **Context:** AI Code Gauntlet kit

## Decision

`packages/gauntlet-gates/src/*.ts` is the **single source** for verify scripts.
`examples/todo/scripts` and `templates/ts-node-web/scripts` are distribution
copies so `create` / `adopt` stay self-contained (no `file:` dep that breaks
outside the kit clone).

```
npm run gates:sync    # copy canonical → todo + template
npm run gates:check   # fail on drift (also first step of root verify + CI)
```

`adopt` copies `packages/gauntlet-gates/src` into the target `scripts/`.
`create` still copies the template wholesale (copies must match — `gates:check`).

`deps-lock` now also protects `packages/*/package.json` and lockfiles.

Do not add a published npm package for this; agents run verify with zero extra
installs in the app.
