/**
 * D16 — narrow cheat scan on production code (`src/**`), TypeScript compiler AST (not regex).
 *
 * FAIL:
 * - test-environment detection: `process.env.NODE_ENV` compared with "test" (any comparison
 *   form, incl. switch/case and string methods), any `process.env.VITEST*` read, or
 *   `process.argv` inspected for test (a test-ish literal in the same expression).
 * - mutation of stdlib / globals / prototypes: assignment to a global (`Date = …`), to a
 *   member of a global (`Math.random = …`, `globalThis.x = …`), to any `.prototype` /
 *   `__proto__` member, or `Object.defineProperty` / `defineProperties` / `assign` /
 *   `setPrototypeOf`, `Reflect.defineProperty` / `set` / `setPrototypeOf` on such a target.
 * WARN (printed, non-failing): overrides of `equals`, `valueOf`, `toJSON`, `[Symbol.toPrimitive]`.
 *
 * Out of scope: literals that mirror tests; test helpers (fake timers are legitimate).
 * Override: human grant only — `CHEAT_SCAN_APPROVED=1` or PR label `cheat-scan-approved`.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import ts from "typescript";

export const CHEAT_SCAN_GRANT_ENV = "CHEAT_SCAN_APPROVED";
export const CHEAT_SCAN_GRANT_LABEL = "cheat-scan-approved";

export type CheatScanFinding = {
  id: "D16";
  severity: "fail" | "warn" | "info";
  rule: "test-env" | "global-mutation" | "override" | "summary";
  file?: string;
  line?: number;
  message: string;
};

const SOURCE_RE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const TEST_LITERAL_RE = /(?:^|[^a-z])(?:test|vitest|jest|mocha)/i;
const OVERRIDE_NAMES = new Set(["equals", "valueOf", "toJSON"]);

/** Globals / stdlib objects production code must not reassign or patch. */
const GLOBALS = new Set([
  "globalThis",
  "global",
  "window",
  "self",
  "Math",
  "Date",
  "JSON",
  "Object",
  "Array",
  "Function",
  "Promise",
  "Number",
  "String",
  "Boolean",
  "Symbol",
  "BigInt",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Reflect",
  "Proxy",
  "Intl",
  "console",
  "process",
  "Buffer",
  "crypto",
  "performance",
  "fetch",
  "URL",
  "URLSearchParams",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
  "queueMicrotask",
  "structuredClone",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "eval",
]);

const BUILTIN_MODULES = new Set([
  "process",
  "buffer",
  "timers",
  "console",
  "crypto",
  "perf_hooks",
  "url",
]);

const DEFINE_CALLS = new Set([
  "Object.defineProperty",
  "Object.defineProperties",
  "Object.assign",
  "Object.setPrototypeOf",
  "Reflect.defineProperty",
  "Reflect.set",
  "Reflect.setPrototypeOf",
]);

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (SOURCE_RE.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function memberName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function memberObject(node: ts.Node): ts.Expression | undefined {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return node.expression;
  }
  return undefined;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** `process.env` (also `globalThis.process.env`). */
function isProcessMember(node: ts.Expression, member: "env" | "argv"): boolean {
  const target = unwrap(node);
  if (memberName(target) !== member) {
    return false;
  }
  const object = memberObject(target);
  if (!object) {
    return false;
  }
  const inner = unwrap(object);
  if (ts.isIdentifier(inner)) {
    return inner.text === "process";
  }
  return memberName(inner) === "process";
}

function envKey(node: ts.Node): string | undefined {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
    return undefined;
  }
  return isProcessMember(node.expression, "env") ? memberName(node) : undefined;
}

function isStatementBoundary(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isExpressionStatement(node) ||
    ts.isReturnStatement(node) ||
    ts.isIfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isForStatement(node) ||
    ts.isThrowStatement(node) ||
    ts.isCaseClause(node) ||
    ts.isSwitchStatement(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isExportAssignment(node)
  );
}

/** Largest enclosing expression of `node` that is still inside one statement / condition. */
function enclosingExpression(node: ts.Node): ts.Node {
  let current = node;
  while (current.parent && !isStatementBoundary(current.parent)) {
    current = current.parent;
  }
  return current;
}

