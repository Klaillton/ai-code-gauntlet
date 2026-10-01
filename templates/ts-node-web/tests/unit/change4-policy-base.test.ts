import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffPolicy,
  isProtectedPolicyPath,
  loadPolicyConfig,
  runPolicyBase,
} from "../../scripts/policy-base.js";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const BASE = {
  name: "fixture",
  strictness: "strict",
  allowSpecEdit: false,
  gates: [
    { id: "lint", command: "npm", args: ["run", "lint"] },
    { id: "protect-specs", command: "npm", args: ["run", "protect-specs"] },
  ],
  mutation: { threshold: 80 },
  contract: {
    port: 3456,
    cases: [{ label: "GET /health", method: "GET", path: "/health", expectedStatus: 200 }],
  },
  agent: { protectedGlobs: ["features/**/*.feature", "openapi/openapi.yaml"] },
};

type Config = Record<string, unknown> & typeof BASE;

function clone(): Config {
  return structuredClone(BASE) as Config;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function commitAll(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", message]);
}

/** Repo with an app under app/ (like examples/todo), base committed as origin/main. */
function fixture(options: { withConfig?: boolean; withOrigin?: boolean } = {}): {
  root: string;
  app: string;
} {
  const root = mkdtempSync(join(tmpdir(), "policy-base-"));
  temps.push(root);
  git(root, ["init", "-q"]);
  git(root, ["checkout", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "fixture@example.com"]);
  git(root, ["config", "user.name", "fixture"]);
  const app = join(root, "app");
  write(join(app, "scripts", "verify.ts"), "export {};\n");
  write(join(app, "vitest.config.ts"), "export default {};\n");
  write(join(root, ".github", "workflows", "verify.yml"), "name: verify\n");
  write(join(app, "README.md"), "fixture\n");
  if (options.withConfig !== false) {
    writeConfig(app, clone());
  }
  commitAll(root, "base");
  if (options.withOrigin !== false) {
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  }
  git(root, ["checkout", "-q", "-b", "feature"]);
  return { root, app };
}

function writeConfig(app: string, config: unknown): void {
  write(join(app, "gauntlet.config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

function eventFile(root: string, payload: unknown): string {
  const file = join(root, "..", `${root.split(/[\\/]/).pop()}-event.json`);
  writeFileSync(file, JSON.stringify(payload));
  temps.push(file);
  return file;
}

const LOCAL: NodeJS.ProcessEnv = {};
const GRANT_ENV: NodeJS.ProcessEnv = { POLICY_CHANGE_APPROVED: "1" };

function failText(result: ReturnType<typeof runPolicyBase>): string {
  return result.findings
    .filter((f) => f.severity === "fail")
    .map((f) => f.message)
    .join("\n");
}

describe("CHANGE-4 policy read from base", () => {
  it("passesWhenPolicyIdenticalToBase", () => {
    const { app } = fixture();
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(true);
    expect(result.findings[0]?.message).toContain("identical to base origin/main");
  });

  it("failsWhenProtectedGlobRemovedInHead", () => {
    const { app, root } = fixture();
    const head = clone();
    head.agent.protectedGlobs = ["features/**/*.feature"];
    writeConfig(app, head);
    commitAll(root, "drop glob");
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("agent.protectedGlobs[1] (removed)");
    expect(loadPolicyConfig(app, LOCAL).agent).toEqual(BASE.agent);
  });

  it("failsWhenAllowFlagFlippedToTrueAndEffectiveFlagStaysFalse", () => {
    const { app } = fixture();
    const head = clone();
    head.allowSpecEdit = true as unknown as false;
    head.allowDepsEdit = true;
    writeConfig(app, head); // uncommitted working-tree edit counts too
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("allowSpecEdit (changed)");
    expect(failText(result)).toContain("allowDepsEdit (added)");
    expect(loadPolicyConfig(app, LOCAL).allowSpecEdit).toBe(false);
    // Even with a policy grant, a committed allow* counts only if true in base.
    expect(loadPolicyConfig(app, GRANT_ENV).allowSpecEdit).toBe(false);
    expect(loadPolicyConfig(app, GRANT_ENV).allowDepsEdit).toBe(false);
  });

  it("keepsAllowFlagWhenAlreadyTrueInBase", () => {
    const { app, root } = fixture();
    git(root, ["checkout", "-q", "main"]);
    const base = clone();
    base.allowSpecEdit = true as unknown as false;
    writeConfig(app, base);
    commitAll(root, "human grant in base");
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(root, ["checkout", "-q", "-B", "feature"]);
    expect(runPolicyBase(app, LOCAL).ok).toBe(true);
    expect(loadPolicyConfig(app, LOCAL).allowSpecEdit).toBe(true);
  });

  it("failsWhenGateDeletedFromGatesArrayAndVerifyStillSeesBaseGates", () => {
    const { app, root } = fixture();
    const head = clone();
    head.gates = head.gates.filter((gate) => gate.id !== "protect-specs");
    writeConfig(app, head);
    commitAll(root, "drop gate");
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("gates[1]");
    const effective = loadPolicyConfig(app, LOCAL) as Config;
    expect(effective.gates.map((gate) => gate.id)).toEqual(["lint", "protect-specs"]);
  });

  it("failsOnNewUnknownKey", () => {
    const { app } = fixture();
    writeConfig(app, { ...clone(), trustMe: { skipEverything: true } });
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("trustMe.skipEverything (added)");
  });

  it("failsOnLoweredThresholdAndStrictness", () => {
    const { app } = fixture();
    const head = clone();
    head.mutation.threshold = 10;
    head.strictness = "lenient";
    writeConfig(app, head);
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("mutation.threshold (changed)");
    expect(failText(result)).toContain("strictness (changed)");
    expect((loadPolicyConfig(app, LOCAL) as Config).mutation.threshold).toBe(80);
  });

  it("passesOnContractCasesAddAndAlter", () => {
    const { app, root } = fixture();
    const head = clone();
    head.contract.cases[0] = { ...head.contract.cases[0]!, label: "GET /health ok" };
    head.contract.cases.push({ label: "GET /x", method: "GET", path: "/x", expectedStatus: 200 });
    writeConfig(app, head);
    commitAll(root, "add case");
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.message.includes("contract.cases[1]"))).toBe(true);
    const effective = loadPolicyConfig(app, LOCAL) as Config;
    expect(effective.contract.cases).toHaveLength(2);
    expect(effective.contract.port).toBe(3456);
  });

  it("failsOnContractCasesRemoval", () => {
    const { app, root } = fixture();
    const head = clone();
    head.contract.cases = [];
    writeConfig(app, head);
    commitAll(root, "drop case");
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("contract.cases[0] (removed)");
  });

  it("failsWhenContractCasesKeyDeletedOrEntryNulled", () => {
    const { app } = fixture();
    const head = clone() as Record<string, unknown>;
    head.contract = { port: 3456 };
    writeConfig(app, head);
    expect(runPolicyBase(app, LOCAL).ok).toBe(false);
    const nulled = clone() as Record<string, unknown>;
    nulled.contract = { port: 3456, cases: [null] };
    writeConfig(app, nulled);
    expect(failText(runPolicyBase(app, LOCAL))).toContain("contract.cases[0] (changed)");
  });

  it("failsWhenCiCannotResolveTheBaseEvenWithAGrant", () => {
    const { app } = fixture({ withOrigin: false });
    const ci = { CI: "true", GITHUB_BASE_REF: "main" };
    const result = runPolicyBase(app, ci);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("CI cannot resolve the base");
    expect(runPolicyBase(app, { ...ci, POLICY_CHANGE_APPROVED: "1" }).ok).toBe(false);
  });

  it("failsOnPushWithZeroOrUnknownBefore", () => {
    const { app, root } = fixture();
    const zero = eventFile(root, { before: "0000000000000000000000000000000000000000" });
    const env = { CI: "true", GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: zero };
    expect(failText(runPolicyBase(app, env))).toContain("github.event.before");
    const unknown = eventFile(root, { before: "1234567890abcdef1234567890abcdef12345678" });
    expect(runPolicyBase(app, { ...env, GITHUB_EVENT_PATH: unknown }).ok).toBe(false);
  });

  it("usesGithubEventBeforeOnPush", () => {
    const { app, root } = fixture();
    const before = git(root, ["rev-parse", "HEAD"]).trim();
    write(join(app, "scripts", "verify.ts"), "export const x = 1;\n");
    commitAll(root, "script edit");
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]); // origin/main is NOT the base on push
    const event = eventFile(root, { before });
    const env = { CI: "true", GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: event };
    const result = runPolicyBase(app, env);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("app/scripts/verify.ts");
  });

  it("failsLocallyWithoutOriginMainUnlessHumanEnvGrant", () => {
    const { app } = fixture({ withOrigin: false });
    expect(runPolicyBase(app, LOCAL).ok).toBe(false);
    expect(runPolicyBase(app, GRANT_ENV).ok).toBe(true);
  });

  it("failsOnWorkflowEditWithoutGrantAndPassesWithGrant", () => {
    const { app, root } = fixture();
    write(join(root, ".github", "workflows", "verify.yml"), "name: verify\non: push\n");
    commitAll(root, "weaken ci");
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain(".github/workflows/verify.yml");
    expect(runPolicyBase(app, GRANT_ENV).ok).toBe(true);
    const labeled = eventFile(root, {
      pull_request: { labels: [{ name: "policy-change-approved" }] },
    });
    expect(runPolicyBase(app, { GITHUB_EVENT_PATH: labeled }).ok).toBe(true);
    const wrongLabel = eventFile(root, { pull_request: { labels: [{ name: "specs-approved" }] } });
    expect(runPolicyBase(app, { GITHUB_EVENT_PATH: wrongLabel }).ok).toBe(false);
  });

  it("failsOnScriptEditWithoutGrantAndPassesWithGrant", () => {
    const { app, root } = fixture();
    write(join(app, "scripts", "verify.ts"), "process.exit(0);\n");
    commitAll(root, "neuter verify");
    expect(failText(runPolicyBase(app, LOCAL))).toContain("app/scripts/verify.ts");
    expect(runPolicyBase(app, GRANT_ENV).ok).toBe(true);
  });

  it("failsOnUntrackedNewScriptAndTestConfigEdit", () => {
    const { app } = fixture();
    write(join(app, "scripts", "helper.ts"), "export {};\n");
    write(join(app, "vitest.config.ts"), "export default { test: { passWithNoTests: true } };\n");
    const text = failText(runPolicyBase(app, LOCAL));
    expect(text).toContain("app/scripts/helper.ts");
    expect(text).toContain("app/vitest.config.ts");
  });

  it("failsOnFirstAdoptionWithoutGrantAndClampsGrantsWithIt", () => {
    const { app } = fixture({ withConfig: false });
    writeConfig(app, { ...clone(), allowSpecEdit: true });
    const result = runPolicyBase(app, LOCAL);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("first adoption");
    const granted = runPolicyBase(app, GRANT_ENV);
    expect(granted.ok).toBe(true);
    expect(loadPolicyConfig(app, GRANT_ENV).allowSpecEdit).toBe(false);
  });

  it("failsWithoutGit", () => {
    const dir = mkdtempSync(join(tmpdir(), "policy-nogit-"));
    temps.push(dir);
    writeConfig(dir, clone());
    const result = runPolicyBase(dir, GRANT_ENV);
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("git required for this gate");
  });

  it("ignoresDocsOnlyChanges", () => {
    const { app, root } = fixture();
    write(join(app, "README.md"), "changed\n");
    commitAll(root, "docs");
    expect(runPolicyBase(app, LOCAL).ok).toBe(true);
  });
});

