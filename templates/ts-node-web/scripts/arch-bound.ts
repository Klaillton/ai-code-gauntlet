import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";
import { loadConfig, posixRel } from "./inventory.js";

export type ArchFinding = {
  id: "arch-bound";
  severity: "fail" | "warn" | "info";
  path: string;
  line?: number;
  message: string;
};

type ArchConfig = {
  include?: string[];
  forbidModules?: string[];
};

const DEFAULT_INCLUDE = "src/domain";

const DEFAULT_FORBID_MODULES = new Set([
  "hono",
  "@hono/node-server",
  "express",
  "fastify",
  "playwright",
  "@playwright/test",
  "@cucumber/cucumber",
  "node:fs",
  "node:http",
  "node:https",
  "node:net",
  "node:child_process",
  "fs",
  "http",
  "https",
  "net",
  "child_process",
]);

/** Infra roots under src/ (exact dir or any path under them). */
const INFRA_ROOTS = ["src/api", "src/web"] as const;

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

/**
 * True when a resolved posix path (relative to cwd) points at infra.
 * Catches directory imports like `../api` → `src/api` (no trailing slash/ext),
 * as well as `src/api/...`, `src/web/...`, and `src/server(.ts|.*)`.
 */
export function isInfraRel(rel: string): boolean {
  const normalized = rel.split(sep).join("/").replace(/\/+$/, "");
  const bare = normalized.replace(/\.(js|ts|mjs|cjs|jsx|tsx)$/, "");

  if (
    bare === "src/server" ||
    normalized === "src/server.ts" ||
    normalized.startsWith("src/server.")
  ) {
    return true;
  }

  return INFRA_ROOTS.some(
    (root) =>
      bare === root ||
      normalized === root ||
      bare.startsWith(`${root}/`) ||
      normalized.startsWith(`${root}/`),
  );
}

/**
 * Forbidden bare modules + their subpaths (`fs/promises`, `node:fs/promises`).
 * Near-miss packages like `fs-extra` / `fs-extra/esm` must NOT match `fs`.
 */
export function isForbiddenModule(specifier: string, extra: string[] = []): boolean {
  const forbid = new Set([...DEFAULT_FORBID_MODULES, ...extra]);
  if (forbid.has(specifier)) {
    return true;
  }
  for (const mod of forbid) {
    if (specifier.startsWith(`${mod}/`)) {
      return true;
    }
  }
  return false;
}

export function collectImportSpecifiers(source: string, fileName = "file.ts"): string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specs;
}

function specifierLine(source: string, specifier: string): number {
  const dq = `"${specifier}"`;
  const sq = `'${specifier}'`;
  const idx = source.includes(dq) ? source.indexOf(dq) : source.indexOf(sq);
  if (idx < 0) {
    return 1;
  }
  return source.slice(0, idx).split("\n").length;
}

export function scanDomainFile(
  source: string,
  fromRel: string,
  cwd: string,
  extraModules: string[] = [],
): ArchFinding[] {
  const findings: ArchFinding[] = [];
  const fromDir = dirname(resolve(cwd, fromRel));
  for (const spec of collectImportSpecifiers(source, fromRel)) {
    const line = specifierLine(source, spec);
    if (isForbiddenModule(spec, extraModules)) {
      findings.push({
        id: "arch-bound",
        severity: "fail",
        path: fromRel,
        line,
        message: `arch-bound: ${fromRel}:${line} imports infra module "${spec}"`,
      });
      continue;
    }
    if (!spec.startsWith(".")) {
      continue;
    }
    const resolved = posixRel(cwd, resolve(fromDir, spec)).replace(/\.js$/, ".ts");
    if (isInfraRel(resolved)) {
      findings.push({
        id: "arch-bound",
        severity: "fail",
        path: fromRel,
        line,
        message: `arch-bound: ${fromRel}:${line} imports infra path ${resolved}`,
      });
    }
  }
  return findings;
}

export function runArchBound(cwd = process.cwd()): { ok: boolean; findings: ArchFinding[] } {
  const config = loadConfig(cwd) as ReturnType<typeof loadConfig> & { archBound?: ArchConfig };
  const includeRel = config.archBound?.include?.[0] ?? DEFAULT_INCLUDE;
  const extra = config.archBound?.forbidModules ?? [];
  const includeDir = resolve(cwd, includeRel);
  const findings: ArchFinding[] = [];

  for (const file of walkTs(includeDir)) {
    const rel = posixRel(cwd, file);
    const source = readFileSync(file, "utf8");
    findings.push(...scanDomainFile(source, rel, cwd, extra));
  }

  const ok = findings.every((finding) => finding.severity !== "fail");
  if (ok) {
    findings.push({
      id: "arch-bound",
      severity: "info",
      path: includeRel,
      message: `arch-bound: ${includeRel} does not import HTTP/UI/fs infra.`,
    });
  }
  writeFileSync(
    resolve(cwd, "arch-bound-report.json"),
    `${JSON.stringify({ ok, generatedAt: new Date().toISOString(), findings }, null, 2)}\n`,
  );
  return { ok, findings };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

function main(): void {
  const result = runArchBound();
  console.info(`arch-bound — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("arch-bound failed. Domain must stay free of HTTP/UI/fs imports.");
    process.exitCode = 1;
    return;
  }
  console.info("arch-bound passed.");
}

if (isDirectRun()) {
  main();
}
