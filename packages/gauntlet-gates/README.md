# @ai-code-gauntlet/gates

Canonical TypeScript sources for gauntlet verify scripts.

`examples/todo/scripts` and `templates/ts-node-web/scripts` are **distribution
copies** so `create` / `adopt` stay self-contained. Edit files here, then:

```bash
npm run gates:sync    # copy src/*.ts into todo + template
npm run gates:check   # fail if those copies drifted
```

Root `npm run verify` runs `gates:check` first.
