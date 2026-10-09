#!/usr/bin/env node
// ADD-POLY S1 pinned runner: runs THIS kit checkout's src/verify.ts against a consumer tree.
// The consumer needs no package.json; tsx comes from this package's own lockfile.
//   npm ci --prefix <kit>/packages/gauntlet-gates
//   node <kit>/packages/gauntlet-gates/run.mjs --root <consumer>
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const rootIndex = argv.indexOf("--root");
const root = resolve(rootIndex >= 0 ? (argv[rootIndex + 1] ?? "") : process.cwd());

if (!existsSync(join(root, "gauntlet.config.json"))) {
  console.error(`gauntlet runner: ${root}/gauntlet.config.json not found (fail closed)`);
  process.exit(1);
}

let tsxCli;
try {
  tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
} catch {
  console.error(
    "gauntlet runner: tsx missing. Run: npm ci --prefix packages/gauntlet-gates (pinned lockfile)",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsxCli, join(here, "src", "verify.ts")], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
