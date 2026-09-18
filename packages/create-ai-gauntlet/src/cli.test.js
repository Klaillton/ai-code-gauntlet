import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { CREATE_SKIP, findKitRoot } from "./cli.js";

const pkgRoot = dirname(fileURLToPath(import.meta.url));

test("findKitRoot locates templates and gates from the monorepo package", () => {
  const root = findKitRoot(join(pkgRoot, ".."));
  assert.equal(existsSync(join(root, "templates", "ts-node-web")), true);
  assert.equal(existsSync(join(root, "packages", "gauntlet-gates", "src")), true);
});

test("CREATE_SKIP includes coverage and git metadata", () => {
  assert.equal(CREATE_SKIP.includes("coverage"), true);
  assert.equal(CREATE_SKIP.includes("node_modules"), true);
  assert.equal(CREATE_SKIP.includes(".git"), true);
});
