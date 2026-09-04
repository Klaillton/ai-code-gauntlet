import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import yaml from "js-yaml";

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const ALLOWLIST_KINDS = ["test-harness", "static-ui", "internal", "wip-red"] as const;
export type AllowlistKind = (typeof ALLOWLIST_KINDS)[number];

export const EXEMPT_FROM = ["openapi", "gherkin", "unit", "docs"] as const;
export type ExemptFrom = (typeof EXEMPT_FROM)[number];

export type Strictness = "strict" | "lenient";

export type AllowlistEntry = {
  kind: AllowlistKind;
  method: string;
  path: string;
  reason: string;
  exemptFrom: ExemptFrom[];
  owner: string;
  expires: string;
};

export type Gate = {
  id: string;
  command: string;
  args: string[];
  enabled?: boolean;
};

export type GauntletConfig = {
  name?: string;
  strictness?: Strictness;
  gates: Gate[];
  allowlist?: AllowlistEntry[];
  contract?: {
    openapiPath?: string;
    serverEntry?: string;
    port?: number;
  };
  sdd?: {
    appPath?: string;
    featuresDir?: string;
    openapiPath?: string;
    domainDir?: string;
    unitDir?: string;
  };
  allowSpecEdit?: boolean;
  agent?: {
    protectedGlobs?: string[];
    maxVerifyCycles?: number;
  };
};

export type DiscoveredRoute = {
  method: HttpMethod;
  path: string;
  normalizedPath: string;
  source: string;
};

export type OpenApiOperation = {
  method: HttpMethod;
  path: string;
  normalizedPath: string;
  operationId: string | undefined;
};

export type FeatureScenario = {
  featureFile: string;
  name: string;
  tags: string[];
  operationIds: string[];
  steps: string[];
};

export type DomainModule = {
  path: string;
  stem: string;
  coveredBy: string[];
};

export type Inventory = {
  cwd: string;
  config: GauntletConfig;
  strictness: Strictness;
  routes: DiscoveredRoute[];
  operations: OpenApiOperation[];
  scenarios: FeatureScenario[];
  domainModules: DomainModule[];
  unitTests: string[];
  featureFiles: string[];
};

const METHOD_SET = new Set<string>(HTTP_METHODS);

const ROUTE_RE = /\bapp\.(get|post|put|patch|delete|options|head)\(\s*(['"`])([^'"`]+)\2/gi;

export function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

export function normalizePath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

export function normalizeMethod(method: string): HttpMethod {
  const lower = method.toLowerCase();
  if (!METHOD_SET.has(lower)) {
    throw new Error(`Unsupported HTTP method: ${method}`);
  }
  return lower as HttpMethod;
}

export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function loadConfig(cwd = process.cwd()): GauntletConfig {
  const path = resolve(cwd, "gauntlet.config.json");
  return JSON.parse(readFileSync(path, "utf8")) as GauntletConfig;
}

export function discoverRoutes(appPath: string, cwd: string): DiscoveredRoute[] {
  if (!existsSync(appPath)) {
    return [];
  }
  const source = posixRel(cwd, appPath);
  const text = readFileSync(appPath, "utf8");
  const routes: DiscoveredRoute[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(ROUTE_RE)) {
    const method = normalizeMethod(match[1] ?? "get");
    const path = match[3] ?? "";
    const key = routeKey(method, path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    routes.push({
      method,
      path,
      normalizedPath: normalizePath(path),
      source,
    });
  }
  routes.sort((a, b) => routeKey(a.method, a.path).localeCompare(routeKey(b.method, b.path)));
  return routes;
}

type OpenApiDoc = {
  paths?: Record<string, Record<string, { operationId?: string } | undefined> | undefined>;
};

export function discoverOpenApi(openapiPath: string): OpenApiOperation[] {
  if (!existsSync(openapiPath)) {
    return [];
  }
  const raw = readFileSync(openapiPath, "utf8");
  const doc = yaml.load(raw) as OpenApiDoc;
  const operations: OpenApiOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    if (!item) {
      continue;
    }
    for (const [methodRaw, op] of Object.entries(item)) {
      if (!METHOD_SET.has(methodRaw.toLowerCase())) {
        continue;
      }
      const method = normalizeMethod(methodRaw);
      operations.push({
        method,
        path,
        normalizedPath: normalizePath(path),
        operationId: op?.operationId,
      });
    }
  }
  operations.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) {
      return byPath;
    }
    return a.method.localeCompare(b.method);
  });
  return operations;
}

function parseTags(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((token) => token.startsWith("@"));
}

