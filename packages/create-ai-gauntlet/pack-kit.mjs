import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pkgRoot, "../..");
const kit = join(pkgRoot, "kit");

const SKIP = new Set([
  "node_modules",
  "coverage",
  "dist",
  ".git",
  "playwright-report",
  "test-results",
  ".cucumber-js",
  "kit",
]);

function allow(src) {
  const name = basename(src);
  if (SKIP.has(name)) {
    return false;
  }
  if (name.endsWith("-report.json")) {
    return false;
  }
  return true;
}

function copyIntoKit(rel) {
  const from = join(repoRoot, rel);
  if (!existsSync(from)) {
    throw new Error(`pack-kit: missing ${from}`);
  }
  cpSync(from, join(kit, rel), { recursive: true, filter: allow });
}

if (existsSync(kit)) {
  rmSync(kit, { recursive: true, force: true });
}
mkdirSync(kit, { recursive: true });
copyIntoKit("templates/ts-node-web");
copyIntoKit("packages/gauntlet-gates");
copyIntoKit("packages/gauntlet-skills");
copyIntoKit("examples/todo");
console.info(`packed kit -> ${kit}`);
