import { writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { resolveHumanGrant } from "./human-grant.js";
import { includeGitBranchDivergence, loadConfig } from "./inventory.js";

export type ProtectFinding = {
  id: "protect-specs";
  severity: "fail" | "warn" | "info";
  message: string;
};

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function prBaseDiffs(cwd: string): string[] {
  const base = process.env.GITHUB_BASE_REF;
  if (!base) {
    return [];
  }
  return [
    ...(gitLines(cwd, ["diff", "--name-only", `origin/${base}...HEAD`]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", `${base}...HEAD`]) ?? []),
  ];
}

function gitLines(cwd: string, args: string[]): string[] | undefined {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return undefined;
  }
}

function repoRoot(cwd: string): string | undefined {
  const lines = gitLines(cwd, ["rev-parse", "--show-toplevel"]);
  return lines?.[0];
}

function matchGlob(rel: string, glob: string): boolean {
  const normalized = rel.split(sep).join("/");
  const pattern = glob.split(sep).join("/");
  if (pattern.endsWith("/**/*.feature")) {
    const prefix = pattern.slice(0, -"/**/*.feature".length);
    const head = prefix === "" ? "features/" : prefix + "/";
    return normalized.startsWith(head) && normalized.endsWith(".feature");
  }
  if (pattern.includes("**")) {
    const [head, tail] = pattern.split("**");
    const prefix = (head ?? "").replace(/\/$/, "");
    const suffix = (tail ?? "").replace(/^\//, "");
    const headOk =
      prefix.length === 0 || normalized.startsWith(prefix + "/") || normalized === prefix;
    const tailOk =
      suffix.length === 0 || normalized.endsWith(suffix) || normalized.includes("/" + suffix);
    return headOk && tailOk;
  }
  return normalized === pattern || normalized.endsWith("/" + pattern);
}

/** Grants (app-identity-2): committed config already true in base (CHANGE-4), else the human
 * grant from `human-grant.ts` (label specs-approved + APPROVED human review on the exact head SHA in
 * CI; ALLOW_SPEC_EDIT=1 on a local run). Never a working-tree allow file. */
export function specEditAllowed(
  cwd: string,
  allowSpecEdit: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { allowed: boolean; reason: string } {
  void cwd;
  if (allowSpecEdit) {
    return {
      allowed: true,
      reason: "base-branch gauntlet.config.json allowSpecEdit=true",
    };
  }
  return resolveHumanGrant({
    label: "specs-approved",
    envFlag: "ALLOW_SPEC_EDIT",
    env,
  });
}

export function runProtectSpecs(cwd = process.cwd()): {
  ok: boolean;
  findings: ProtectFinding[];
} {
  const config = loadConfig(cwd);
  const globs = config.agent?.protectedGlobs ?? ["features/**/*.feature", "openapi/openapi.yaml"];
  const grant = specEditAllowed(cwd, config.allowSpecEdit === true);
  const findings: ProtectFinding[] = [];

  const root = repoRoot(cwd);
  if (!root) {
    findings.push({
      id: "protect-specs",
      severity: "fail",
      message:
        "protect-specs: git required for this gate (rev-parse failed or not a git checkout).",
    });
    writeReport(cwd, false, findings);
    return { ok: false, findings };
  }

  const prefix = posixRel(root, cwd);
  const changed = new Set<string>([
    ...(gitLines(cwd, ["diff", "--name-only", "HEAD"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "--cached"]) ?? []),
    ...(includeGitBranchDivergence()
      ? [
          ...(gitLines(cwd, ["diff", "--name-only", "origin/main...HEAD"]) ?? []),
          ...(gitLines(cwd, ["diff", "--name-only", "main...HEAD"]) ?? []),
          ...prBaseDiffs(cwd),
        ]
      : []),
  ]);

  const localChanges: string[] = [];
  for (const file of changed) {
    const normalized = file.split(sep).join("/");
    const stripped =
      prefix.length > 0 && normalized.startsWith(prefix + "/")
        ? normalized.slice(prefix.length + 1)
        : normalized;
    if (globs.some((glob) => matchGlob(stripped, glob) || matchGlob(normalized, glob))) {
      localChanges.push(normalized);
    }
  }

  if (localChanges.length === 0) {
    findings.push({
      id: "protect-specs",
      severity: "info",
      message: "protect-specs: no protected spec files in the git diff.",
    });
    writeReport(cwd, true, findings);
    return { ok: true, findings };
  }

  if (grant.allowed) {
    findings.push({
      id: "protect-specs",
      severity: "info",
      message: `protect-specs: spec edits granted via ${grant.reason}: ${localChanges.join(", ")}`,
    });
    writeReport(cwd, true, findings);
    return { ok: true, findings };
  }

  findings.push({
    id: "protect-specs",
    severity: "fail",
    message:
      "protect-specs blocked spec edits without human grant: " +
      localChanges.join(", ") +
      ". Grant: label specs-approved + a human APPROVED review on the exact head SHA (app-identity-2; " +
      "ALLOW_SPEC_EDIT=1 on local runs only), or allowSpecEdit: true already on the base branch (CHANGE-4). " +
      `Grant check: ${grant.reason}.`,
  });
  writeReport(cwd, false, findings);
  return { ok: false, findings };
}

function writeReport(cwd: string, ok: boolean, findings: ProtectFinding[]): void {
  writeFileSync(
    resolve(cwd, "protect-specs-report.json"),
    `${JSON.stringify({ ok, generatedAt: new Date().toISOString(), findings }, null, 2)}\n`,
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

function main(): void {
  const result = runProtectSpecs();
  console.info(`protect-specs — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("protect-specs failed.");
    process.exitCode = 1;
    return;
  }
  console.info("protect-specs passed.");
}

if (isDirectRun()) {
  main();
}
