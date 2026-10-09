import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkStack, judge, npmGateAdapter, runAdapter } from "../../scripts/adapter.js";
import {
  checkL0Gates,
  checkMavenL0Coverage,
  L0_GATES,
  l0Command,
  MAVEN_BUILD_GLOBS,
} from "../../scripts/l0.js";
import { isProtectedPolicyPath } from "../../scripts/policy-base.js";
import {
  checkModuleTests,
  enumerateModules,
  parseSurefireXml,
  pomGuard,
  stripComments,
} from "../../scripts/maven.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "add-poly-"));
  temps.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

const POM = "<project><artifactId>x</artifactId></project>";

describe("ADD-POLY S1: fail-closed stack", () => {
  it("missing stack is FAIL", () => {
    const check = checkStack(undefined, tree({ "package.json": "{}" }));
    expect(check.ok).toBe(false);
  });

  it("unknown stack is FAIL", () => {
    expect(checkStack("cargo", tree({ "package.json": "{}" })).ok).toBe(false);
  });

  it("gradle is declared in the design but not implemented yet: FAIL", () => {
    expect(checkStack("gradle", tree({ "build.gradle": "" })).ok).toBe(false);
  });

  it("declared stack without its build file is FAIL", () => {
    const check = checkStack("maven", tree({ "package.json": "{}" }));
    expect(check).toMatchObject({ ok: false });
  });

  it("a second stack's build file next to the declared one is FAIL", () => {
    expect(checkStack("npm", tree({ "package.json": "{}", "pom.xml": POM })).ok).toBe(false);
  });

  it("matching single stack passes", () => {
    expect(checkStack("npm", tree({ "package.json": "{}" }))).toEqual({ ok: true, stack: "npm" });
    expect(checkStack("maven", tree({ "pom.xml": POM }))).toEqual({ ok: true, stack: "maven" });
  });
});

describe("ADD-POLY S1: adapter contract", () => {
  it("total == 0 is FAIL even when the command ran", () => {
    const verdict = judge(
      "x",
      { ran: true, total: 0, metric: 0, detail: [] },
      { exitCode: 0, durationMs: 1 },
    );
    expect(verdict.ok).toBe(false);
  });

  it("ran == false is FAIL", () => {
    const verdict = judge(
      "x",
      { ran: false, total: 3, metric: 0, detail: [] },
      { exitCode: 2, durationMs: 1 },
    );
    expect(verdict).toMatchObject({ ok: false, exitCode: 2 });
  });

  it("npm adapter keeps the exit-code verdict and the exit code (parity)", async () => {
    const node = process.execPath;
    const pass = await runAdapter({
      ...npmGateAdapter({ id: "p", command: node, args: ["-e", "process.exit(0)"] }, tmpdir()),
      stdio: "ignore",
    });
    const fail = await runAdapter({
      ...npmGateAdapter({ id: "f", command: node, args: ["-e", "process.exit(3)"] }, tmpdir()),
      stdio: "ignore",
    });
    expect(pass).toMatchObject({ ok: true, exitCode: 0, ran: true, total: 1 });
    expect(fail).toMatchObject({ ok: false, exitCode: 3, metric: 3 });
  });
});

describe("ADD-POLY S1: maven parsing (no mvn needed)", () => {
  it("enumerates reactor modules, including profile modules", () => {
    const root = tree({
      "pom.xml":
        "<project><packaging>pom</packaging><modules><module>a</module></modules>" +
        "<profiles><profile><modules><module>b</module></modules></profile></profiles></project>",
      "a/pom.xml": POM,
      "b/pom.xml": POM,
    });
    expect(enumerateModules(root).map((m) => `${m.dir}:${m.packaging}`)).toEqual([
      ".:pom",
      "a:jar",
      "b:jar",
    ]);
  });

  it("pom guard flags skips and pom-owned thresholds, ignores comments", () => {
    const root = tree({
      "pom.xml":
        "<project><!-- <skipTests>true</skipTests> --><properties>" +
        "<jacoco.minimum>0.1</jacoco.minimum><maven.test.skip>true</maven.test.skip>" +
        "</properties></project>",
    });
    const messages = pomGuard(root, enumerateModules(root)).map((f) => f.message);
    expect(messages.some((m) => m.includes("<maven.test.skip>"))).toBe(true);
    expect(messages.some((m) => m.includes("<jacoco.minimum>"))).toBe(true);
    expect(messages.some((m) => m.includes("<skipTests>"))).toBe(false);
  });

  it("strips every XML comment, including unclosed ones", () => {
    expect(stripComments("a<!-- x -->b<!-- y -->c")).toBe("abc");
    expect(stripComments("a<!-- <skipTests>")).toBe("a");
    expect(stripComments("<!--<!-- -->--><skip>")).toBe("--><skip>");
  });

  it("clean pom has no findings", () => {
    const root = tree({ "pom.xml": POM });
    expect(pomGuard(root, enumerateModules(root))).toEqual([]);
  });

  it("parses a surefire suite and counts testcases", () => {
    const suite = parseSurefireXml(
      '<testsuite name="demo.ATest" tests="2" failures="0" errors="0" skipped="1">' +
        '<testcase name="a"/><testcase name="b"><skipped/></testcase></testsuite>',
    );
    expect(suite).toEqual({
      name: "demo.ATest",
      tests: 2,
      failures: 0,
      errors: 0,
      skipped: 1,
      testcases: 2,
    });
  });

  it("a report with no compiled test class (forged) is a cross-check failure", () => {
    const stage = tree({
      "target/surefire-reports/TEST-demo.FakeTest.xml":
        '<testsuite name="demo.FakeTest" tests="1" failures="0" errors="0" skipped="0">' +
        '<testcase name="x"/></testsuite>',
    });
    const result = checkModuleTests(stage, { dir: ".", packaging: "jar", pom: "pom.xml" });
    expect(result.problems).toContain(
      "module .: surefire report demo.FakeTest has no compiled test class",
    );
  });

  it("tests= that disagrees with the <testcase> count is a failure", () => {
    const stage = tree({
      "target/surefire-reports/TEST-demo.ATest.xml":
        '<testsuite name="demo.ATest" tests="5" failures="0" errors="0" skipped="0">' +
        '<testcase name="x"/></testsuite>',
    });
    const result = checkModuleTests(stage, { dir: ".", packaging: "jar", pom: "pom.xml" });
    expect(result.problems.some((p) => p.includes("tests=5 but has 1"))).toBe(true);
  });
});