export function discoverFeatures(featuresDir: string, cwd: string): FeatureScenario[] {
  const files = walkFiles(featuresDir).filter((file) => file.endsWith(".feature"));
  const scenarios: FeatureScenario[] = [];

  for (const file of files) {
    const featureFile = posixRel(cwd, file);
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    let featureTags: string[] = [];
    let pendingTags: string[] = [];
    let current: FeatureScenario | undefined;

    const flush = (): void => {
      if (current) {
        scenarios.push(current);
        current = undefined;
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("@")) {
        pendingTags.push(...parseTags(trimmed));
        continue;
      }
      const featureMatch = trimmed.match(/^Feature:\s*(.*)$/);
      if (featureMatch) {
        featureTags = pendingTags;
        pendingTags = [];
        continue;
      }
      const scenarioMatch = trimmed.match(/^(Scenario(?: Outline)?):\s*(.*)$/);
      if (scenarioMatch) {
        flush();
        const tags = [...featureTags, ...pendingTags];
        pendingTags = [];
        const operationIds = tags
          .filter((tag) => tag.startsWith("@op:"))
          .map((tag) => tag.slice("@op:".length))
          .filter((id) => id.length > 0);
        current = {
          featureFile,
          name: scenarioMatch[2] ?? "",
          tags,
          operationIds,
          steps: [],
        };
        continue;
      }
      if (current && /^(Given|When|Then|And|But)\b/.test(trimmed)) {
        current.steps.push(trimmed);
      }
    }
    flush();
  }

  scenarios.sort((a, b) => {
    const byFile = a.featureFile.localeCompare(b.featureFile);
    if (byFile !== 0) {
      return byFile;
    }
    return a.name.localeCompare(b.name);
  });
  return scenarios;
}

function importsDomainModule(unitSource: string, stem: string): boolean {
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`from\\s+['"][^'"]*/${escaped}\\.js['"]`);
  return re.test(unitSource);
}

export function discoverDomain(
  domainDir: string,
  unitDir: string,
  cwd: string,
): { modules: DomainModule[]; unitTests: string[] } {
  const domainFiles = walkFiles(domainDir).filter((file) => file.endsWith(".ts"));
  const unitFiles = walkFiles(unitDir).filter((file) => file.endsWith(".test.ts"));
  const unitTests = unitFiles.map((file) => posixRel(cwd, file));
  const unitContents = new Map(unitFiles.map((file) => [file, readFileSync(file, "utf8")]));

  const modules: DomainModule[] = domainFiles.map((file) => {
    const stem = basename(file, ".ts");
    const coveredBy: string[] = [];
    const expected = `${stem}.test.ts`;
    for (const unitFile of unitFiles) {
      const relPath = posixRel(cwd, unitFile);
      if (basename(unitFile) === expected) {
        coveredBy.push(relPath);
        continue;
      }
      const source = unitContents.get(unitFile) ?? "";
      if (importsDomainModule(source, stem)) {
        coveredBy.push(relPath);
      }
    }
    return {
      path: posixRel(cwd, file),
      stem,
      coveredBy: [...new Set(coveredBy)].sort((a, b) => a.localeCompare(b)),
    };
  });

  modules.sort((a, b) => a.path.localeCompare(b.path));
  return { modules, unitTests: unitTests.sort((a, b) => a.localeCompare(b)) };
}

export function buildInventory(cwd = process.cwd()): Inventory {
  const config = loadConfig(cwd);
  const openapiPath = resolve(
    cwd,
    config.sdd?.openapiPath ?? config.contract?.openapiPath ?? "openapi/openapi.yaml",
  );
  const appPath = resolve(cwd, config.sdd?.appPath ?? "src/api/app.ts");
  const featuresDir = resolve(cwd, config.sdd?.featuresDir ?? "features");
  const domainDir = resolve(cwd, config.sdd?.domainDir ?? "src/domain");
  const unitDir = resolve(cwd, config.sdd?.unitDir ?? "tests/unit");
  const { modules, unitTests } = discoverDomain(domainDir, unitDir, cwd);
  const featureFiles = walkFiles(featuresDir)
    .filter((file) => file.endsWith(".feature"))
    .map((file) => posixRel(cwd, file));

  return {
    cwd,
    config,
    strictness: config.strictness === "lenient" ? "lenient" : "strict",
    routes: discoverRoutes(appPath, cwd),
    operations: discoverOpenApi(openapiPath),
    scenarios: discoverFeatures(featuresDir, cwd),
    domainModules: modules,
    unitTests,
    featureFiles: featureFiles.sort((a, b) => a.localeCompare(b)),
  };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

if (isDirectRun()) {
  const inventory = buildInventory();
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
}
