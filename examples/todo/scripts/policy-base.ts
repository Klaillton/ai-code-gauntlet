/**
 * CHANGE-4 — policy is read from the BASE, not the working tree.
 *
 * - `gauntlet.config.json` policy (protectedGlobs, allow* flags, gates, strictness,
 *   thresholds, allowlists, skipReason/expires, ...) comes from `git show <base>:<path>`.
 * - Base: `origin/$GITHUB_BASE_REF` on pull_request, `github.event.before` on push,
 *   otherwise `origin/main`. CI that cannot resolve the base fails.
 * - Semantic JSON diff base→head, deny by default: any added/removed/changed key needs
 *   the human grant. Only exception: adding or altering `contract.cases` entries
 *   (D13 requires it). Removing a `contract.cases` entry needs the grant.
 * - `scripts/**`, test/mutation runner configs and `.github/workflows/**` changed
 *   base→head need the same grant.
 * - Grant: `POLICY_CHANGE_APPROVED=1` or PR label `policy-change-approved`.
 *   A committed `allow*` / `approved` flag counts only when it is already true in base.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

export const POLICY_GRANT_ENV = "POLICY_CHANGE_APPROVED";
export const POLICY_GRANT_LABEL = "policy-change-approved";
const CONFIG_FILE = "gauntlet.config.json";
const CASES_PATH = "contract.cases";

export type PolicyFinding = {
  id: "policy-base";
  severity: "fail" | "warn" | "info";
  message: string;
};

export type PolicyBase =
  { ok: true; ref: string; range: string; via: string } | { ok: false; reason: string };

export type BaseConfig =
  | { status: "present"; config: Record<string, unknown> }
  | { status: "absent" }
  | { status: "invalid"; reason: string };

export type ConfigChange = {
  path: string;
  kind: "added" | "removed" | "changed";
  /** true only for contract.cases adds/alters (D13 exception). */
  exempt: boolean;
};

type Json = unknown;

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function gitLines(cwd: string, args: string[]): string[] | undefined {
  const out = git(cwd, args);
  if (out === undefined) {
    return undefined;
  }
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function isCi(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CI === "true" || env.CI === "1" || env.GITHUB_ACTIONS === "true";
}

function readEvent(env: NodeJS.ProcessEnv): Record<string, unknown> | undefined {
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(eventPath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Human grant only: env or PR label. Never a committed config value. */
export function policyChangeAllowed(env: NodeJS.ProcessEnv = process.env): {
  allowed: boolean;
  reason: string;
} {
  if (env[POLICY_GRANT_ENV] === "1") {
    return { allowed: true, reason: `${POLICY_GRANT_ENV}=1` };
  }
  const event = readEvent(env) as { pull_request?: { labels?: { name?: string }[] } } | undefined;
  const labels = event?.pull_request?.labels ?? [];
  if (labels.some((label) => label.name === POLICY_GRANT_LABEL)) {
    return { allowed: true, reason: `GitHub label ${POLICY_GRANT_LABEL}` };
  }
  return { allowed: false, reason: "no human policy-change grant" };
}

function commitOf(cwd: string, ref: string): string | undefined {
  return gitLines(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])?.[0];
}

/** Base: origin/$GITHUB_BASE_REF (PR), github.event.before (push), else origin/main. */
export function resolvePolicyBase(cwd: string, env: NodeJS.ProcessEnv = process.env): PolicyBase {
  const baseRef = env.GITHUB_BASE_REF?.trim();
  if (baseRef) {
    const ref = `origin/${baseRef}`;
    return commitOf(cwd, ref)
      ? { ok: true, ref, range: `${ref}...HEAD`, via: "GITHUB_BASE_REF" }
      : {
          ok: false,
          reason: `GITHUB_BASE_REF=${baseRef} but ${ref} is not available (fetch it)`,
        };
  }
  if (env.GITHUB_EVENT_NAME === "push") {
    const before = readEvent(env)?.before;
    if (typeof before !== "string" || before.length === 0 || /^0+$/.test(before)) {
      return {
        ok: false,
        reason: "push event without a usable github.event.before",
      };
    }
    return commitOf(cwd, before)
      ? {
          ok: true,
          ref: before,
          range: `${before}..HEAD`,
          via: "github.event.before",
        }
      : {
          ok: false,
          reason: `github.event.before ${before} is not in the checkout`,
        };
  }
  return commitOf(cwd, "origin/main")
    ? {
        ok: true,
        ref: "origin/main",
        range: "origin/main...HEAD",
        via: "origin/main",
      }
    : {
        ok: false,
        reason: "origin/main is not available (git fetch origin main)",
      };
}

function repoPrefix(cwd: string): string | undefined {
  const out = git(cwd, ["rev-parse", "--show-prefix"]);
  return out === undefined ? undefined : out.trim();
}

export function readBaseConfig(cwd: string, ref: string): BaseConfig {
  const prefix = repoPrefix(cwd) ?? "";
  const spec = `${ref}:${prefix}${CONFIG_FILE}`;
  if (git(cwd, ["cat-file", "-e", spec]) === undefined) {
    return { status: "absent" };
  }
  const raw = git(cwd, ["show", spec]);
  if (raw === undefined) {
    return { status: "invalid", reason: `git show ${spec} failed` };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isObj(parsed)) {
      return { status: "invalid", reason: `${spec} is not a JSON object` };
    }
    return { status: "present", config: parsed };
  } catch {
    return { status: "invalid", reason: `${spec} is not valid JSON` };
  }
}

function isObj(value: Json): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(a: Json, b: Json): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((key) => key in a && key in b && deepEqual(a[key], b[key]));
  }
  return false;
}