describe("ADD-POLY S1: L0 gates are mandatory for every stack", () => {
  const npmL0 = L0_GATES.map((id) => ({ id, command: "npm", args: ["run", id] }));
  const idsOnly = L0_GATES.map((id) => ({ id }));

  it("this tree's gauntlet.config.json lists every L0 gate", () => {
    const config = JSON.parse(readFileSync("gauntlet.config.json", "utf8")) as { gates: unknown };
    expect(checkL0Gates("npm", config.gates)).toEqual([]);
  });

  it("a missing L0 gate is FAIL (npm and maven)", () => {
    const withoutSecrets = (gates: { id: string }[]) =>
      gates.filter((g) => g.id !== "secrets-scan");
    expect(checkL0Gates("npm", withoutSecrets(npmL0)).join("\n")).toMatch(/"secrets-scan" missing/);
    expect(checkL0Gates("maven", withoutSecrets(idsOnly)).join("\n")).toMatch(
      /"secrets-scan" missing/,
    );
  });

  it("gates[] absent is FAIL", () => {
    expect(checkL0Gates("maven", undefined)).toHaveLength(1);
  });

  it("npm L0 entries must be exactly npm run <id>", () => {
    const swapped = npmL0.map((g) =>
      g.id === "spec-code" ? { ...g, command: "true", args: [] } : g,
    );
    expect(checkL0Gates("npm", swapped).join("\n")).toMatch(/exactly `npm run spec-code`/);
  });

  it("maven L0 entries are ids only and extra gates are FAIL", () => {
    expect(checkL0Gates("maven", idsOnly)).toEqual([]);
    expect(checkL0Gates("maven", npmL0)).toHaveLength(L0_GATES.length);
    expect(checkL0Gates("maven", [...idsOnly, { id: "unit" }]).join("\n")).toMatch(
      /"unit" is not an L0 gate/,
    );
  });

  it("the runner owns the command; spec-sync runs --l0 off npm", () => {
    expect(l0Command("spec-sync", "maven").args.at(-1)).toBe("--l0");
    expect(l0Command("spec-sync", "npm").args.at(-1)).toMatch(/spec-sync\.ts$/);
  });
});

describe("ADD-POLY S1: maven build files and module coverage", () => {
  const AGG = (mods: string[]) =>
    `<project><packaging>pom</packaging><modules>${mods.map((m) => `<module>${m}</module>`).join("")}</modules></project>`;
  const covered = (globs: string[]) => ({
    agent: { protectedGlobs: [...MAVEN_BUILD_GLOBS] },
    holesReview: { implementationGlobs: globs },
    specCode: { implementationGlobs: globs },
  });

  it("policy-base treats every pom.xml, .mvn/**, mvnw and mvnw.cmd as protected", () => {
    for (const path of [
      "pom.xml",
      "core/pom.xml",
      "a/b/pom.xml",
      ".mvn/extensions.xml",
      "mvnw",
      "mvnw.cmd",
    ]) {
      expect(isProtectedPolicyPath(path, "")).toBe(true);
    }
    expect(isProtectedPolicyPath("core/src/main/java/A.java", "")).toBe(false);
    expect(isProtectedPolicyPath("other/pom.xml", "app")).toBe(false);
  });

  it("every reactor module covered: ok", () => {
    const root = tree({ "pom.xml": AGG(["core", "app"]), "core/pom.xml": POM, "app/pom.xml": POM });
    expect(checkMavenL0Coverage(root, covered(["core/src/main/**", "app/src/main/**"]))).toEqual(
      [],
    );
  });

  it("a nested module outside the globs is FAIL, naming it (holesReview and specCode)", () => {
    const root = tree({
      "pom.xml": AGG(["core", "parent"]),
      "core/pom.xml": POM,
      "parent/pom.xml": AGG(["c"]),
      "parent/c/pom.xml": POM,
    });
    const problems = checkMavenL0Coverage(root, covered(["core/src/main/**"]));
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(
      /module parent\/c: parent\/c\/src\/main\/\*\* not covered by holesReview/,
    );
    expect(problems.join("\n")).toMatch(/module parent\/c: .* not covered by specCode/);
  });

  it("default src/** does not cover a sub-module; missing build globs are FAIL", () => {
    const root = tree({ "pom.xml": AGG(["core"]), "core/pom.xml": POM });
    const problems = checkMavenL0Coverage(root, {});
    expect(problems.filter((p) => p.startsWith("agent.protectedGlobs"))).toHaveLength(4);
    expect(problems.filter((p) => p.startsWith("module core:"))).toHaveLength(2);
  });

  it("single-module: src/main/** covers the root module", () => {
    const root = tree({ "pom.xml": POM });
    expect(checkMavenL0Coverage(root, covered(["src/main/**"]))).toEqual([]);
  });
});
