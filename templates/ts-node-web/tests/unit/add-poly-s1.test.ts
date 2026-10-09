import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkStack, judge, npmGateAdapter, runAdapter } from "../../scripts/adapter.js";
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