function joinPath(path: string, key: string): string {
  return path.length === 0 ? key : `${path}.${key}`;
}

function diffCases(base: Json, head: Json): ConfigChange[] {
  const before = base === undefined ? [] : base;
  const after = head === undefined ? [] : head;
  if (!Array.isArray(before) || !Array.isArray(after)) {
    return deepEqual(base, head)
      ? []
      : [{ path: CASES_PATH, kind: kindOf(base, head), exempt: false }];
  }
  const changes: ConfigChange[] = [];
  after.forEach((entry, index) => {
    const path = `${CASES_PATH}[${index}]`;
    if (!isObj(entry)) {
      // A non-object entry is a removal in disguise.
      changes.push({
        path,
        kind: index < before.length ? "changed" : "added",
        exempt: false,
      });
    } else if (index >= before.length) {
      changes.push({ path, kind: "added", exempt: true });
    } else if (!deepEqual(before[index], entry)) {
      changes.push({ path, kind: "changed", exempt: true });
    }
  });
  for (let index = after.length; index < before.length; index += 1) {
    changes.push({
      path: `${CASES_PATH}[${index}]`,
      kind: "removed",
      exempt: false,
    });
  }
  return changes;
}

function kindOf(base: Json, head: Json): ConfigChange["kind"] {
  if (base === undefined) {
    return "added";
  }
  return head === undefined ? "removed" : "changed";
}

/** Semantic JSON diff, deny by default. Arrays are ordered (gate order matters). */
export function diffPolicy(base: Json, head: Json, path = ""): ConfigChange[] {
  if (path === CASES_PATH) {
    return diffCases(base, head);
  }
  const baseObj = isObj(base) || (base === undefined && isObj(head));
  const headObj = isObj(head) || (head === undefined && isObj(base));
  if (baseObj && headObj) {
    const a = (base ?? {}) as Record<string, unknown>;
    const b = (head ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((key) => diffPolicy(a[key], b[key], joinPath(path, key)));
  }
  if (Array.isArray(base) && Array.isArray(head)) {
    const length = Math.max(base.length, head.length);
    const changes: ConfigChange[] = [];
    for (let index = 0; index < length; index += 1) {
      changes.push(...diffPolicy(base[index], head[index], `${path}[${index}]`));
    }
    return changes;
  }
  if (deepEqual(base, head)) {
    return [];
  }
  return [
    {
      path: path.length === 0 ? "(root)" : path,
      kind: kindOf(base, head),
      exempt: false,
    },
  ];
}

function isGrantKey(key: string): boolean {
  return /^allow[A-Z]/.test(key) || key === "approved";
}

/** A committed allow* / approved flag is true only when it is already true in base. */
export function clampGrants(head: Json, base: Json): Json {
  if (Array.isArray(head)) {
    return head.map((item, index) =>
      clampGrants(item, Array.isArray(base) ? base[index] : undefined),
    );
  }
  if (!isObj(head)) {
    return head;
  }
  const baseObj = isObj(base) ? base : {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(head)) {
    if (isGrantKey(key) && value === true) {
      out[key] = baseObj[key] === true;
    } else {
      out[key] = clampGrants(value, baseObj[key]);
    }
  }
  return out;
}

/**
 * Effective policy: base config with head `contract.cases`; with a human policy
 * grant, head config. Committed grants (allow* / approved) are always clamped to base.
 * No base (first adoption / unresolvable): head, with every committed grant false.
 */
export function effectivePolicy(
  head: Record<string, unknown>,
  base: Record<string, unknown> | undefined,
  granted: boolean,
): Record<string, unknown> {
  if (!base || granted) {
    return clampGrants(head, base) as Record<string, unknown>;
  }
  const merged = structuredClone(base);
  const headContract = head.contract;
  if (isObj(headContract) && "cases" in headContract) {
    const contract = isObj(merged.contract) ? merged.contract : {};
    contract.cases = structuredClone(headContract.cases);
    merged.contract = contract;
  }
  return clampGrants(merged, base) as Record<string, unknown>;
}

function readHeadConfig(cwd: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(resolve(cwd, CONFIG_FILE), "utf8")) as unknown;
  if (!isObj(parsed)) {
    throw new Error(`${CONFIG_FILE} must be a JSON object`);
  }
  return parsed;
}

