/**
 * CHANGE-3 — DoD checkbox: spec↔code pairing on the same PR.
 *
 * When the diff touches implementation (`src/**` by default), the same PR must
 * also touch a protected spec (Gherkin / OpenAPI / holes-review) **or** carry a
 * human grant. Docs-only / spec-only diffs skip. No local allow-file.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { includeGitBranchDivergence, loadConfig } from "./inventory.js";
import { isImplementationPath, matchGlob } from "./holes-review.js";

export type SpecCodeFinding = {
  id: "CHANGE-3" | "spec-code";
  severity: "fail" | "warn" | "info";
  message: string;
};

export const DEFAULT_IMPL_GLOBS = ["src/**"] as const;
export const DEFAULT_SPEC_GLOBS = [
  "features/**/*.feature",
  "openapi/openapi.yaml",
  "openapi/**/*.yaml",
  "openapi/**/*.yml",
  "docs/holes-review/**/*.md",
] as const;

type SpecCodeConfig = {
  implementationGlobs?: string[];
  /** Override protected-spec globs; default merges agent.protectedGlobs + kit defaults. */
  specGlobs?: string[];
  approved?: boolean;
};

type ConfigWithSpecCode = ReturnType<typeof loadConfig> & {
  allowSpecCodeSkip?: boolean;
  specCode?: SpecCodeConfig;
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
  return gitLines(cwd, ["rev-parse", "--show-toplevel"])?.[0];
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

/** Grants: env, committed config, or CI label — never a working-tree allow-file. */
export function specCodeAllowed(
  cwd: string,
  allowSkip: boolean,
): { allowed: boolean; reason: string } {
  if (process.env.SPEC_SYNC_APPROVED === "1") {
    return { allowed: true, reason: "SPEC_SYNC_APPROVED=1" };
  }
  if (allowSkip) {
    return { allowed: true, reason: "gauntlet.config.json allowSpecCodeSkip/specCode.approved" };
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
        pull_request?: { labels?: { name?: string }[] };
      };
      const labels = event.pull_request?.labels ?? [];
      if (labels.some((label) => label.name === "spec-sync-approved")) {
        return { allowed: true, reason: "GitHub label spec-sync-approved" };
      }
    } catch {
      // fall through
    }
  }
  void cwd;
  return { allowed: false, reason: "no human SPEC_SYNC_APPROVED grant" };
}

export function isProtectedSpecPath(rel: string, specGlobs: readonly string[]): boolean {
  return specGlobs.some((glob) => matchGlob(rel, glob));
}

export function resolveSpecGlobs(config: ConfigWithSpecCode): string[] {
  const fromCfg = config.specCode?.specGlobs;
  if (fromCfg && fromCfg.length > 0) {
    return [...fromCfg];
  }
  const protectedGlobs = config.agent?.protectedGlobs ?? [];
  const merged = new Set<string>([...DEFAULT_SPEC_GLOBS, ...protectedGlobs]);
  return [...merged];
}

export type SpecCodeEvalInput = {
  appRelChanged: string[];
  grant: { allowed: boolean; reason: string };
  implementationGlobs?: readonly string[];
  specGlobs?: readonly string[];
};

/** Pure CHANGE-3 rules (no git). */
export function evaluateSpecCode(input: SpecCodeEvalInput): SpecCodeFinding[] {
  const implGlobs = input.implementationGlobs ?? DEFAULT_IMPL_GLOBS;
  const specGlobs = input.specGlobs ?? DEFAULT_SPEC_GLOBS;
  const implChanges = input.appRelChanged.filter((rel) => isImplementationPath(rel, implGlobs));
  const specChanges = input.appRelChanged.filter((rel) => isProtectedSpecPath(rel, specGlobs));
  const findings: SpecCodeFinding[] = [];

  if (implChanges.length === 0) {
    findings.push({
      id: "CHANGE-3",
      severity: "info",
      message:
        "CHANGE-3 spec-code: no implementation paths in the git diff; DoD pairing not required.",
    });
    return findings;
  }

  if (input.grant.allowed) {
    findings.push({
      id: "CHANGE-3",
      severity: "info",
      message: `CHANGE-3 spec-code: human grant (${input.grant.reason}); pairing waived.`,
    });
    return findings;
  }

  if (specChanges.length > 0) {
    findings.push({
      id: "CHANGE-3",
      severity: "info",
      message:
        `CHANGE-3 spec-code: implementation + protected spec in the same PR ` +
        `(${specChanges.slice(0, 5).join(", ")}${specChanges.length > 5 ? ", …" : ""}).`,
    });
    return findings;
  }

  findings.push({
    id: "CHANGE-3",
    severity: "fail",
    message:
      "CHANGE-3 spec-code: implementation (`src/**`) changed without protected spec " +
      "(Gherkin/OpenAPI/holes-review) in the same PR. Add a spec touch, or grant " +
      "SPEC_SYNC_APPROVED=1 / label spec-sync-approved / committed allowSpecCodeSkip.",
  });
  return findings;
}

function toAppRel(repoRel: string, prefix: string): string {
  const normalized = repoRel.split(sep).join("/");
  if (prefix.length > 0 && normalized.startsWith(prefix + "/")) {
    return normalized.slice(prefix.length + 1);
  }
  return normalized;
}

export function runSpecCode(cwd = process.cwd()): {
  ok: boolean;
  findings: SpecCodeFinding[];
} {
  const config = loadConfig(cwd) as ConfigWithSpecCode;
  const specCfg = config.specCode ?? {};
  const implGlobs = specCfg.implementationGlobs ?? [...DEFAULT_IMPL_GLOBS];
  const specGlobs = resolveSpecGlobs(config);
  const allowSkip = config.allowSpecCodeSkip === true || specCfg.approved === true;
  const grant = specCodeAllowed(cwd, allowSkip);
  const findings: SpecCodeFinding[] = [];

  const root = repoRoot(cwd);
  if (!root) {
    findings.push({
      id: "CHANGE-3",
      severity: "fail",
      message: "spec-code: git required for this gate (rev-parse failed or not a git checkout).",
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

  const appRelChanged = [...changed]
    .map((file) => toAppRel(file, prefix))
    .filter((rel) => {
      if (prefix.length > 0) {
        const repoRel = [...changed].find((c) => toAppRel(c, prefix) === rel) ?? rel;
        const full = repoRel.split(sep).join("/");
        return full.startsWith(prefix + "/") || !full.includes("/");
      }
      return true;
    });

  findings.push(
    ...evaluateSpecCode({
      appRelChanged,
      grant,
      implementationGlobs: implGlobs,
      specGlobs,
    }),
  );

  const ok = findings.every((f) => f.severity !== "fail");
  writeReport(cwd, ok, findings);
  return { ok, findings };
}

function writeReport(cwd: string, ok: boolean, findings: SpecCodeFinding[]): void {
  writeFileSync(
    resolve(cwd, "spec-code-report.json"),
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

export function printSpecCode(result: { ok: boolean; findings: SpecCodeFinding[] }): void {
  console.info(`spec-code — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : finding.severity === "warn" ? "!" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("spec-code failed.");
    process.exitCode = 1;
    return;
  }
  console.info("spec-code passed.");
}

if (isDirectRun()) {
  printSpecCode(runSpecCode());
}
