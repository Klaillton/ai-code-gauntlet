import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";
import { loadConfig } from "./inventory.js";

/**
 * Deterministic cyclomatic-complexity budget for src/domain.
 *
 * Uncle Bob's CRAP <= 8 needs coverage in the formula
 * (complexity^2 * (1-coverage)^3 + complexity). Without a coverage combo
 * this MVP fails any domain function whose cyclomatic complexity exceeds
 * max 10 (eslint-compatible decision-point count).
 */

export type FunctionComplexity = {
  file: string;
  name: string;
  line: number;
  complexity: number;
};

export type ComplexityReport = {
  ok: boolean;
  generatedAt: string;
  include: string;
  max: number;
  functions: FunctionComplexity[];
  findings: string[];
};

type ComplexityConfig = {
  include?: string[];
  max?: number;
};

const DEFAULT_INCLUDE = "src/domain";
const DEFAULT_MAX = 10;

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

function isDecision(node: ts.Node): boolean {
  if (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isCaseClause(node) ||
    ts.isCatchClause(node) ||
    ts.isConditionalExpression(node)
  ) {
    return true;
  }
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    return (
      kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken
    );
  }
  return false;
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  );
}

function cyclomatic(node: ts.FunctionLikeDeclaration): number {
  let score = 1;
  const visit = (current: ts.Node): void => {
    if (current !== node && isFunctionLike(current)) {
      return;
    }
    if (isDecision(current)) {
      score += 1;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return score;
}

function functionName(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
  if (node.name) {
    return node.name.getText(sourceFile);
  }
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && parent.name) {
      return parent.name.getText(sourceFile);
    }
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (ts.isPropertyDeclaration(parent) && parent.name) {
      return parent.name.getText(sourceFile);
    }
    return "(anonymous)";
  }
  return "(anonymous)";
}

function collectFunctions(sourceFile: ts.SourceFile, rel: string): FunctionComplexity[] {
  const found: FunctionComplexity[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) && node.body) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push({
        file: rel,
        name: functionName(node, sourceFile),
        line: start.line + 1,
        complexity: cyclomatic(node),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function runComplexity(cwd = process.cwd()): ComplexityReport {
  const config = loadConfig(cwd);
  const extra = config as { complexity?: ComplexityConfig };
  const includeRel = extra.complexity?.include?.[0] ?? DEFAULT_INCLUDE;
  const max = extra.complexity?.max ?? DEFAULT_MAX;
  const includeDir = resolve(cwd, includeRel);
  const functions: FunctionComplexity[] = [];

  for (const file of walkTs(includeDir)) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    functions.push(...collectFunctions(sourceFile, posixRel(cwd, file)));
  }

  functions.sort((a, b) => {
    const byFile = a.file.localeCompare(b.file);
    if (byFile !== 0) {
      return byFile;
    }
    return a.line - b.line;
  });

  const findings = functions
    .filter((fn) => fn.complexity > max)
    .map((fn) => `${fn.file}:${fn.line} ${fn.name} cyclomatic ${fn.complexity} exceeds max ${max}`);

  const report: ComplexityReport = {
    ok: findings.length === 0,
    generatedAt: new Date().toISOString(),
    include: includeRel,
    max,
    functions,
    findings,
  };
  writeFileSync(resolve(cwd, "complexity-report.json"), `${JSON.stringify(report, null, 2)}\n`);
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
  const result = runComplexity();
  console.info(
    `complexity (${result.include}) — ${result.functions.length} function(s), max ${result.max}`,
  );
  for (const fn of result.functions) {
    console.info(`  ${fn.file}:${fn.line} ${fn.name} = ${fn.complexity}`);
  }
  for (const finding of result.findings) {
    console.error(`  x ${finding}`);
  }
  if (!result.ok) {
    console.error("complexity failed.");
    process.exitCode = 1;
    return;
  }
  console.info("complexity passed.");
}

if (isDirectRun()) {
  main();
}
