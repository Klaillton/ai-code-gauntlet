import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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

test("findKitRoot accepts a packed kit/ directory under the package", () => {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-kitroot-"));
  try {
    mkdirSync(join(dir, "kit", "templates", "ts-node-web"), { recursive: true });
    mkdirSync(join(dir, "kit", "packages", "gauntlet-gates", "src"), { recursive: true });
    writeFileSync(join(dir, "kit", "templates", "ts-node-web", ".keep"), "");
    writeFileSync(join(dir, "kit", "packages", "gauntlet-gates", "src", ".keep"), "");
    assert.equal(findKitRoot(dir), join(dir, "kit"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("create patches package name and gauntlet.md App line", () => {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-create-"));
  const target = join(dir, "my-smoke-app");
  try {
    const bin = join(pkgRoot, "..", "bin", "create-ai-gauntlet.js");
    const r = spawnSync(process.execPath, [bin, "create", target], {
      encoding: "utf8",
      cwd: dir,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const cfg = readFileSync(join(target, "gauntlet.config.json"), "utf8");
    assert.match(cfg, /"name":\s*"my-smoke-app"/);
    const md = readFileSync(join(target, "docs/generated/gauntlet.md"), "utf8");
    assert.match(md, /^- \*\*App:\*\* my-smoke-app$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
