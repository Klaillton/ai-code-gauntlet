/**
 * ADD-POLY S1: runs the pinned runner (run.mjs) for real against each Maven fixture.
 * Needs JDK 21 + mvn on PATH; a missing mvn is a FAIL here, not a skip.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(pkg, "fixtures", "maven");
const temps: string[] = [];

type Run = {
  status: number;
  out: string;
  report: Record<string, unknown>;
  maven?: Record<string, unknown>;
};

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Fixture -> its own git repo whose origin/main is the same commit (policy identical). */
function run(name: string, prepare?: (root: string) => void): Run {
  const root = mkdtempSync(join(tmpdir(), `gauntlet-fixture-${name}-`));
  temps.push(root);
  // Every fixture is an L0-clean consumer: shared docs/sdd (D15) overlay, then the fixture.
  cpSync(join(fixtures, "_shared"), root, { recursive: true });
  cpSync(join(fixtures, name), root, { recursive: true });
  prepare?.(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, [
    "-c",
    "user.email=f@x",
    "-c",
    "user.name=f",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  ]);
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  const env = { ...process.env };
  for (const key of [
    "GITHUB_BASE_REF",
    "GITHUB_EVENT_NAME",
    "GITHUB_EVENT_PATH",
    "POLICY_CHANGE_APPROVED",
  ]) {
    delete env[key];
  }
  const result = spawnSync(process.execPath, [join(pkg, "run.mjs"), "--root", root], {
    encoding: "utf8",
    env,
  });
  const out = `${result.stdout}\n${result.stderr}`;
  const report = JSON.parse(readFileSync(join(root, "gauntlet-report.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const mavenPath = join(root, "maven-report.json");
  const maven = existsSync(mavenPath)
    ? (JSON.parse(readFileSync(mavenPath, "utf8")) as Record<string, unknown>)
    : undefined;
  return { status: result.status ?? 1, out, report, maven };
}

type Verdict = {
  capability: string;
  ok: boolean;
  total: number;
  reasons: string[];
};

const L0 = [
  "protect-specs",
  "holes-review",
  "spec-code",
  "adr-lint",
  "sdd-presence",
  "secrets-scan",
  "spec-sync",
];

function gateIds(r: Run): string[] {
  return (r.report.gates as { id: string; ok: boolean }[]).filter((g) => g.ok).map((g) => g.id);
}

function verdict(r: Run, capability: string): Verdict {
  const verdicts = (r.maven?.verdicts ?? []) as Verdict[];
  const found = verdicts.find((v) => v.capability === capability);
  assert.ok(found, `no ${capability} verdict in maven-report.json\n${r.out}`);
  return found;
}

before(() => {
  const mvn = spawnSync(process.env.GAUNTLET_MVN ?? "mvn", ["-v"], {
    encoding: "utf8",
  });
  assert.equal(mvn.status, 0, "mvn is required for the maven fixtures (fail closed, not skipped)");
});

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("maven walking skeleton (S1)", () => {
  it("ok-single: compile + surefire + freshness pass", () => {
    const r = run("ok-single");
    assert.equal(r.status, 0, r.out);
    assert.equal(r.report.ok, true);
    assert.equal(verdict(r, "maven:test").total, 1);
    assert.equal(verdict(r, "maven:freshness").ok, true);
  });

  it("ok-multi: the core enumerates both reactor modules and finds both reports", () => {
    const r = run("ok-multi");
    assert.equal(r.status, 0, r.out);
    const modules = (r.maven?.modules as { dir: string }[]).map((m) => m.dir);
    assert.deepEqual(modules, [".", "alpha", "beta"]);
    assert.equal(verdict(r, "maven:test").total, 2);
  });

  it("walking skeleton: create-ai-gauntlet adopt --stack maven, then the pinned runner", () => {
    const cli = join(pkg, "..", "create-ai-gauntlet", "bin", "create-ai-gauntlet.js");
    const r = run("ok-single", (root) => {
      rmSync(join(root, "gauntlet.config.json"));
      const adopted = spawnSync(process.execPath, [cli, "adopt", root, "--stack", "maven"], {
        encoding: "utf8",
      });
      assert.equal(adopted.status, 0, adopted.stderr || adopted.stdout);
    });
    assert.equal(r.status, 0, r.out);
    assert.equal(r.report.stack, "maven");
    const passed = gateIds(r);
    for (const id of ["policy-base", "stack", "l0-config", ...L0, "maven:compile", "maven:test"]) {
      assert.ok(passed.includes(id), `${id} did not pass\n${r.out}`);
    }
    assert.equal(existsSync(join(pkg, "fixtures", "maven", "ok-single", "target")), false);
  });

  it("reactor-dep: app depends on core + reads main/test resources, one reactor run, GREEN", () => {
    const r = run("reactor-dep");
    assert.equal(r.status, 0, r.out);
    const modules = (r.maven?.modules as { dir: string }[]).map((m) => m.dir);
    assert.deepEqual(modules, [".", "core", "app"]);
    assert.equal(verdict(r, "maven:test").total, 2);
    const tests = r.maven?.tests as { module: string; suites: { name: string }[] }[];
    const byModule = Object.fromEntries(tests.map((t) => [t.module, t.suites.map((s) => s.name)]));
    assert.deepEqual(byModule, { core: ["demo.core.GreeterTest"], app: ["demo.app.AppTest"] });
    for (const id of L0) assert.ok(gateIds(r).includes(id), `L0 ${id} did not pass`);
  });

  it("reactor-dep-no-test: app without its test is module-no-report FAIL", () => {
    const r = run("reactor-dep-no-test");
    assert.notEqual(r.status, 0);
    const v = verdict(r, "maven:test");
    assert.equal(v.ok, false);
    assert.equal(v.total, 1, "core still ran its test");
    assert.ok(
      v.reasons.some((m) => /module app: no surefire report/.test(m)),
      v.reasons.join("\n"),
    );
  });

  it("pom-includes: pom surefire <includes> hiding a failing test is FAIL (guard + cross-check)", () => {
    const r = run("pom-includes");
    assert.notEqual(r.status, 0);
    const guard = verdict(r, "maven:pom-guard");
    assert.ok(
      guard.reasons.some((m) => /<includes>/.test(m)),
      guard.reasons.join("\n"),
    );
    const v = verdict(r, "maven:test");
    assert.equal(v.ok, false);
    assert.ok(
      v.reasons.some((m) => /compiled test class demo\.FailingTest has no surefire report/.test(m)),
      v.reasons.join("\n"),
    );
  });

  it("missing-l0: a maven config without an L0 gate FAILS before any build", () => {
    const r = run("missing-l0");
    assert.notEqual(r.status, 0);
    assert.equal(r.maven, undefined);
    assert.match(r.out, /L0 gate "secrets-scan" missing from gates\[\]/);
    const l0 = (r.report.gates as { id: string; ok: boolean }[]).find((g) => g.id === "l0-config");
    assert.equal(l0?.ok, false);
  });

  it("stack-mismatch: declared npm on a maven tree is FAIL before any build", () => {
    const r = run("stack-mismatch");
    assert.notEqual(r.status, 0);
    assert.equal(r.maven, undefined);
    assert.match(r.out, /stack "npm" declared but package\.json not found/);
  });

  it("zero-tests: total == 0 is FAIL", () => {
    const r = run("zero-tests");
    assert.notEqual(r.status, 0);
    const v = verdict(r, "maven:test");
    assert.equal(v.ok, false);
    assert.equal(v.total, 0);
  });

  it("module-no-report: a jar module without a surefire report is FAIL", () => {
    const r = run("module-no-report");
    assert.notEqual(r.status, 0);
    const v = verdict(r, "maven:test");
    assert.equal(v.ok, false);
    assert.ok(v.total > 0, "alpha still ran its test");
    assert.ok(
      v.reasons.some((m) => /module beta: no surefire report/.test(m)),
      v.reasons.join("\n"),
    );
  });

  it("report-mismatch: compiled test class without report is FAIL; committed target/ report ignored", () => {
    const r = run("report-mismatch");
    assert.notEqual(r.status, 0);
    const v = verdict(r, "maven:test");
    assert.ok(
      v.reasons.some((m) => /compiled test class demo\.GhostTest has no surefire report/.test(m)),
      v.reasons.join("\n"),
    );
    assert.equal(
      v.total,
      1,
      "the forged TEST-demo.GhostTest.xml under target/ must not be counted",
    );
  });

  it("pom-cheat: pom skipTests + its own threshold are FAIL (pom guard + no report)", () => {
    const r = run("pom-cheat");
    assert.notEqual(r.status, 0);
    const guard = verdict(r, "maven:pom-guard");
    assert.equal(guard.ok, false);
    assert.ok(
      guard.reasons.some((m) => /<skipTests>/.test(m)),
      guard.reasons.join("\n"),
    );
    assert.ok(
      guard.reasons.some((m) => /gauntlet\.coverage\.threshold/.test(m)),
      guard.reasons.join("\n"),
    );
    assert.equal(verdict(r, "maven:test").ok, false);
  });
});