describe("CHANGE-4 helpers", () => {
  it("diffPolicyIsDenyByDefaultAndOrderInsensitiveForObjectKeys", () => {
    expect(diffPolicy({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
    expect(diffPolicy({ a: 1 }, { a: 1, z: { deep: [1] } })).toEqual([
      { path: "z.deep", kind: "added", exempt: false },
    ]);
    expect(diffPolicy({ gates: ["a", "b"] }, { gates: ["b", "a"] })).toHaveLength(2);
  });

  it("scopesProtectedPathsToTheAppTreeAndRepoWorkflows", () => {
    expect(isProtectedPolicyPath("app/scripts/x.ts", "app/")).toBe(true);
    expect(isProtectedPolicyPath("other/scripts/x.ts", "app/")).toBe(false);
    expect(isProtectedPolicyPath(".github/workflows/ci.yml", "app/")).toBe(true);
    expect(isProtectedPolicyPath("app/stryker.conf.json", "app/")).toBe(true);
    expect(isProtectedPolicyPath("app/playwright.config.ts", "app/")).toBe(true);
    expect(isProtectedPolicyPath("app/cucumber.cjs", "app/")).toBe(true);
    expect(isProtectedPolicyPath("app/.c8rc.json", "app/")).toBe(true);
    expect(isProtectedPolicyPath("app/src/domain/todo.ts", "app/")).toBe(false);
    expect(isProtectedPolicyPath("scripts/x.ts", "")).toBe(true);
  });
});