function literalsIn(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (child: ts.Node): void => {
    if (
      ts.isStringLiteralLike(child) ||
      ts.isRegularExpressionLiteral(child) ||
      ts.isTemplateHead(child) ||
      ts.isTemplateMiddle(child) ||
      ts.isTemplateTail(child)
    ) {
      out.push(child.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return out;
}

/** Literals compared with `node`: its enclosing expression, plus switch case labels. */
function comparedLiterals(node: ts.Node): string[] {
  const expr = enclosingExpression(node);
  const literals = literalsIn(expr);
  const parent = expr.parent;
  if (parent && ts.isSwitchStatement(parent) && parent.expression === expr) {
    for (const clause of parent.caseBlock.clauses) {
      if (ts.isCaseClause(clause)) {
        literals.push(...literalsIn(clause.expression));
      }
    }
  }
  return literals;
}

function hasTestLiteral(literals: string[]): boolean {
  return literals.some((text) => TEST_LITERAL_RE.test(text));
}

/** Names bound to NODE_ENV: `const x = process.env.NODE_ENV` / `const { NODE_ENV: x } = process.env`. */
function nodeEnvAliases(source: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isIdentifier(node.name) && envKey(init) === "NODE_ENV") {
        aliases.add(node.name.text);
      }
      if (ts.isObjectBindingPattern(node.name) && isProcessMember(init, "env")) {
        for (const element of node.name.elements) {
          const key = element.propertyName ?? element.name;
          if (ts.isIdentifier(key) && key.text === "NODE_ENV" && ts.isIdentifier(element.name)) {
            aliases.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return aliases;
}

/** `node:*` / bare builtin imports (e.g. `import process from "node:process"`) stay global. */
function isBuiltinModule(specifier: ts.Expression): boolean {
  if (!ts.isStringLiteralLike(specifier)) {
    return false;
  }
  return /^node:/.test(specifier.text) || BUILTIN_MODULES.has(specifier.text);
}

/** Names declared in the file (shadowing a global makes it local). */
function declaredNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const addBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      names.add(name.text);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) {
        addBinding(element.name);
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      addBinding(node.name);
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined
    ) {
      names.add(node.name.text);
    } else if (ts.isImportDeclaration(node) && !isBuiltinModule(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.name) {
        names.add(clause.name.text);
      }
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        names.add(bindings.name.text);
      } else if (bindings) {
        bindings.elements.forEach((element) => names.add(element.name.text));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function rootIdentifier(node: ts.Expression): ts.Identifier | undefined {
  let current = unwrap(node);
  for (;;) {
    const object = memberObject(current);
    if (!object) {
      break;
    }
    current = unwrap(object);
  }
  return ts.isIdentifier(current) ? current : undefined;
}

function chainHasPrototype(node: ts.Expression): boolean {
  let current: ts.Expression | undefined = unwrap(node);
  while (current) {
    const name = memberName(current);
    if (name === "prototype" || name === "__proto__") {
      return true;
    }
    const object = memberObject(current);
    current = object ? unwrap(object) : undefined;
  }
  return false;
}

function isGlobalTarget(node: ts.Expression, local: Set<string>): boolean {
  if (chainHasPrototype(node)) {
    return true;
  }
  const root = rootIdentifier(node);
  return root !== undefined && GLOBALS.has(root.text) && !local.has(root.text);
}

function calleeName(node: ts.CallExpression): string | undefined {
  const callee = unwrap(node.expression);
  const object = memberObject(callee);
  const name = memberName(callee);
  if (!object || !name) {
    return undefined;
  }
  const inner = unwrap(object);
  return ts.isIdentifier(inner) ? `${inner.text}.${name}` : undefined;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function overrideName(node: ts.Node): string | undefined {
  const isMember =
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    (ts.isPropertyDeclaration(node) && node.initializer !== undefined) ||
    (ts.isPropertyAssignment(node) &&
      (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer)));
  if (!isMember) {
    return undefined;
  }
  const name = (node as ts.MethodDeclaration).name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return OVERRIDE_NAMES.has(name.text) ? name.text : undefined;
  }
  if (ts.isComputedPropertyName(name)) {
    const expr = unwrap(name.expression);
    if (memberName(expr) === "toPrimitive") {
      const object = memberObject(expr);
      if (
        object &&
        ts.isIdentifier(unwrap(object)) &&
        (unwrap(object) as ts.Identifier).text === "Symbol"
      ) {
        return "[Symbol.toPrimitive]";
      }
    }
  }
  return undefined;
}

/** Scan one source text. `rel` is only used in messages. */
export function scanSource(text: string, rel: string): CheatScanFinding[] {
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const aliases = nodeEnvAliases(source);
  const local = declaredNames(source);
  const findings: CheatScanFinding[] = [];
  const seen = new Set<string>();
  const add = (
    node: ts.Node,
    severity: CheatScanFinding["severity"],
    rule: CheatScanFinding["rule"],
    what: string,
  ): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const key = `${rule}:${line}:${what}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    findings.push({
      id: "D16",
      severity,
      rule,
      file: rel,
      line,
      message: `D16 ${what} in ${rel}:${line}: ${node.getText(source).split("\n")[0]?.slice(0, 120)}`,
    });
  };

  const visit = (node: ts.Node): void => {
    const key = envKey(node);
    if (key !== undefined && /^VITEST(?:_|$)/.test(key)) {
      add(node, "fail", "test-env", "test-environment detection (process.env.VITEST)");
    } else if (key === "NODE_ENV" && hasTestLiteral(comparedLiterals(node))) {
      add(node, "fail", "test-env", 'test-environment detection (NODE_ENV vs "test")');
    }
    if (
      ts.isIdentifier(node) &&
      aliases.has(node.text) &&
      !ts.isVariableDeclaration(node.parent) &&
      !ts.isBindingElement(node.parent) &&
      hasTestLiteral(comparedLiterals(node))
    ) {
      add(node, "fail", "test-env", 'test-environment detection (NODE_ENV alias vs "test")');
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      ts.isStringLiteralLike(node.left) &&
      /^VITEST(?:_|$)/.test(node.left.text) &&
      isProcessMember(node.right, "env")
    ) {
      add(node, "fail", "test-env", "test-environment detection (process.env.VITEST)");
    }
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isProcessMember(node, "argv") &&
      hasTestLiteral(literalsIn(enclosingExpression(node)))
    ) {
      add(node, "fail", "test-env", "test-environment detection (process.argv inspected for test)");
    }
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      isGlobalTarget(node.left, local)
    ) {
      add(node, "fail", "global-mutation", "assignment to stdlib/global/prototype");
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      const target = node.arguments[0];
      if (name && DEFINE_CALLS.has(name) && target && isGlobalTarget(target, local)) {
        add(node, "fail", "global-mutation", `${name} on stdlib/global/prototype`);
      }
    }
    const override = overrideName(node);
    if (override) {
      add(
        node,
        "warn",
        "override",
        `override of ${override} (review: can fake equality/serialization)`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function readEventLabels(): string[] {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) {
    return [];
  }
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
      pull_request?: { labels?: { name?: string }[] };
    };
    return (event.pull_request?.labels ?? []).map((label) => label.name ?? "");
  } catch {
    return [];
  }
}

/** Human grant only: env or PR label. No committed-config grant. */
export function cheatScanAllowed(): { allowed: boolean; reason: string } {
  if (process.env[CHEAT_SCAN_GRANT_ENV] === "1") {
    return { allowed: true, reason: `${CHEAT_SCAN_GRANT_ENV}=1` };
  }
  if (readEventLabels().includes(CHEAT_SCAN_GRANT_LABEL)) {
    return { allowed: true, reason: `GitHub label ${CHEAT_SCAN_GRANT_LABEL}` };
  }
  return { allowed: false, reason: "no human cheat-scan grant" };
}

export function runCheatScan(cwd = process.cwd()): {
  ok: boolean;
  findings: CheatScanFinding[];
} {
  const files = walk(resolve(cwd, "src"));
  const raw = files.flatMap((file) =>
    scanSource(readFileSync(file, "utf8"), relative(cwd, file).split(sep).join("/")),
  );
  const fails = raw.filter((finding) => finding.severity === "fail");
  const grant = cheatScanAllowed();
  const findings: CheatScanFinding[] =
    fails.length > 0 && grant.allowed
      ? raw.map((finding) =>
          finding.severity === "fail"
            ? {
                ...finding,
                severity: "info",
                message: `${finding.message} (granted via ${grant.reason})`,
              }
            : finding,
        )
      : raw;
  const ok = findings.every((finding) => finding.severity !== "fail");
  const summary = ok
    ? `D16 scanned ${files.length} src file(s): no failing cheat patterns${fails.length > 0 ? " after human grant" : ""}.`
    : `D16 ${fails.length} failing pattern(s) in src/**. Remove them, or human grant: ${CHEAT_SCAN_GRANT_ENV}=1 / label ${CHEAT_SCAN_GRANT_LABEL}.`;
  findings.push({ id: "D16", severity: ok ? "info" : "fail", rule: "summary", message: summary });
  writeFileSync(
    resolve(cwd, "cheat-scan-report.json"),
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
  const result = runCheatScan();
  console.info(`cheat-scan (D16) — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : finding.severity === "warn" ? "!" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("cheat-scan failed.");
    process.exitCode = 1;
    return;
  }
  console.info("cheat-scan passed.");
}

if (isDirectRun()) {
  main();
}