/** What every gate should read instead of the raw working-tree config. */
export function loadPolicyConfig(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const head = readHeadConfig(cwd);
  const base = resolvePolicyBase(cwd, env);
  const baseConfig = base.ok ? readBaseConfig(cwd, base.ref) : undefined;
  const present = baseConfig?.status === "present" ? baseConfig.config : undefined;
  return effectivePolicy(head, present, policyChangeAllowed(env).allowed);
}

const TEST_CONFIG_RES = [
  /^(?:vitest|vite|jest|playwright|stryker)\.(?:config|workspace|conf)(?:\.[\w-]+)*\.(?:[cm]?[jt]s|json)$/,
  /^vitest\.workspace\.(?:[cm]?[jt]s|json)$/,
  /^cucumber\.(?:[cm]?js|json|ya?ml)$/,
  /^\.(?:c8|nyc|stryker|mocha)rc(?:\.[\w-]+)?$/,
];

/** scripts/**, test + mutation runner configs (tree-relative), .github/workflows/** (repo-relative). */
export function isProtectedPolicyPath(repoRel: string, prefix: string): boolean {
  const normalized = repoRel.replace(/\\/g, "/");
  if (normalized.startsWith(".github/workflows/")) {
    return true;
  }
  const scope = prefix.replace(/\/$/, "");
  if (scope.length > 0 && !normalized.startsWith(`${scope}/`)) {
    return false;
  }
  const treeRel = scope.length > 0 ? normalized.slice(scope.length + 1) : normalized;
  if (treeRel.startsWith("scripts/")) {
    return true;
  }
  if (treeRel.split("/").includes("node_modules")) {
    return false;
  }
  const name = basename(treeRel);
  return TEST_CONFIG_RES.some((re) => re.test(name));
}

function changedFiles(cwd: string, range: string): string[] | undefined {
  const committed = gitLines(cwd, ["diff", "--name-only", range]);
  if (committed === undefined) {
    return undefined;
  }
  const root = gitLines(cwd, ["rev-parse", "--show-toplevel"])?.[0] ?? cwd;
  return [
    ...new Set([
      ...committed,
      ...(gitLines(cwd, ["diff", "--name-only", "HEAD"]) ?? []),
      ...(gitLines(cwd, ["diff", "--name-only", "--cached"]) ?? []),
      ...(gitLines(root, ["ls-files", "--others", "--exclude-standard"]) ?? []),
    ]),
  ].sort((a, b) => a.localeCompare(b));
}

function fail(message: string): PolicyFinding {
  return { id: "policy-base", severity: "fail", message };
}

function info(message: string): PolicyFinding {
  return { id: "policy-base", severity: "info", message };
}

const GRANT_HINT = `Human grant: ${POLICY_GRANT_ENV}=1 or PR label ${POLICY_GRANT_LABEL}.`;

