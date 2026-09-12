import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import yaml from "js-yaml";
import {
  ALLOWLIST_KINDS,
  EXEMPT_FROM,
  HTTP_METHODS,
  type AllowlistEntry,
  type AllowlistKind,
  type ExemptFrom,
  type FeatureScenario,
  type Inventory,
  type Strictness,
  buildInventory,
  normalizeMethod,
  routeKey,
} from "./inventory.js";

export type DriftId = "D1" | "D2" | "D3" | "D5" | "D6" | "D8" | "D9" | "allowlist";

export type Finding = {
  id: DriftId;
  severity: "fail" | "warn" | "info";
  message: string;
};

export type SpecSyncResult = {
  ok: boolean;
  strictness: Strictness;
  findings: Finding[];
  inventory: Inventory;
};

const KIND_SET = new Set<string>(ALLOWLIST_KINDS);
const EXEMPT_SET = new Set<string>(EXEMPT_FROM);

const CSS_LEAK_RE =
  /(?:^|[\s"'`])(?:div|span|button|input|form|ul|li|a|p|h[1-6]|nav|section|header|footer)\.[\w-]+/;
const ID_LEAK_RE = /(?:^|[\s"'`])#[A-Za-z][\w-]*/;
const PATH_LEAK_RE = /(?:^|[\s"'`])\/(?:api|health)(?:\/[A-Za-z0-9._~!$&'()*+,;=:@{}/-]*)?/;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(value)) {
    return false;
  }
  const day = value.slice(0, 10);
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === day;
}

function isExpired(entry: AllowlistEntry): boolean {
  return entry.expires.slice(0, 10) < todayUtc();
}

function asAllowlist(raw: unknown): { entries: AllowlistEntry[]; findings: Finding[] } {
  const findings: Finding[] = [];
  if (raw === undefined) {
    findings.push({
      id: "allowlist",
      severity: "fail",
      message: "gauntlet.config.json allowlist array is required",
    });
    return { entries: [], findings };
  }
  if (!Array.isArray(raw)) {
    findings.push({
      id: "allowlist",
      severity: "fail",
      message: "gauntlet.config.json allowlist must be an array",
    });
    return { entries: [], findings };
  }

  const entries: AllowlistEntry[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      findings.push({
        id: "allowlist",
        severity: "fail",
        message: `allowlist[${index}] must be an object`,
      });
      return;
    }
    const rec = item as Record<string, unknown>;
    const missing: string[] = [];
    for (const field of ["kind", "method", "path", "reason", "exemptFrom", "owner", "expires"]) {
      if (rec[field] === undefined || rec[field] === "") {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      findings.push({
        id: "allowlist",
        severity: "fail",
        message: `allowlist[${index}] missing required fields: ${missing.join(", ")}`,
      });
      return;
    }
    if (typeof rec.kind !== "string" || !KIND_SET.has(rec.kind)) {
      findings.push({
        id: "allowlist",
        severity: "fail",
        message: `allowlist[${index}] kind must be one of ${ALLOWLIST_KINDS.join(" | ")}`,
      });
      return;
    }
    if (typeof rec.method !== "string" || typeof rec.path !== "string") {
      findings.push({
        id: "allowlist",
        severity: "fail",
        message: `allowlist[${index}] method and path must be strings`,
      });
      return;
    }
    if (typeof rec.reason !== "string" || typeof rec.owner !== "string") {
      findings.push({
        id: "allowlist",
        severity: "fail",
        message: `allowlist[${index}] reason and owner must be strings`,
      });
      return;
    }
    if (typeof rec.expires !== "string" || !isIsoDate(rec.expires)) {
      findings.push({
        id: "allowlist",
        severity: "fail",
        message: `allowlist[${index}] expires must be an ISO date (YYYY-MM-DD)`,
      });
      return;
    }
    if (!Array.isArray(rec.exemptFrom) || rec.exemptFrom.some((v) => typeof v !== "string")) {
      findings.push({
        id: "allowlist",
        severity: "fail",
        message: `allowlist[${index}] exemptFrom must be an array of strings`,
      });
      return;
    }
    const exemptFrom = rec.exemptFrom as string[];
    const badExempt = exemptFrom.filter((v) => !EXEMPT_SET.has(v));
    if (badExempt.length > 0) {
      findings.push({
        id: "allowlist",
        severity: "fail",
        message: `allowlist[${index}] exemptFrom contains unknown values: ${badExempt.join(", ")}`,
      });
      return;
    }
    entries.push({
      kind: rec.kind as AllowlistKind,
      method: rec.method,
      path: rec.path,
      reason: rec.reason,
      exemptFrom: exemptFrom as ExemptFrom[],
      owner: rec.owner,
      expires: rec.expires,
    });
  });

  return { entries, findings };
}

function findAllowlist(
  entries: AllowlistEntry[],
  method: string,
  path: string,
): AllowlistEntry | undefined {
  const key = routeKey(method, path);
  return entries.find((entry) => routeKey(entry.method, entry.path) === key);
}

function exempt(
  entries: AllowlistEntry[],
  method: string,
  path: string,
  from: ExemptFrom,
): AllowlistEntry | undefined {
  const entry = findAllowlist(entries, method, path);
  if (!entry || isExpired(entry)) {
    return undefined;
  }
  return entry.exemptFrom.includes(from) ? entry : undefined;
}

function checkD1(inventory: Inventory, allowlist: AllowlistEntry[]): Finding[] {
  const findings: Finding[] = [];
  const openapiKeys = new Set(
    inventory.operations.map((op) => routeKey(op.method, op.normalizedPath)),
  );
  for (const route of inventory.routes) {
    const key = routeKey(route.method, route.normalizedPath);
    if (openapiKeys.has(key)) {
      continue;
    }
    const listed = findAllowlist(allowlist, route.method, route.path);
    if (listed && isExpired(listed)) {
      findings.push({
        id: "D1",
        severity: "fail",
        message: `D1 ${key} is not in OpenAPI and allowlist expired on ${listed.expires}`,
      });
      continue;
    }
    if (exempt(allowlist, route.method, route.path, "openapi")) {
      continue;
    }
    findings.push({
      id: "D1",
      severity: "fail",
      message: `D1 ${key} is implemented in ${route.source} but missing from OpenAPI (allowlist required)`,
    });
  }
  return findings;
}

function checkD2(inventory: Inventory): Finding[] {
  const findings: Finding[] = [];
  const routeKeys = new Set(
    inventory.routes.map((route) => routeKey(route.method, route.normalizedPath)),
  );
  for (const op of inventory.operations) {
    const key = routeKey(op.method, op.normalizedPath);
    if (!routeKeys.has(key)) {
      findings.push({
        id: "D2",
        severity: "fail",
        message: `D2 ${key} is in OpenAPI but no matching route was discovered in src/api/app.ts`,
      });
    }
  }
  return findings;
}

function checkD3(inventory: Inventory, allowlist: AllowlistEntry[]): Finding[] {
  const tagged = new Set(inventory.scenarios.flatMap((scenario) => scenario.operationIds));
  const severity: Finding["severity"] = inventory.strictness === "strict" ? "fail" : "warn";
  const findings: Finding[] = [];
  for (const op of inventory.operations) {
    const operationId = op.operationId;
    const key = routeKey(op.method, op.path);
    if (!operationId) {
      findings.push({
        id: "D3",
        severity,
        message: `D3 ${key} has no operationId`,
      });
      continue;
    }
    if (tagged.has(operationId)) {
      continue;
    }
    if (exempt(allowlist, op.method, op.path, "gherkin")) {
      continue;
    }
    findings.push({
      id: "D3",
      severity,
      message: `D3 operationId "${operationId}" (${key}) has no scenario tagged @op:${operationId}`,
    });
  }
  return findings;
}

function checkD5(inventory: Inventory, allowlist: AllowlistEntry[]): Finding[] {
  const findings: Finding[] = [];
  for (const mod of inventory.domainModules) {
    if (mod.coveredBy.length > 0) {
      continue;
    }
    const listed = allowlist.find(
      (entry) => entry.kind === "internal" && entry.path === mod.path && !isExpired(entry),
    );
    if (listed?.exemptFrom.includes("unit")) {
      continue;
    }
    findings.push({
      id: "D5",
      severity: "fail",
      message: `D5 domain module ${mod.path} has no matching unit test`,
    });
  }
  return findings;
}

function leakInStep(step: string): string | undefined {
  if (/\bdata-testid\b/i.test(step) || /\bgetByTestId\b/.test(step)) {
    return "data-testid / getByTestId";
  }
  if (/\bnth-child\b/.test(step)) {
    return "nth-child selector";
  }
  if (CSS_LEAK_RE.test(step)) {
    return "CSS element selector";
  }
  if (ID_LEAK_RE.test(step)) {
    return "CSS id selector";
  }
  if (PATH_LEAK_RE.test(step)) {
    return "raw HTTP path";
  }
  return undefined;
}

function checkD8(inventory: Inventory): Finding[] {
  const findings: Finding[] = [];
  for (const scenario of inventory.scenarios) {
    for (const step of scenario.steps) {
      const leak = leakInStep(step);
      if (leak) {
        findings.push({
          id: "D8",
          severity: "fail",
          message: `D8 ${scenario.featureFile} / "${scenario.name}": ${leak} in "${step}"`,
        });
      }
    }
  }
  return findings;
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

const ROUTE_RE = /\bapp\.(get|post|put|patch|delete|options|head)\(\s*(['"`])([^'"`]+)\2/gi;
const METHOD_SET = new Set<string>(HTTP_METHODS);

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function repoRoot(cwd: string): string | undefined {
  const lines = gitLines(cwd, ["rev-parse", "--show-toplevel"]);
  return lines?.[0];
}

function gitShow(cwd: string, ref: string, repoRelPath: string): string | undefined {
  try {
    return execFileSync("git", ["show", `${ref}:${repoRelPath}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function resolveBaseRef(cwd: string): string | undefined {
  for (const candidate of ["origin/main", "main"]) {
    const ok = gitLines(cwd, ["rev-parse", "--verify", candidate]);
    if (ok?.[0]) {
      return candidate;
    }
  }
  return undefined;
}

/** Route keys discovered with the same ROUTE_RE as inventory. */
export function parseRouteKeys(source: string): Set<string> {
  const keys = new Set<string>();
  for (const match of source.matchAll(ROUTE_RE)) {
    const method = normalizeMethod(match[1] ?? "get");
    const path = match[3] ?? "";
    keys.add(routeKey(method, path));
  }
  return keys;
}

export function parseOpenApiRouteKeys(raw: string): Map<string, string | undefined> {
  const doc = yaml.load(raw) as {
    paths?: Record<string, Record<string, { operationId?: string } | undefined> | undefined>;
  };
  const out = new Map<string, string | undefined>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!item) continue;
    for (const [methodRaw, op] of Object.entries(item)) {
      if (!METHOD_SET.has(methodRaw.toLowerCase())) continue;
      const method = normalizeMethod(methodRaw);
      out.set(routeKey(method, path), op?.operationId);
    }
  }
  return out;
}

export function parseFeatureOperationIds(raw: string): Set<string> {
  const ids = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    for (const token of line.trim().split(/\s+/)) {
      if (token.startsWith("@op:") && token.length > 4) {
        ids.add(token.slice(4));
      }
    }
  }
  return ids;
}

function isExpiredEntry(entry: AllowlistEntry, today = todayUtc()): boolean {
  return entry.expires.slice(0, 10) < today;
}

export function baseExempt(
  entries: AllowlistEntry[],
  method: string,
  path: string,
  from: ExemptFrom,
  today = todayUtc(),
): boolean {
  const key = routeKey(method, path);
  const entry = entries.find((e) => routeKey(e.method, e.path) === key);
  if (!entry || isExpiredEntry(entry, today)) {
    return false;
  }
  return entry.exemptFrom.includes(from);
}

function splitRouteKey(key: string): { method: string; path: string } {
  const space = key.indexOf(" ");
  return { method: key.slice(0, space), path: key.slice(space + 1) };
}

function scopedPrefix(root: string, cwd: string): string {
  const rel = posixRel(root, cwd);
  return rel === "" || rel === "." ? "" : rel;
}

function withPrefix(prefix: string, rel: string): string {
  return prefix ? `${prefix}/${rel}` : rel;
}

export function isUnderScopedDir(file: string, prefix: string, dirRel: string): boolean {
  const base = withPrefix(prefix, dirRel).replace(/\/+$/, "");
  return file === base || file.startsWith(`${base}/`);
}

export type ApiDeltaInput = {
  baseRoutes: Set<string>;
  headRoutes: Set<string>;
  baseOpenApi: Map<string, string | undefined>;
  headOpenApi: Map<string, string | undefined>;
  baseFeatureOps: Set<string>;
  headFeatureOps: Set<string>;
  baseAllowlist: AllowlistEntry[];
  severity: Finding["severity"];
  today?: string;
};

/** Pure D6 HTTP rules: route delta vs OpenAPI / Gherkin / base allowlist. */
export function evaluateApiRouteDelta(input: ApiDeltaInput): Finding[] {
  const today = input.today ?? todayUtc();
  const findings: Finding[] = [];
  const added = [...input.headRoutes].filter((k) => !input.baseRoutes.has(k));
  const removed = [...input.baseRoutes].filter((k) => !input.headRoutes.has(k));

  for (const key of added) {
    const { method, path } = splitRouteKey(key);
    if (input.headOpenApi.has(key)) {
      continue;
    }
    if (baseExempt(input.baseAllowlist, method, path, "openapi", today)) {
      continue;
    }
    findings.push({
      id: "D6",
      severity: input.severity,
      message: `D6 new route ${key} is missing from OpenAPI (no valid base openapi exemption).`,
    });
  }

  for (const key of removed) {
    const { method, path } = splitRouteKey(key);
    const wasInOpenApi = input.baseOpenApi.has(key);
    if (wasInOpenApi) {
      const opId = input.baseOpenApi.get(key);
      if (input.headOpenApi.has(key)) {
        findings.push({
          id: "D6",
          severity: input.severity,
          message: `D6 deleted route ${key} still present in OpenAPI; remove it in the same diff.`,
        });
      }
      if (opId && input.baseFeatureOps.has(opId) && input.headFeatureOps.has(opId)) {
        findings.push({
          id: "D6",
          severity: input.severity,
          message: `D6 deleted route ${key} still has @op:${opId} in Gherkin; remove it in the same diff.`,
        });
      }
      continue;
    }
    const exemptOpen = baseExempt(input.baseAllowlist, method, path, "openapi", today);
    const exemptGherkin = baseExempt(input.baseAllowlist, method, path, "gherkin", today);
    if (exemptOpen && exemptGherkin) {
      continue;
    }
    // Undocumented delete with no openapi+gherkin exemption: allowed cleanup.
  }

  return findings;
}

function walkFeatureFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkFeatureFiles(full));
    } else if (name.endsWith(".feature")) {
      out.push(full);
    }
  }
  return out;
}

function checkD6(inventory: Inventory): Finding[] {
  const cwd = inventory.cwd;
  const inside = gitLines(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside) {
    return [
      {
        id: "D6",
        severity: inventory.strictness === "strict" ? "fail" : "warn",
        message: "D6 git is required to prove src changes have matching specs/tests (fail-closed).",
      },
    ];
  }

  const root = repoRoot(cwd);
  if (!root) {
    return [
      {
        id: "D6",
        severity: inventory.strictness === "strict" ? "fail" : "warn",
        message: "D6 git is required to prove src changes have matching specs/tests (fail-closed).",
      },
    ];
  }

  const files = new Set<string>([
    ...(gitLines(cwd, ["diff", "--name-only", "HEAD"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "--cached"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "origin/main...HEAD"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "main...HEAD"]) ?? []),
  ]);

  if (files.size === 0) {
    return [
      {
        id: "D6",
        severity: "info",
        message: "D6: git is available but no diff vs HEAD/main; nothing to check.",
      },
    ];
  }

  const prefix = scopedPrefix(root, cwd);
  const appRel = inventory.config.sdd?.appPath ?? "src/api/app.ts";
  const apiDirRel = dirname(appRel).split(sep).join("/");
  const domainDirRel = inventory.config.sdd?.domainDir ?? "src/domain";
  const unitDirRel = inventory.config.sdd?.unitDir ?? "tests/unit";
  const openapiRel =
    inventory.config.sdd?.openapiPath ??
    inventory.config.contract?.openapiPath ??
    "openapi/openapi.yaml";
  const featuresDirRel = inventory.config.sdd?.featuresDir ?? "features";
  const configRel = "gauntlet.config.json";

  const severity: Finding["severity"] = inventory.strictness === "strict" ? "fail" : "warn";
  const changed = [...files];
  const findings: Finding[] = [];

  const srcApiChanged = changed.some((file) => isUnderScopedDir(file, prefix, apiDirRel));
  const srcDomainChanged = changed.some((file) => isUnderScopedDir(file, prefix, domainDirRel));
  const unitChanged = changed.some((file) => isUnderScopedDir(file, prefix, unitDirRel));

  if (srcDomainChanged && !unitChanged) {
    findings.push({
      id: "D6",
      severity,
      message: "D6 src/domain changed without tests/unit in the same diff.",
    });
  }

  if (srcApiChanged) {
    const appRepoRel = withPrefix(prefix, appRel);
    const appAbs = resolve(cwd, appRel);
    const baseRef = resolveBaseRef(cwd);
    const mergeBase = baseRef ? gitLines(cwd, ["merge-base", baseRef, "HEAD"])?.[0] : undefined;

    const dirtyVsHead = Boolean(
      (gitLines(cwd, ["diff", "--name-only", "HEAD", "--", appRel]) ?? []).length ||
        (gitLines(cwd, ["diff", "--name-only", "--cached", "--", appRel]) ?? []).length,
    );
    // Working-tree edits: compare to HEAD. Committed PR edits: compare to merge-base.
    const base = dirtyVsHead ? "HEAD" : (mergeBase ?? "HEAD");

    const baseApp = gitShow(cwd, base, appRepoRel) ?? "";
    const headApp = existsSync(appAbs)
      ? readFileSync(appAbs, "utf8")
      : (gitShow(cwd, "HEAD", appRepoRel) ?? "");

    const baseOpenRaw = gitShow(cwd, base, withPrefix(prefix, openapiRel)) ?? "";
    const headOpenAbs = resolve(cwd, openapiRel);
    const headOpenRaw = existsSync(headOpenAbs)
      ? readFileSync(headOpenAbs, "utf8")
      : (gitShow(cwd, "HEAD", withPrefix(prefix, openapiRel)) ?? "");

    const baseConfigRaw = gitShow(cwd, base, withPrefix(prefix, configRel)) ?? "{}";
    let baseAllowlist: AllowlistEntry[] = [];
    try {
      const parsed = JSON.parse(baseConfigRaw) as { allowlist?: unknown };
      baseAllowlist = asAllowlist(parsed.allowlist).entries;
    } catch {
      baseAllowlist = [];
    }

    const featuresAbs = resolve(cwd, featuresDirRel);
    const headFeatureOps = new Set<string>();
    for (const file of walkFeatureFiles(featuresAbs)) {
      for (const id of parseFeatureOperationIds(readFileSync(file, "utf8"))) {
        headFeatureOps.add(id);
      }
    }
    const baseFeatureOps = new Set<string>();
    const baseFeatureFiles =
      gitLines(cwd, [
        "ls-tree",
        "-r",
        "--name-only",
        base,
        "--",
        withPrefix(prefix, featuresDirRel),
      ]) ?? [];
    for (const file of baseFeatureFiles) {
      if (!file.endsWith(".feature")) {
        continue;
      }
      const raw = gitShow(cwd, base, file);
      if (!raw) {
        continue;
      }
      for (const id of parseFeatureOperationIds(raw)) {
        baseFeatureOps.add(id);
      }
    }

    const baseRoutes = parseRouteKeys(baseApp);
    const headRoutes = parseRouteKeys(headApp);
    const baseOpenApi = baseOpenRaw ? parseOpenApiRouteKeys(baseOpenRaw) : new Map();
    const headOpenApi = headOpenRaw ? parseOpenApiRouteKeys(headOpenRaw) : new Map();

    const appTouched = changed.some(
      (file) => file === appRepoRel || file.endsWith(`/${appRel}`) || file === appRel,
    );

    if (appTouched || baseRoutes.size > 0 || headRoutes.size > 0) {
      findings.push(
        ...evaluateApiRouteDelta({
          baseRoutes,
          headRoutes,
          baseOpenApi,
          headOpenApi,
          baseFeatureOps,
          headFeatureOps,
          baseAllowlist,
          severity,
        }),
      );
    }

    // Other files under scoped src/api/ without app.ts touch and without route-key delta:
    // fail-closed unless OpenAPI or Gherkin under this app also changed.
    const routeDeltaEmpty =
      baseRoutes.size === headRoutes.size && [...baseRoutes].every((k) => headRoutes.has(k));
    const onlyNonAppApi = srcApiChanged && !appTouched && routeDeltaEmpty;
    if (onlyNonAppApi) {
      const openapiDirRel = dirname(openapiRel).split(sep).join("/");
      const openapiTouched = changed.some(
        (file) =>
          file === withPrefix(prefix, openapiRel) ||
          isUnderScopedDir(file, prefix, openapiDirRel === "." ? "openapi" : openapiDirRel),
      );
      const featuresChanged = changed.some(
        (file) => file.endsWith(".feature") && isUnderScopedDir(file, prefix, featuresDirRel),
      );
      if (!openapiTouched && !featuresChanged) {
        findings.push({
          id: "D6",
          severity,
          message: "D6 HTTP/src/api changed without OpenAPI or Gherkin in the same diff.",
        });
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: "D6",
      severity: "info",
      message: "D6 git diff check found no unmatched src changes.",
    });
  }
  return findings;
}

export function runSpecSync(cwd = process.cwd()): SpecSyncResult {
  const inventory = buildInventory(cwd);
  const { entries, findings: allowlistFindings } = asAllowlist(inventory.config.allowlist);
  const findings: Finding[] = [
    ...allowlistFindings,
    ...checkD1(inventory, entries),
    ...checkD2(inventory),
    ...checkD3(inventory, entries),
    ...checkD5(inventory, entries),
    ...checkD8(inventory),
    ...checkD6(inventory),
  ];

  const ok = findings.every((finding) => finding.severity !== "fail");
  return { ok, strictness: inventory.strictness, findings, inventory };
}

export function printFindings(result: SpecSyncResult): void {
  console.info(`spec-sync (${result.strictness}) - ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : finding.severity === "warn" ? "!" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (result.ok) {
    console.info("spec-sync passed.");
  } else {
    console.error("spec-sync failed.");
  }
}

export function writeSpecSyncReport(result: SpecSyncResult, cwd = process.cwd()): void {
  const payload = {
    ok: result.ok,
    strictness: result.strictness,
    generatedAt: new Date().toISOString(),
    findings: result.findings,
    routes: result.inventory.routes.map((route) => routeKey(route.method, route.path)),
    operationIds: result.inventory.operations.map((op) => op.operationId).filter(Boolean),
    scenarios: result.inventory.scenarios.map((scenario: FeatureScenario) => ({
      name: scenario.name,
      tags: scenario.tags,
    })),
  };
  writeFileSync(resolve(cwd, "spec-sync-report.json"), `${JSON.stringify(payload, null, 2)}\n`);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

function main(): void {
  const result = runSpecSync();
  writeSpecSyncReport(result);
  printFindings(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (isDirectRun()) {
  main();
}
