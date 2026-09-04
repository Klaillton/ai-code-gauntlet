import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";
import { loadConfig } from "./inventory.js";

/**
 * Stryker-equivalent mutation gate for src/domain.
 *
 * Official Stryker was not added as a package: this change is authored via
 * GitHub MCP (cannot measure a live kill score), and a lockfile bump would
 * collide with open PR #5 (deps-lock). Operators match Stryker's core set
 * (equality, relational, logical, boolean, unary-not, numeric increment).
 *
 * Initial threshold is 60% — TODO: raise after CI measures the real score
 * (target >=80%). Timeout is treated as killed (Stryker-like) to avoid
 * flake-fails; see ADR-phase2-mutation-complexity.md.
 *
 * Template verify omits the mutation gate for speed. Run the script opt-in.
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
  score: number;
  threshold: number;
  findings: string[];
  mutants: MutantResult[];
};

type MutationConfig = {
  include?: string[];
  threshold?: number;
  timeoutMs?: number;
};

const DEFAULT_INCLUDE = "src/domain";
const DEFAULT_THRESHOLD = 60;
const DEFAULT_TIMEOUT_MS = 90_000;

type PlannedMutant = {
  start: number;
  end: number;
  replacement: string;
  operator: string;
};

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
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
    execFileSync("npx", ["vitest", "run"], {
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

  const files = walkTs(includeDir);
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

  const killed = mutants.filter((m) => m.status === "killed" || m.status === "timeout").length;
  const survived = mutants.filter((m) => m.status === "survived").length;
  const timeout = mutants.filter((m) => m.status === "timeout").length;
  const error = mutants.filter((m) => m.status === "error").length;
  const mutantCount = mutants.length;
  const score = mutantCount === 0 ? 100 : Math.round((killed / mutantCount) * 100);
  if (mutantCount === 0) {
    findings.push(
      `No mutable sites under ${includeRel}; treating score as 100. Add operators or domain logic as the app grows.`,
    );
  }
  if (score < threshold) {
    findings.push(
      `Kill score ${score}% is below threshold ${threshold}%. TODO: raise after measuring.`,
    );
  }

  const report: MutationReport = {
    ok: score >= threshold && error === 0,
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
