import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffPolicy,
  isProtectedPolicyPath,
  loadPolicyConfig,
  parseHeadArg,
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

  it("protectsTsconfigEslintAndAllOfDotGithubButNotPrettierrc", () => {
    for (const path of [
      "app/tsconfig.json",
      "app/tsconfig.build.json",
      "app/e2e/tsconfig.json",
      "app/eslint.config.js",
      "app/eslint.config.mjs",
      "app/.eslintrc",
      "app/.eslintrc.cjs",
      "app/.eslintrc.json",
      ".github/actions/setup/action.yml",
      ".github/CODEOWNERS",
      ".github/dependabot.yml",
      ".github/workflows/verify.yml",
    ]) {
      expect(isProtectedPolicyPath(path, "app/"), path).toBe(true);
    }
    expect(isProtectedPolicyPath("app/.prettierrc", "app/")).toBe(false);
    expect(isProtectedPolicyPath("app/.prettierrc.json", "app/")).toBe(false);
    expect(isProtectedPolicyPath("other/tsconfig.json", "app/")).toBe(false);
    expect(isProtectedPolicyPath("app/node_modules/x/tsconfig.json", "app/")).toBe(false);
    expect(isProtectedPolicyPath("app/src/tsconfig-helper.ts", "app/")).toBe(false);
    expect(isProtectedPolicyPath("docs/.github/x.yml", "")).toBe(false);
  });
});

const WORKFLOW_WITH_VERIFY = "name: verify\njobs:\n  t:\n    steps:\n      - run: npm run verify\n";
const REAL_ENFORCER = resolve("scripts", "policy-base.ts");
const TSX = resolve("node_modules", ".bin", "tsx");

/** Base = real enforcer + workflow with a verify step; head neutralises both (adversarial). */
function neutralisedHead(): { root: string; app: string; headSha: string } {
  const { root, app } = fixture();
  git(root, ["checkout", "-q", "main"]);
  copyFileSync(REAL_ENFORCER, join(app, "scripts", "policy-base.ts"));
  write(join(root, ".github", "workflows", "verify.yml"), WORKFLOW_WITH_VERIFY);
  commitAll(root, "base with enforcer");
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(root, ["checkout", "-q", "-B", "feature"]);
  write(
    join(app, "scripts", "policy-base.ts"),
    "export function runPolicyBase() {\n  return { ok: true, findings: [] };\n}\n",
  );
  write(join(root, ".github", "workflows", "verify.yml"), "name: verify\njobs: {}\n");
  commitAll(root, "neutralise the enforcer and drop the verify step");
  return { root, app, headSha: git(root, ["rev-parse", "HEAD"]).trim() };
}

