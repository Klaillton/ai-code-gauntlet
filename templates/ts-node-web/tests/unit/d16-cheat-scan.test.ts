import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheatScan, scanSource } from "../../scripts/cheat-scan.js";

const temps: string[] = [];

afterEach(() => {
  delete process.env.CHEAT_SCAN_APPROVED;
  delete process.env.GITHUB_EVENT_PATH;
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function fails(code: string) {
  return scanSource(code, "src/x.ts").filter((f) => f.severity === "fail");
}

function warns(code: string) {
  return scanSource(code, "src/x.ts").filter((f) => f.severity === "warn");
}

function app(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "d16-"));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("D16 FAIL: test-environment detection", () => {
  it.each([
    `if (process.env.NODE_ENV === "test") { doFake(); }`,
    `if ("test" == process.env.NODE_ENV) {}`,
    `const fake = process.env.NODE_ENV !== 'test' ? real : stub;`,
    `export const isTest = process.env["NODE_ENV"] === "test";`,
    "const t = process.env.NODE_ENV === `test`;",
    `switch (process.env.NODE_ENV) { case "test": break; default: }`,
    `if (process.env.NODE_ENV?.startsWith("test")) {}`,
    `if (["test", "ci"].includes(process.env.NODE_ENV ?? "")) {}`,
    `const env = process.env.NODE_ENV; if (env === "test") {}`,
    `const { NODE_ENV } = process.env; export const t = NODE_ENV === "test";`,
  ])("flagsNodeEnvComparedWithTest %#", (code) => {
    expect(fails(code).map((f) => f.rule)).toContain("test-env");
  });

  it.each([
    `if (process.env.VITEST) {}`,
    `const w = process.env["VITEST_WORKER_ID"];`,
    `if ("VITEST" in process.env) {}`,
  ])("flagsVitestEnv %#", (code) => {
    expect(fails(code).map((f) => f.rule)).toContain("test-env");
  });

  it.each([
    `if (process.argv.includes("--test")) {}`,
    `const t = process.argv.some((a) => a.includes("vitest"));`,
    `if (process.argv[1]?.endsWith("jest.js")) {}`,
    `if (/test/.test(process.argv.join(" "))) {}`,
  ])("flagsArgvInspectedForTest %#", (code) => {
    expect(fails(code).map((f) => f.rule)).toContain("test-env");
  });
});

describe("D16 FAIL: stdlib / global / prototype mutation", () => {
  it.each([
    `Math.random = () => 0.5;`,
    `Date = class {} as unknown as DateConstructor;`,
    `globalThis.fetch = async () => new Response("{}");`,
    `globalThis["x"] = 1;`,
    `Array.prototype.includes = () => true;`,
    `String.prototype.trim = function () { return ""; };`,
    `Foo.prototype.bar = () => 1;`,
    `obj.__proto__.y = 2;`,
    `console.error = () => undefined;`,
    `Date.now = () => 0;`,
    `JSON.stringify ||= () => "";`,
    `Object.defineProperty(Math, "random", { value: () => 0 });`,
    `Reflect.defineProperty(globalThis, "x", { value: 1 });`,
    `Object.defineProperty(Array.prototype, "last", { get() { return 1; } });`,
    `Object.assign(globalThis, { x: 1 });`,
    `Object.defineProperties(Date, { now: { value: () => 0 } });`,
    `Reflect.set(Math, "PI", 3);`,
  ])("flagsMutation %#", (code) => {
    expect(fails(code).map((f) => f.rule)).toContain("global-mutation");
  });

  it("flagsProcessMemberAssignmentEvenWhenImportedFromNodeProcess", () => {
    const code = `import process from "node:process";\nprocess.env.NODE_OPTIONS = "x";`;
    expect(fails(code).map((f) => f.rule)).toContain("global-mutation");
  });
});

describe("D16 WARN: equality / serialization overrides", () => {
  it.each([
    [`class Money { equals(_o: Money) { return true; } }`, "equals"],
    [`class Money { valueOf() { return 1; } }`, "valueOf"],
    [`const m = { toJSON() { return {}; } };`, "toJSON"],
    [`class M { [Symbol.toPrimitive]() { return 1; } }`, "[Symbol.toPrimitive]"],
    [`const m = { valueOf: () => 1 };`, "valueOf"],
  ])("warnsWithoutFailing %#", (code, name) => {
    const found = warns(code);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(name);
    expect(fails(code)).toEqual([]);
  });
});

describe("D16 clean production code", () => {
  it.each([
    `const port = Number(process.env.PORT ?? 3000);`,
    `if (process.env.NODE_ENV === "production") { enableCache(); }`,
    `if (process.env.GAUNTLET_E2E !== "1") { throw new Error("no"); }`,
    `const args = process.argv.slice(2);`,
    `if (process.argv.includes("--latest")) {}`,
    `const now = new Date().toISOString(); const r = Math.random();`,
    `class Repo { items = new Map<string, number>(); save(k: string) { this.items.set(k, 1); } }`,
    `let Date = 1; Date = 2;`,
    `const config = { name: "test" }; config.name = "prod";`,
    `export function label() { return "test"; }`,
  ])("passes %#", (code) => {
    expect(fails(code)).toEqual([]);
    expect(warns(code)).toEqual([]);
  });

  it("realTreeSrcIsClean", () => {
    const result = runCheatScan(process.cwd());
    expect(result.ok).toBe(true);
  });
});

describe("D16 gate + human grant", () => {
  const dirty = {
    "src/domain/clock.ts": `export const now = () => (process.env.NODE_ENV === "test" ? 0 : Date.now());\n`,
    "src/api/patch.ts": `Math.random = () => 0.5;\n`,
    "tests/unit/clock.test.ts": `process.env.NODE_ENV === "test"; Math.random = () => 1;\n`,
  };

  it("failsOnDirtySrcAndIgnoresTests", () => {
    const result = runCheatScan(app(dirty));
    expect(result.ok).toBe(false);
    const files = result.findings.filter((f) => f.severity === "fail" && f.file).map((f) => f.file);
    expect(files).toEqual(["src/api/patch.ts", "src/domain/clock.ts"]);
  });

  it("passesWithEnvGrant", () => {
    process.env.CHEAT_SCAN_APPROVED = "1";
    const result = runCheatScan(app(dirty));
    expect(result.ok).toBe(true);
    expect(
      result.findings.some((f) => f.message.includes("granted via CHEAT_SCAN_APPROVED=1")),
    ).toBe(true);
  });

  it("passesWithLabelGrantOnlyForTheRightLabel", () => {
    const dir = app(dirty);
    const event = join(dir, "event.json");
    writeFileSync(
      event,
      JSON.stringify({ pull_request: { labels: [{ name: "specs-approved" }] } }),
    );
    process.env.GITHUB_EVENT_PATH = event;
    expect(runCheatScan(dir).ok).toBe(false);
    writeFileSync(
      event,
      JSON.stringify({ pull_request: { labels: [{ name: "cheat-scan-approved" }] } }),
    );
    expect(runCheatScan(dir).ok).toBe(true);
  });

  it("grantValueOtherThanOneDoesNotCount", () => {
    process.env.CHEAT_SCAN_APPROVED = "true";
    expect(runCheatScan(app(dirty)).ok).toBe(false);
  });

  it("passesOnEmptyOrMissingSrc", () => {
    expect(runCheatScan(app({ "README.md": "x\n" })).ok).toBe(true);
  });
});