function checkBase(
  cwd: string,
  env: NodeJS.ProcessEnv,
  granted: { allowed: boolean; reason: string },
): {
  base?: Extract<PolicyBase, { ok: true }>;
  baseConfig?: Record<string, unknown>;
  findings: PolicyFinding[];
} {
  const base = resolvePolicyBase(cwd, env);
  if (!base.ok) {
    if (isCi(env)) {
      return {
        findings: [fail(`policy-base: CI cannot resolve the base (${base.reason}).`)],
      };
    }
    if (granted.allowed) {
      return {
        findings: [
          info(
            `policy-base: no base (${base.reason}); local head policy accepted via ${granted.reason}.`,
          ),
        ],
      };
    }
    return {
      findings: [fail(`policy-base: cannot resolve the base (${base.reason}). ${GRANT_HINT}`)],
    };
  }
  const baseConfig = readBaseConfig(cwd, base.ref);
  if (baseConfig.status === "invalid") {
    return {
      base,
      findings: [fail(`policy-base: base config unreadable (${baseConfig.reason}).`)],
    };
  }
  if (baseConfig.status === "absent") {
    const message = `policy-base: ${CONFIG_FILE} absent in base ${base.ref} (first adoption)`;
    return {
      base,
      findings: [
        granted.allowed
          ? info(
              `${message}; head policy accepted via ${granted.reason}; committed allow*/approved stay false.`,
            )
          : fail(`${message}. ${GRANT_HINT}`),
      ],
    };
  }
  return { base, baseConfig: baseConfig.config, findings: [] };
}

export function runPolicyBase(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; findings: PolicyFinding[] } {
  const done = (findings: PolicyFinding[]) => {
    const ok = findings.every((finding) => finding.severity !== "fail");
    writeReport(cwd, ok, findings);
    return { ok, findings };
  };
  const prefix = repoPrefix(cwd);
  if (prefix === undefined) {
    return done([
      fail("policy-base: git required for this gate (rev-parse failed or not a git checkout)."),
    ]);
  }
  let head: Record<string, unknown>;
  try {
    head = readHeadConfig(cwd);
  } catch (error) {
    return done([fail(`policy-base: cannot read ${CONFIG_FILE}: ${(error as Error).message}`)]);
  }
  const granted = policyChangeAllowed(env);
  const { base, baseConfig, findings } = checkBase(cwd, env, granted);
  if (!base || !baseConfig) {
    return done(findings);
  }

  const changes = diffPolicy(baseConfig, head);
  const denied = changes.filter((change) => !change.exempt);
  const exempt = changes.filter((change) => change.exempt);
  if (exempt.length > 0) {
    findings.push(
      info(
        `policy-base: contract.cases add/alter allowed (D13): ${exempt.map((c) => c.path).join(", ")}`,
      ),
    );
  }
  if (denied.length > 0) {
    const list = denied.map((change) => `${change.path} (${change.kind})`).join(", ");
    findings.push(
      granted.allowed
        ? info(`policy-base: ${CONFIG_FILE} policy changes granted via ${granted.reason}: ${list}`)
        : fail(
            `policy-base: ${CONFIG_FILE} changed vs base ${base.ref} without human grant: ${list}. ${GRANT_HINT}`,
          ),
    );
  }

  const files = changedFiles(cwd, base.range);
  if (files === undefined) {
    findings.push(
      fail(`policy-base: git diff ${base.range} failed; cannot prove protected paths.`),
    );
    return done(findings);
  }
  const touched = files.filter((file) => isProtectedPolicyPath(file, prefix));
  if (touched.length > 0) {
    findings.push(
      granted.allowed
        ? info(
            `policy-base: protected policy paths granted via ${granted.reason}: ${touched.join(", ")}`,
          )
        : fail(
            `policy-base: protected policy paths changed vs base ${base.ref} without human grant: ${touched.join(", ")}. ${GRANT_HINT}`,
          ),
    );
  }
  if (findings.length === 0) {
    findings.push(info(`policy-base: policy identical to base ${base.ref} (${base.via}).`));
  }
  return done(findings);
}

function writeReport(cwd: string, ok: boolean, findings: PolicyFinding[]): void {
  try {
    writeFileSync(
      resolve(cwd, "policy-base-report.json"),
      `${JSON.stringify({ ok, generatedAt: new Date().toISOString(), findings }, null, 2)}\n`,
    );
  } catch {
    // report is best-effort; the verdict is the return value
  }
}

export function printPolicyFindings(result: { ok: boolean; findings: PolicyFinding[] }): void {
  console.info(`policy-base — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : finding.severity === "warn" ? "!" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (result.ok) {
    console.info("policy-base passed.");
  } else {
    console.error("policy-base failed.");
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

if (isDirectRun()) {
  const result = runPolicyBase();
  printPolicyFindings(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}
