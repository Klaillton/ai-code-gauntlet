import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";
import { includeGitBranchDivergence, loadConfig } from "./inventory.js";

/**
 * Stryker-equivalent mutation gate for src/domain.
 *
 * Official Stryker was not added as a package: this change is authored via
 * GitHub MCP (cannot measure a live kill score), and a lockfile bump would
 * collide with open PR #5 (deps-lock). Operators match Stryker's core set
 * (equality, relational, logical, boolean, unary-not, numeric increment).
 *
 * Threshold is 80% after CI measured 100% kill (7/7) on Todo domain
 * (gauntlet-todo artifact, verify run on main 2026-09-16). Timeout is
 * treated as killed (Stryker-like) to avoid flake-fails; see
 * ADR-phase2-mutation-complexity.md.
 *
 * CHANGE-2: empty mutants/sites never score 100% — fail or committed skipReason+expires.
 * Differential PR with no include hits soft-skips (not 100%).
 */

export type MutantStatus = "killed" | "survived" | "timeout" | "error";

export type MutantResult = {
  file: string;
  line: number;
  column: number;
  operator: string;
  original: string;
  replacement: string;
  status: MutantStatus;
};

export type MutationReport = {
  ok: boolean;
  generatedAt: string;
  include: string;
  mutantCount: number;
  killed: number;
  survived: number;
  timeout: number;
  error: number;
  /** Kill score; 0 when empty-surface fail/skip (never 100 on empty — CHANGE-2). */
  score: number;
  threshold: number;
  findings: string[];
  mutants: MutantResult[];
  /** True when gate skipped (diff miss or committed skipReason). */
  skipped?: boolean;
};

type MutationConfig = {
  include?: string[];
  threshold?: number;
  timeoutMs?: number;
  /**
   * CHANGE-2: committed skip for empty mutation surface (never score 100).
   * Requires expires (YYYY-MM-DD); expired entries do not grant.
   */
  skipReason?: string;
  expires?: string;
};

const DEFAULT_INCLUDE = "src/domain";
const DEFAULT_THRESHOLD = 80;
const DEFAULT_TIMEOUT_MS = 90_000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayUtcIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value);
}

export type EmptyMutationSurfaceResult =
  | { outcome: "proceed" }
  | { outcome: "skip"; finding: string }
  | { outcome: "fail"; finding: string };

/**
 * CHANGE-2 — empty mutation surface must never score 100%.
 *
 * - differentialSkip: PR selected zero include files → soft skip (ok), not 100%.
 * - Otherwise fail unless committed skipReason + non-expired expires.
 */
export function resolveEmptyMutationSurface(input: {
  mutantCount: number;
  differentialSkip: boolean;
  skipReason?: string;
  expires?: string;
  today?: string;
  label?: string;
}): EmptyMutationSurfaceResult {
  if (input.mutantCount > 0) {
    return { outcome: "proceed" };
  }
  const label = input.label ?? "mutation";
  if (input.differentialSkip) {
    return {
      outcome: "skip",
      finding: `${label}: empty mutation surface not in this diff; gate skipped (not 100%).`,
    };
  }
  const reason = input.skipReason?.trim() ?? "";
  const expires = input.expires?.trim() ?? "";
  const today = input.today ?? todayUtcIso();
  if (reason.length > 0) {
    if (!isIsoDate(expires)) {
      return {
        outcome: "fail",
        finding:
          `${label}: empty mutation surface — skipReason requires expires (YYYY-MM-DD); ` +
          `never score 100% on empty.`,
      };
    }
    if (expires < today) {
      return {
        outcome: "fail",
        finding:
          `${label}: empty mutation surface — skipReason expired on ${expires} ` +
          `(expired entries do not grant; never score 100% on empty).`,
      };
    }
    return {
      outcome: "skip",
      finding: `${label}: empty mutation surface skipped — ${reason} (expires ${expires}).`,
    };
  }
  return {
    outcome: "fail",
    finding:
      `${label}: empty mutation surface — zero mutants/sites while gate is enabled. ` +
      `Fail-closed (never 100%). Add mutable domain logic, or set mutation.skipReason + expires.`,
  };
}

