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

test("adopt status lists crap among hardening gates", () => {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-adopt-"));
  try {
    const bin = join(pkgRoot, "..", "bin", "create-ai-gauntlet.js");
    const result = spawnSync(process.execPath, [bin, "adopt", dir], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const status = readFileSync(join(dir, "ADOPT-STATUS.md"), "utf8");
    assert.match(status, /Hardening gates always wired:.*\bcrap\b/);
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

function adopt(args) {
  const bin = join(pkgRoot, "..", "bin", "create-ai-gauntlet.js");
  return spawnSync(process.execPath, [bin, "adopt", ...args], { encoding: "utf8" });
}

test("adopt (npm default) writes a fail-closed stack: npm", () => {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-adopt-npm-"));
  try {
    const result = adopt([dir]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = JSON.parse(readFileSync(join(dir, "gauntlet.config.json"), "utf8"));
    assert.equal(config.stack, "npm");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Lines inside `run:` scripts that interpolate `${{ }}` (script injection surface). */
function expressionsInRunBlocks(yaml) {
  const hits = [];
  let runIndent = -1;
  for (const line of yaml.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (runIndent >= 0 && line.trim() !== "" && indent <= runIndent) runIndent = -1;
    const run = /^(\s*)(?:- )?run:/.exec(line);
    if (run) runIndent = indent;
    if ((run || runIndent >= 0) && line.includes("${{")) hits.push(line.trim());
  }
  return hits;
}

test("adopt --stack maven: config + docs only, no package.json, no scripts/", () => {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-adopt-maven-"));
  try {
    writeFileSync(join(dir, "pom.xml"), "<project><artifactId>x</artifactId></project>\n");
    const result = adopt(["--stack", "maven", dir]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const config = JSON.parse(readFileSync(join(dir, "gauntlet.config.json"), "utf8"));
    assert.equal(config.stack, "maven");
    assert.deepEqual(
      config.gates.map((g) => g.id),
      [
        "protect-specs",
        "holes-review",
        "spec-code",
        "adr-lint",
        "sdd-presence",
        "secrets-scan",
        "spec-sync",
      ],
    );
    assert.ok(config.gates.every((g) => !("command" in g) && !("args" in g)));
    for (const glob of ["**/pom.xml", ".mvn/**", "mvnw", "mvnw.cmd"]) {
      assert.ok(
        !config.agent.protectedGlobs.includes(glob),
        `protectedGlobs must not have ${glob}`,
      );
    }
    assert.ok(
      !config.specCode.specGlobs.some((g) => /pom|mvn/.test(g)),
      "build files are not specs",
    );
    assert.deepEqual(config.specCode.implementationGlobs, ["src/main/**"]);
    const wf = readFileSync(join(dir, ".github/workflows/policy-base.yml"), "utf8");
    assert.match(wf, /^on:\n {2}pull_request_target:/m);
    assert.match(wf, /^permissions: \{\}$/m);
    assert.equal((wf.match(/^ +persist-credentials: false$/gm) ?? []).length, 4);
    assert.match(wf, /GAUNTLET_KIT_SHA: [0-9a-f]{40}$/m);
    assert.match(wf, /--policy-head "\$HEAD_SHA"/);
    assert.deepEqual(expressionsInRunBlocks(wf), [], "PR data reaches run: only via env");
    assert.equal(existsSync(join(dir, "package.json")), false);
    assert.equal(existsSync(join(dir, "scripts")), false);
    assert.equal(existsSync(join(dir, "docs/sdd/Security.md")), true);
    assert.match(readFileSync(join(dir, "ADOPT-STATUS.md"), "utf8"), /run\.mjs --root \./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adopt --stack maven without pom.xml fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-adopt-maven-nopom-"));
  try {
    const result = adopt([dir, "--stack=maven"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pom\.xml not found/);
    assert.equal(existsSync(join(dir, "gauntlet.config.json")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adopt --stack gradle is not implemented yet (fails)", () => {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-adopt-gradle-"));
  try {
    const result = adopt([dir, "--stack", "gradle"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not supported/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adopt --stack maven pins --kit-ref and lists module globs; bad ref fails closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-adopt-maven-ref-"));
  try {
    writeFileSync(
      join(dir, "pom.xml"),
      "<project><packaging>pom</packaging><modules><module>core</module><!-- <module>old</module> --><module>app</module></modules></project>\n",
    );
    const sha = "a".repeat(40);
    const ok = adopt([dir, "--stack", "maven", "--kit-ref", sha]);
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    const wf = readFileSync(join(dir, ".github/workflows/policy-base.yml"), "utf8");
    assert.match(wf, new RegExp(`GAUNTLET_KIT_SHA: ${sha}$`, "m"));
    const config = JSON.parse(readFileSync(join(dir, "gauntlet.config.json"), "utf8"));
    assert.deepEqual(config.specCode.implementationGlobs, ["core/src/main/**", "app/src/main/**"]);

    const other = mkdtempSync(join(tmpdir(), "gauntlet-adopt-maven-badref-"));
    writeFileSync(join(other, "pom.xml"), "<project/>\n");
    const bad = adopt([other, "--stack", "maven", "--kit-ref", "main"]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /cannot pin the kit/);
    assert.equal(existsSync(join(other, "gauntlet.config.json")), false);
    rmSync(other, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
