# Example: Todo Gauntlet

Full demo app proving every MVP gate of the AI Code Gauntlet.

```bash
cd examples/todo
npm install
npm run prepare:browsers
npm run verify
npm run dev
```

Domain: in-memory todos + thin UI + OpenAPI + Cucumber/Playwright.

For a **clean greenfield** app, use `templates/ts-node-web` or:

```bash
node packages/create-ai-gauntlet/bin/create-ai-gauntlet.js create my-app
```