type PlannedMutant = {
  start: number;
  end: number;
  replacement: string;
  operator: string;
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

/**
 * Main-push or no git changes → full include set (fail-closed).
 * PR with changes but none under include → skip (empty).
 * PR with include hits → only those files.
 */
export function selectMutationFiles(
  allAbs: string[],
  cwd: string,
  includeChangedRels: string[],
  diverge: boolean,
  anyGitChange: boolean,
): string[] {
  if (!diverge || !anyGitChange) {
    return allAbs;
  }
  if (includeChangedRels.length === 0) {
    return [];
  }
  const wanted = new Set(includeChangedRels.map((rel) => rel.split(sep).join("/")));
  const selected = allAbs.filter((abs) => wanted.has(posixRel(cwd, abs)));
  return selected.length > 0 ? selected : [];
}

export function listGitChangedRels(cwd: string): string[] {
  const root = gitLines(cwd, ["rev-parse", "--show-toplevel"])?.[0];
  if (!root) {
    return [];
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
    rels.push(stripped);
  }
  return rels;
}

function walkTs(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTs(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function isInTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isTypeNode(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeParameterDeclaration(current) ||
      ts.isHeritageClause(current)
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function binarySwap(kind: ts.SyntaxKind): string | undefined {
  switch (kind) {
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
      return "!==";
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
      return "===";
    case ts.SyntaxKind.EqualsEqualsToken:
      return "!=";
    case ts.SyntaxKind.ExclamationEqualsToken:
      return "==";
    case ts.SyntaxKind.GreaterThanToken:
      return "<=";
    case ts.SyntaxKind.GreaterThanEqualsToken:
      return "<";
    case ts.SyntaxKind.LessThanToken:
      return ">=";
    case ts.SyntaxKind.LessThanEqualsToken:
      return ">";
    case ts.SyntaxKind.AmpersandAmpersandToken:
      return "||";
    case ts.SyntaxKind.BarBarToken:
      return "&&";
    case ts.SyntaxKind.PlusToken:
      return "-";
    case ts.SyntaxKind.MinusToken:
      return "+";
    default:
      return undefined;
  }
}

function planMutants(sourceFile: ts.SourceFile): PlannedMutant[] {
  const planned: PlannedMutant[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      return;
    }
    if (isInTypePosition(node)) {
      return;
    }

    if (ts.isBinaryExpression(node)) {
      const replacement = binarySwap(node.operatorToken.kind);
      if (replacement) {
        planned.push({
          start: node.operatorToken.getStart(sourceFile),
          end: node.operatorToken.end,
          replacement,
          operator: `binary:${node.operatorToken.getText(sourceFile)}->${replacement}`,
        });
      }
    }

    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
      planned.push({
        start: node.getStart(sourceFile),
        end: node.operand.getStart(sourceFile),
        replacement: "",
        operator: "remove-not",
      });
    }

    if (node.kind === ts.SyntaxKind.TrueKeyword) {
      planned.push({
        start: node.getStart(sourceFile),
        end: node.end,
        replacement: "false",
        operator: "true->false",
      });
    }
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
      planned.push({
        start: node.getStart(sourceFile),
        end: node.end,
        replacement: "true",
        operator: "false->true",
      });
    }

    if (ts.isNumericLiteral(node)) {
      const value = Number(node.text);
      if (Number.isFinite(value)) {
        planned.push({
          start: node.getStart(sourceFile),
          end: node.end,
          replacement: String(value + 1),
          operator: `number:${node.text}->${value + 1}`,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  planned.sort((a, b) => a.start - b.start || a.end - b.end);
  return planned;
}

function applyMutant(source: string, mutant: PlannedMutant): string {
  return source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.end);
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const rec = error as { killed?: boolean; signal?: string; code?: string };
  return rec.killed === true || rec.signal === "SIGTERM" || rec.code === "ETIMEDOUT";
}

function runVitest(cwd: string, timeoutMs: number): MutantStatus {
  try {
    const vitestCli = join(cwd, "node_modules", "vitest", "vitest.mjs");
    if (!existsSync(vitestCli)) {
      return "error";
    }
    execFileSync(process.execPath, [vitestCli, "run"], {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: process.env.CI ?? "1" },
    });
    return "survived";
  } catch (error) {
    if (isTimeoutError(error)) {
      return "timeout";
    }
    const status = (error as { status?: number }).status;
    if (typeof status === "number" && status !== 0) {
      return "killed";
    }
    return "error";
  }
}

function restoreAll(originals: Map<string, string>): void {
  for (const [file, content] of originals) {
    writeFileSync(file, content);
  }
}

function lineCol(source: string, pos: number): { line: number; column: number } {
  const prefix = source.slice(0, pos);
  const lines = prefix.split(/\r?\n/);
  return { line: lines.length, column: (lines[lines.length - 1] ?? "").length + 1 };
}

export function runMutation(cwd = process.cwd()): MutationReport {
  const config = loadConfig(cwd);
  const extra = config as { mutation?: MutationConfig };
  const includeRel = extra.mutation?.include?.[0] ?? DEFAULT_INCLUDE;
  const threshold = extra.mutation?.threshold ?? DEFAULT_THRESHOLD;
  const timeoutMs = extra.mutation?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const includeDir = resolve(cwd, includeRel);
  const findings: string[] = [];

  const allFiles = walkTs(includeDir);
  const allChanged = listGitChangedRels(cwd);
  const includePrefix = includeRel.split(sep).join("/").replace(/\/$/, "");
  const includeChanged = allChanged.filter(
    (rel) => rel === includePrefix || rel.startsWith(`${includePrefix}/`),
  );
  const files = selectMutationFiles(
    allFiles,
    cwd,
    includeChanged,
    includeGitBranchDivergence(),
    allChanged.length > 0,
  );
  const originals = new Map<string, string>();
  for (const file of files) {
    originals.set(file, readFileSync(file, "utf8"));
  }

  const baseline = runVitest(cwd, timeoutMs);
  if (baseline !== "survived") {
    findings.push(`Baseline unit tests did not pass (${baseline}); mutation is fail-closed.`);
    const report: MutationReport = {
      ok: false,
      generatedAt: new Date().toISOString(),
      include: includeRel,
      mutantCount: 0,
      killed: 0,
      survived: 0,
      timeout: 0,
      error: 1,
      score: 0,
      threshold,
      findings,
      mutants: [],
    };
    writeFileSync(resolve(cwd, "mutation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  const mutants: MutantResult[] = [];
  try {
    for (const file of files) {
      const source = originals.get(file) ?? "";
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const planned = planMutants(sourceFile);
      const rel = posixRel(cwd, file);
      for (const mutant of planned) {
        const loc = lineCol(source, mutant.start);
        writeFileSync(file, applyMutant(source, mutant));
        const status = runVitest(cwd, timeoutMs);
        writeFileSync(file, source);
        mutants.push({
          file: rel,
          line: loc.line,
          column: loc.column,
          operator: mutant.operator,
          original: source.slice(mutant.start, mutant.end),
          replacement: mutant.replacement,
          status,
        });
        if (status === "survived") {
          const from = source.slice(mutant.start, mutant.end);
          const to = mutant.replacement || "(empty)";
          findings.push(
            `Survivor ${rel}:${loc.line}:${loc.column} ${mutant.operator} (${from} -> ${to})`,
          );
        }
      }
    }
  } finally {
    restoreAll(originals);
  }

  const killed = mutants.filter((m) => m.status === "killed").length;
  const survived = mutants.filter((m) => m.status === "survived").length;
  const timeout = mutants.filter((m) => m.status === "timeout").length;
  const error = mutants.filter((m) => m.status === "error").length;
  const mutantCount = mutants.length;
  const differentialSkip =
    includeGitBranchDivergence() && allChanged.length > 0 && files.length === 0;
  const empty = resolveEmptyMutationSurface({
    mutantCount,
    differentialSkip,
    ...(extra.mutation?.skipReason !== undefined ? { skipReason: extra.mutation.skipReason } : {}),
    ...(extra.mutation?.expires !== undefined ? { expires: extra.mutation.expires } : {}),
    label: "mutation",
  });

  let score = 0;
  let skipped = false;
  let ok = false;
  if (empty.outcome === "fail") {
    findings.push(empty.finding);
    score = 0;
    ok = false;
  } else if (empty.outcome === "skip") {
    findings.push(empty.finding);
    score = 0;
    skipped = true;
    ok = error === 0;
  } else {
    score = Math.round((killed / mutantCount) * 100);
    if (score < threshold) {
      findings.push(`Kill score ${score}% is below threshold ${threshold}%.`);
    }
    if (timeout > 0) {
      findings.push(`${timeout} mutant(s) timed out — timeouts are not kills (fail-closed).`);
    }
    ok = score >= threshold && error === 0 && timeout === 0;
  }

  const report: MutationReport = {
    ok,
    generatedAt: new Date().toISOString(),
    include: includeRel,
    mutantCount,
    killed,
    survived,
    timeout,
    error,
    score,
    threshold,
    findings,
    mutants,
    skipped,
  };
  writeFileSync(resolve(cwd, "mutation-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

function main(): void {
  const result = runMutation();
  console.info(
    `mutation (${result.include}) — ${result.score}% killed (${result.killed}/${result.mutantCount}), threshold ${result.threshold}%`,
  );
  for (const finding of result.findings) {
    const log = result.ok ? console.info : console.error;
    log(`  ${result.ok ? "i" : "x"} ${finding}`);
  }
  if (!result.ok) {
    console.error("mutation failed.");
    process.exitCode = 1;
    return;
  }
  console.info("mutation passed.");
}

if (isDirectRun()) {
  main();
}