/** Run the BASE enforcer from a base worktree (what policy-base.yml does) against the head. */
function runBaseEnforcer(root: string, headSha: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const baseDir = join(mkdtempSync(join(tmpdir(), "policy-base-wt-")), "base");
  temps.push(dirname(baseDir));
  git(root, ["worktree", "add", "-q", "--detach", baseDir, "origin/main"]);
  const run = spawnSync(TSX, ["scripts/policy-base.ts", "--head", headSha], {
    cwd: join(baseDir, "app"),
    encoding: "utf8",
    env: { PATH: process.env.PATH, CI: "true", GITHUB_BASE_REF: "main", ...extraEnv },
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}`, baseDir };
}

describe("CHANGE-4 base-run enforcer (--head, pull_request_target model)", () => {
  it("catchesAHeadThatNeutralisesPolicyBaseAndDropsTheVerifyStep", () => {
    const { root, headSha } = neutralisedHead();
    const { status, output, baseDir } = runBaseEnforcer(root, headSha);
    expect(status).toBe(1);
    expect(output).toContain("app/scripts/policy-base.ts");
    expect(output).toContain(".github/workflows/verify.yml");
    // The enforcer ran from base code: the worktree still holds the real script.
    expect(readFileSync(join(baseDir, "app", "scripts", "policy-base.ts"), "utf8")).toContain(
      "parseHeadArg",
    );
  }, 60_000);

  it("passesTheSameNeutralisingHeadOnlyWithTheHumanGrant", () => {
    const { root, headSha } = neutralisedHead();
    const { status } = runBaseEnforcer(root, headSha, { POLICY_CHANGE_APPROVED: "1" });
    expect(status).toBe(0);
  }, 60_000);

  it("readsTheHeadConfigFromTheCommitNotTheWorkingTree", () => {
    const { app, root } = fixture();
    const head = clone();
    head.agent.protectedGlobs = [];
    writeConfig(app, head);
    commitAll(root, "drop globs");
    const headSha = git(root, ["rev-parse", "HEAD"]).trim();
    git(root, ["checkout", "-q", "--detach", "origin/main"]);
    const result = runPolicyBase(app, LOCAL, { headRef: headSha });
    expect(result.ok).toBe(false);
    expect(failText(result)).toContain("agent.protectedGlobs[0] (removed)");
  });

  it("ignoresWorkingTreeEditsInHeadMode", () => {
    const { app, root } = fixture();
    write(join(app, "README.md"), "docs only\n");
    commitAll(root, "docs");
    const headSha = git(root, ["rev-parse", "HEAD"]).trim();
    write(join(app, "scripts", "verify.ts"), "process.exit(0);\n");
    expect(runPolicyBase(app, LOCAL).ok).toBe(false);
    expect(runPolicyBase(app, LOCAL, { headRef: headSha }).ok).toBe(true);
  });

  it("failsClosedOnAnUnknownHeadOrAHeadWithoutConfig", () => {
    const { app, root } = fixture();
    const unknown = runPolicyBase(app, LOCAL, { headRef: "0".repeat(40) });
    expect(unknown.ok).toBe(false);
    expect(failText(unknown)).toContain("is not a commit");
    rmSync(join(app, "gauntlet.config.json"));
    commitAll(root, "delete config");
    const sha = git(root, ["rev-parse", "HEAD"]).trim();
    const missing = runPolicyBase(app, GRANT_ENV, { headRef: sha });
    expect(missing.ok).toBe(false);
    expect(failText(missing)).toContain("not found in head");
  });

  it("parsesTheHeadArgument", () => {
    expect(parseHeadArg([])).toBeUndefined();
    expect(parseHeadArg(["--head", "abc123"])).toBe("abc123");
    expect(() => parseHeadArg(["--head"])).toThrow("--head requires");
    expect(() => parseHeadArg(["--head", "--x"])).toThrow("--head requires");
  });
});

const TSCONFIG_STRICT = `${JSON.stringify({ compilerOptions: { strict: true } }, null, 2)}\n`;
const TSCONFIG_LOOSE = `${JSON.stringify({ compilerOptions: { strict: false } }, null, 2)}\n`;
const ESLINT_BASE = 'export default [{ rules: { "no-unused-vars": "error" } }];\n';
const ESLINT_OFF = 'export default [{ rules: { "no-unused-vars": "off" } }];\n';
const ACTION_BASE =
  "runs:\n  using: composite\n  steps:\n    - run: npm run verify\n      shell: bash\n";
const ACTION_OFF =
  "runs:\n  using: composite\n  steps:\n    - run: echo skipped\n      shell: bash\n";

/** Fixture whose committed base (origin/main) also holds tsconfig, eslint, a composite action, CODEOWNERS, dependabot. */
function toolingFixture(): { root: string; app: string } {
  const { root, app } = fixture();
  git(root, ["checkout", "-q", "main"]);
  write(join(app, "tsconfig.json"), TSCONFIG_STRICT);
  write(join(app, "eslint.config.js"), ESLINT_BASE);
  write(join(root, ".github", "actions", "verify", "action.yml"), ACTION_BASE);
  write(join(root, ".github", "CODEOWNERS"), "/app/scripts/ @owner\n");
  write(join(root, ".github", "dependabot.yml"), "version: 2\nupdates: []\n");
  commitAll(root, "tooling in base");
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(root, ["checkout", "-q", "-B", "feature"]);
  return { root, app };
}

/** Head-mode run from a detached base checkout (in-process twin of policy-base.yml). */
function headMode(root: string, app: string, env: NodeJS.ProcessEnv) {
  const headSha = git(root, ["rev-parse", "HEAD"]).trim();
  git(root, ["checkout", "-q", "--detach", "origin/main"]);
  try {
    return runPolicyBase(app, env, { headRef: headSha });
  } finally {
    git(root, ["checkout", "-q", "feature"]);
  }
}

describe("CHANGE-4 protected tooling paths (tsconfig, eslint, .github/**)", () => {
  it("failsOnTsconfigStrictFalseWithoutGrantAndPassesWithIt", () => {
    const { root, app } = toolingFixture();
    write(join(app, "tsconfig.json"), TSCONFIG_LOOSE);
    commitAll(root, "strict: false");
    expect(failText(runPolicyBase(app, LOCAL))).toContain("app/tsconfig.json");
    expect(runPolicyBase(app, GRANT_ENV).ok).toBe(true);
    const head = headMode(root, app, { CI: "true", GITHUB_BASE_REF: "main" });
    expect(head.ok).toBe(false);
    expect(failText(head)).toContain("app/tsconfig.json");
    expect(headMode(root, app, { ...GRANT_ENV, CI: "true", GITHUB_BASE_REF: "main" }).ok).toBe(
      true,
    );
  });

  it("failsOnEslintConfigChangeOrNewEslintrcWithoutGrant", () => {
    const { root, app } = toolingFixture();
    write(join(app, "eslint.config.js"), ESLINT_OFF);
    write(join(app, "src", ".eslintrc.json"), '{ "root": true, "rules": {} }\n');
    commitAll(root, "disable a lint rule");
    const text = failText(runPolicyBase(app, LOCAL));
    expect(text).toContain("app/eslint.config.js");
    expect(text).toContain("app/src/.eslintrc.json");
    expect(failText(headMode(root, app, { CI: "true", GITHUB_BASE_REF: "main" }))).toContain(
      "app/eslint.config.js",
    );
    expect(runPolicyBase(app, GRANT_ENV).ok).toBe(true);
  });

  it("failsOnModifiedCompositeActionWithoutGrant", () => {
    const { root, app } = toolingFixture();
    write(join(root, ".github", "actions", "verify", "action.yml"), ACTION_OFF);
    commitAll(root, "composite action skips verify");
    expect(failText(runPolicyBase(app, LOCAL))).toContain(".github/actions/verify/action.yml");
    expect(failText(headMode(root, app, { CI: "true", GITHUB_BASE_REF: "main" }))).toContain(
      ".github/actions/verify/action.yml",
    );
    expect(runPolicyBase(app, GRANT_ENV).ok).toBe(true);
  });

  it("failsOnCodeownersOrDependabotEditWithoutGrant", () => {
    const { root, app } = toolingFixture();
    write(join(root, ".github", "CODEOWNERS"), "# ownership removed\n");
    write(
      join(root, ".github", "dependabot.yml"),
      "version: 2\nupdates:\n  - package-ecosystem: npm\n",
    );
    commitAll(root, "drop codeowners, widen dependabot");
    const text = failText(runPolicyBase(app, LOCAL));
    expect(text).toContain(".github/CODEOWNERS");
    expect(text).toContain(".github/dependabot.yml");
    expect(runPolicyBase(app, GRANT_ENV).ok).toBe(true);
  });

  it("ignoresPrettierrcChanges", () => {
    const { root, app } = toolingFixture();
    write(join(app, ".prettierrc"), '{ "printWidth": 120 }\n');
    commitAll(root, "format only");
    expect(runPolicyBase(app, LOCAL).ok).toBe(true);
  });

  it("baseWorktreeEnforcerCatchesTsconfigAndCompositeActionInTheHead", () => {
    const { root, app } = toolingFixture();
    git(root, ["checkout", "-q", "main"]);
    copyFileSync(REAL_ENFORCER, join(app, "scripts", "policy-base.ts"));
    commitAll(root, "real enforcer in base");
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(root, ["checkout", "-q", "-B", "feature"]);
    write(join(app, "tsconfig.json"), TSCONFIG_LOOSE);
    write(join(root, ".github", "actions", "verify", "action.yml"), ACTION_OFF);
    commitAll(root, "weaken typecheck and the composite action");
    const headSha = git(root, ["rev-parse", "HEAD"]).trim();
    const { status, output } = runBaseEnforcer(root, headSha);
    expect(status).toBe(1);
    expect(output).toContain("app/tsconfig.json");
    expect(output).toContain(".github/actions/verify/action.yml");
  }, 60_000);
});
