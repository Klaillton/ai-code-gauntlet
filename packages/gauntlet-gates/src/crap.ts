import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";
import { collectFunctions, type FunctionComplexity } from "./complexity.js";
import { includeGitBranchDivergence, loadConfig } from "./inventory.js";

export type CrapFinding = {
  id: "crap";
  severity: "fail" | "warn" | "info";
  path: string;
  message: string;
};

export type CrapRow = {
  file: string;
  name: string;
  line: number;
  complexity: number;
  coverage: number;
  crap: number;
};

type CrapConfig = {
  include?: string[];
  max?: number;
  coverageSummary?: string;
};

type CoverageFile = {
  lines?: { pct?: number };
};

const DEFAULT_INCLUDE = "src/domain";
const DEFAULT_MAX = 8;
const DEFAULT_COVERAGE = "coverage/coverage-summary.json";

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

function repoRoot(cwd: string): string | undefined {
  return gitLines(cwd, ["rev-parse", "--show-toplevel"])?.[0];
}

/** Uncle Bob CRAP: C² × (1 − coverage)³ + C. coverage is 0..1. */
export function crapScore(complexity: number, coverageRatio: number): number {
  const cov = Math.min(1, Math.max(0, coverageRatio));
  const gap = 1 - cov;
  return complexity * complexity * gap * gap * gap + complexity;
}

export function coverageRatioForRel(
  summary: Record<string, CoverageFile>,
  rel: string,
): number | undefined {
  const needle = rel.split(sep).join("/");
  for (const [key, value] of Object.entries(summary)) {
    if (key === "total") {
      continue;
    }
    const normalized = key.split(sep).join("/");
    if (normalized === needle || normalized.endsWith(`/${needle}`)) {
      const pct = value.lines?.pct;
      if (typeof pct !== "number" || Number.isNaN(pct)) {
        return undefined;
      }
      return pct / 100;
    }
  }
  return undefined;
}

function loadCoverageSummary(cwd: string, rel: string): Record<string, CoverageFile> | undefined {
  const full = resolve(cwd, rel);
  if (!existsSync(full)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(full, "utf8")) as Record<string, CoverageFile>;
  } catch {
    return undefined;
  }
}

function isDomainTs(rel: string, includeRel: string): boolean {
  const normalized = rel.split(sep).join("/");
  const include = includeRel.split(sep).join("/").replace(/\/$/, "");
  return (
    (normalized === include || normalized.startsWith(`${include}/`)) &&
    normalized.endsWith(".ts") &&
    !normalized.endsWith(".d.ts")
  );
}

function changedDomainRels(cwd: string, includeRel: string): { rels: string[]; git: boolean } {
  const root = repoRoot(cwd);
  if (!root) {
    return { rels: [], git: false };
  }
  const prefix = posixRel(root, cwd);
  const names = new Set<string>([
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
  const rels: string[] = [];
  for (const file of names) {
    const normalized = file.split(sep).join("/");
    const stripped =
      prefix.length > 0 && normalized.startsWith(`${prefix}/`)
        ? normalized.slice(prefix.length + 1)
        : normalized;
    if (isDomainTs(stripped, includeRel) || isDomainTs(normalized, includeRel)) {
      const local = isDomainTs(stripped, includeRel) ? stripped : normalized;
      if (!rels.includes(local)) {
        rels.push(local);
      }
    }
  }
  return { rels, git: true };
}

function functionsInFile(cwd: string, rel: string): FunctionComplexity[] {
  const full = resolve(cwd, rel);
  if (!existsSync(full)) {
    return [];
  }
  const source = readFileSync(full, "utf8");
  const sourceFile = ts.createSourceFile(
    full,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return collectFunctions(sourceFile, rel);
}

export function runCrap(cwd = process.cwd()): {
  ok: boolean;
  findings: CrapFinding[];
  rows: CrapRow[];
} {
  const config = loadConfig(cwd) as ReturnType<typeof loadConfig> & {
    complexity?: { include?: string[] };
    crap?: CrapConfig;
  };
  const includeRel =
    config.crap?.include?.[0] ?? config.complexity?.include?.[0] ?? DEFAULT_INCLUDE;
  const max = config.crap?.max ?? DEFAULT_MAX;
  const coverageRel = config.crap?.coverageSummary ?? DEFAULT_COVERAGE;
  const findings: CrapFinding[] = [];
  const rows: CrapRow[] = [];

  const summary = loadCoverageSummary(cwd, coverageRel);
  if (!summary) {
    findings.push({
      id: "crap",
      severity: "fail",
      path: coverageRel,
      message: `crap: missing ${coverageRel} — run unit coverage first.`,
    });
    writeReport(cwd, false, findings, rows, max);
    return { ok: false, findings, rows };
  }

  const { rels, git } = changedDomainRels(cwd, includeRel);
  if (!git) {
    findings.push({
      id: "crap",
      severity: "info",
      path: includeRel,
      message: "crap: git unavailable; skipped (run after unit coverage in a git checkout).",
    });
    writeReport(cwd, true, findings, rows, max);
    return { ok: true, findings, rows };
  }
  if (rels.length === 0) {
    findings.push({
      id: "crap",
      severity: "info",
      path: includeRel,
      message: `crap: no ${includeRel} files in the git diff.`,
    });
    writeReport(cwd, true, findings, rows, max);
    return { ok: true, findings, rows };
  }

  for (const rel of rels.sort((a, b) => a.localeCompare(b))) {
    const coverage = coverageRatioForRel(summary, rel) ?? 0;
    for (const fn of functionsInFile(cwd, rel)) {
      const crap = crapScore(fn.complexity, coverage);
      rows.push({
        file: fn.file,
        name: fn.name,
        line: fn.line,
        complexity: fn.complexity,
        coverage,
        crap,
      });
      if (crap > max) {
        findings.push({
          id: "crap",
          severity: "fail",
          path: rel,
          message:
            `crap: ${rel}:${fn.line} ${fn.name} CRAP ${crap.toFixed(2)} exceeds max ${max} ` +
            `(complexity ${fn.complexity}, file line coverage ${(coverage * 100).toFixed(0)}%)`,
        });
      }
    }
  }

  const ok = findings.every((finding) => finding.severity !== "fail");
  if (ok) {
    findings.push({
      id: "crap",
      severity: "info",
      path: includeRel,
      message: `crap: ${rows.length} function(s) in touched ${includeRel} are ≤ ${max}.`,
    });
  }
  writeReport(cwd, ok, findings, rows, max);
  return { ok, findings, rows };
}

function writeReport(
  cwd: string,
  ok: boolean,
  findings: CrapFinding[],
  rows: CrapRow[],
  max: number,
): void {
  writeFileSync(
    resolve(cwd, "crap-report.json"),
    `${JSON.stringify({ ok, generatedAt: new Date().toISOString(), max, rows, findings }, null, 2)}\n`,
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
  const result = runCrap();
  console.info(`crap — ${result.findings.length} finding(s), ${result.rows.length} function(s)`);
  for (const row of result.rows) {
    console.info(
      `  ${row.file}:${row.line} ${row.name} C=${row.complexity} cov=${(row.coverage * 100).toFixed(0)}% CRAP=${row.crap.toFixed(2)}`,
    );
  }
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("crap failed.");
    process.exitCode = 1;
    return;
  }
  console.info("crap passed.");
}

if (isDirectRun()) {
  main();
}
