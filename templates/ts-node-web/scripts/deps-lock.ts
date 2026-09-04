import { basename, resolve, sep } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { loadConfig } from "./inventory.js";

export type DepsFinding = {
  id: "deps-lock";
  severity: "fail" | "warn" | "info";
  message: string;
};

type ConfigWithDeps = ReturnType<typeof loadConfig> & { allowDepsEdit?: boolean };

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

/** package.json / package-lock.json at kit root, examples/*, templates/*, or app root. */
export function isProtectedDepPath(repoRelPath: string): boolean {
  const normalized = repoRelPath.split(sep).join("/");
  const name = basename(normalized);
  if (name !== "package.json" && name !== "package-lock.json") {
    return false;
  }
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length === 1) {
    return true;
  }
  if (parts.length === 3 && (parts[0] === "examples" || parts[0] === "templates")) {
    return true;
  }
  return false;
}

function depsEditAllowed(
  cwd: string,
  allowDepsEdit: boolean,
): { allowed: boolean; reason: string } {
  if (process.env.ALLOW_DEPS_EDIT === "1") {
    return { allowed: true, reason: "ALLOW_DEPS_EDIT=1" };
  }
  if (existsSync(resolve(cwd, ".gauntlet/allow-deps-edit"))) {
    return { allowed: true, reason: ".gauntlet/allow-deps-edit" };
  }
  if (allowDepsEdit) {
    return { allowed: true, reason: "gauntlet.config.json allowDepsEdit=true" };
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
        pull_request?: { labels?: { name?: string }[] };
      };
      const labels = event.pull_request?.labels ?? [];
      if (labels.some((label) => label.name === "deps-approved")) {
        return { allowed: true, reason: "GitHub label deps-approved" };
      }
    } catch {
      // event payload unreadable; fall through
    }
  }
  return { allowed: false, reason: "no human deps-edit grant" };
}

export function runDepsLock(cwd = process.cwd()): {
  ok: boolean;
  findings: DepsFinding[];
} {
  const config = loadConfig(cwd) as ConfigWithDeps;
  const grant = depsEditAllowed(cwd, config.allowDepsEdit === true);
  const findings: DepsFinding[] = [];

  const root = repoRoot(cwd);
  if (!root) {
    findings.push({
      id: "deps-lock",
      severity: "info",
      message:
        "deps-lock: git unavailable; agents must not edit package.json / package-lock.json without ALLOW_DEPS_EDIT=1.",
    });
    writeReport(cwd, true, findings);
    return { ok: true, findings };
  }

  const changed = new Set<string>([
    ...(gitLines(cwd, ["diff", "--name-only", "HEAD"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "--cached"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "origin/main...HEAD"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "main...HEAD"]) ?? []),
    ...prBaseDiffs(cwd),
  ]);

  const depChanges: string[] = [];
  for (const file of changed) {
    const normalized = file.split(sep).join("/");
    if (isProtectedDepPath(normalized)) {
      depChanges.push(normalized);
    }
  }
  depChanges.sort((a, b) => a.localeCompare(b));

  if (depChanges.length === 0) {
    findings.push({
      id: "deps-lock",
      severity: "info",
      message:
        "deps-lock: no package.json / package-lock.json changes in the git diff (root, examples/*, templates/*).",
    });
    writeReport(cwd, true, findings);
    return { ok: true, findings };
  }

  if (grant.allowed) {
    findings.push({
      id: "deps-lock",
      severity: "info",
      message: `deps-lock: dependency edits granted via ${grant.reason}: ${depChanges.join(", ")}`,
    });
    writeReport(cwd, true, findings);
    return { ok: true, findings };
  }

  findings.push({
    id: "deps-lock",
    severity: "fail",
    message:
      "deps-lock blocked package.json / package-lock.json edits without human grant: " +
      depChanges.join(", ") +
      ". Set ALLOW_DEPS_EDIT=1, add .gauntlet/allow-deps-edit, set allowDepsEdit: true in gauntlet.config.json, or label deps-approved.",
  });
  writeReport(cwd, false, findings);
  return { ok: false, findings };
}

function writeReport(cwd: string, ok: boolean, findings: DepsFinding[]): void {
  writeFileSync(
    resolve(cwd, "deps-lock-report.json"),
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
  const result = runDepsLock();
  console.info(`deps-lock — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("deps-lock failed.");
    process.exitCode = 1;
    return;
  }
  console.info("deps-lock passed.");
}

if (isDirectRun()) {
  main();
}
