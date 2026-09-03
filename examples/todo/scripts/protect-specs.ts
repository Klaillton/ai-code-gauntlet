import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { loadConfig } from "./inventory.js";

export type ProtectFinding = {
  id: "protect-specs";
  severity: "fail" | "warn" | "info";
  message: string;
};

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
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
    const prefix = pattern.slice(0, -("/**/*.feature".length));
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
      suffix.length === 0 ||
      normalized.endsWith(suffix) ||
      normalized.includes("/" + suffix);
    return headOk && tailOk;
  }
  return normalized === pattern || normalized.endsWith("/" + pattern);
}

function specEditAllowed(
  cwd: string,
  allowSpecEdit: boolean,
): { allowed: boolean; reason: string } {
  if (process.env.ALLOW_SPEC_EDIT === "1") {
    return { allowed: true, reason: "ALLOW_SPEC_EDIT=1" };
  }
  if (existsSync(resolve(cwd, ".gauntlet/allow-spec-edit"))) {
    return { allowed: true, reason: ".gauntlet/allow-spec-edit" };
  }
  if (allowSpecEdit) {
    return { allowed: true, reason: "gauntlet.config.json allowSpecEdit=true" };
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
        pull_request?: { labels?: { name?: string }[] };
      };
      const labels = event.pull_request?.labels ?? [];
      if (labels.some((label) => label.name === "specs-approved")) {
        return { allowed: true, reason: "GitHub label specs-approved" };
      }
    } catch {
      // event payload unreadable; fall through
    }
  }
  return { allowed: false, reason: "no human spec-edit grant" };
}

export function runProtectSpecs(cwd = process.cwd()): {
  ok: boolean;
  findings: ProtectFinding[];
} {
  const config = loadConfig(cwd);
  const globs = config.agent?.protectedGlobs ?? [
    "features/**/*.feature",
    "openapi/openapi.yaml",
  ];
  const grant = specEditAllowed(cwd, config.allowSpecEdit === true);
  const findings: ProtectFinding[] = [];

  const root = repoRoot(cwd);
  if (!root) {
    findings.push({
      id: "protect-specs",
      severity: "info",
      message:
        "protect-specs: git unavailable; agents must not edit features/ or openapi/ without ALLOW_SPEC_EDIT=1.",
    });
    writeReport(cwd, true, findings);
    return { ok: true, findings };
  }

  const prefix = posixRel(root, cwd);
  const changed = new Set<string>([
    ...(gitLines(cwd, ["diff", "--name-only", "HEAD"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "--cached"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "origin/main...HEAD"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "main...HEAD"]) ?? []),
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
      ". Set ALLOW_SPEC_EDIT=1, add .gauntlet/allow-spec-edit, or label specs-approved.",
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
