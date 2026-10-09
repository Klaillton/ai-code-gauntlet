/**
 * ADD-POLY S1 — maven L2 adapters (walking skeleton): compile, test (surefire), freshness.
 *
 * Anti-false-green rules this file owns:
 * - Goals run by fixed plugin coordinates chosen here (never pom phases/bindings).
 * - The build runs in a core-chosen tmp copy OUTSIDE the workspace; `target/`, `.mvn/`, `.git`
 *   are not copied, so committed/stale reports and maven.config/extensions cannot leak in.
 * - Reactor modules are enumerated by the core from the poms; a jar module with no surefire
 *   report is FAIL; total == 0 tests is FAIL (adapter.ts).
 * - Surefire reports are cross-checked against the compiled test classes (both directions).
 * - Thresholds and skips never come from the pom: the pom guard FAILs any attempt.
 * Not yet (S2+): JaCoCo, multi-module inter-module deps, no-cheat Java, protected pom paths.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { runAdapter, type Adapter, type AdapterResult, type CapabilityVerdict } from "./adapter.js";

/** Pinned by the runner. The pom's own <plugins> versions are irrelevant for these goals. */
export const MAVEN_GOALS = {
  resources: "org.apache.maven.plugins:maven-resources-plugin:3.3.1:resources",
  compile: "org.apache.maven.plugins:maven-compiler-plugin:3.14.1:compile",
  testResources: "org.apache.maven.plugins:maven-resources-plugin:3.3.1:testResources",
  testCompile: "org.apache.maven.plugins:maven-compiler-plugin:3.14.1:testCompile",
  surefire: "org.apache.maven.plugins:maven-surefire-plugin:3.5.4:test",
} as const;

/** Always passed; a user property cannot beat explicit pom config, so the pom guard does that. */
const FORCED_PROPS = [
  "-DskipTests=false",
  "-Dmaven.test.skip=false",
  "-Dmaven.test.failure.ignore=false",
  "-Dsurefire.skip=false",
];

export type MavenModule = { dir: string; packaging: string; pom: string };

/** Drops XML comments by scanning (no regex); an unclosed comment drops the rest. */
export function stripComments(xml: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const open = xml.indexOf("<!--", from);
    if (open === -1) {
      return out + xml.slice(from);
    }
    out += xml.slice(from, open);
    const close = xml.indexOf("-->", open + 4);
    if (close === -1) {
      return out;
    }
    from = close + 3;
  }
}

function posix(path: string): string {
  return path.split(sep).join("/");
}

/** Root + every <module> (recursively, including ones declared inside profiles). */
export function enumerateModules(root: string): MavenModule[] {
  const out: MavenModule[] = [];
  const seen = new Set<string>();
  const visit = (dir: string): void => {
    const abs = resolve(root, dir);
    const pom = join(abs, "pom.xml");
    if (seen.has(abs)) {
      return;
    }
    seen.add(abs);
    if (!existsSync(pom)) {
      out.push({ dir: posix(dir) || ".", packaging: "missing", pom: posix(relative(root, pom)) });
      return;
    }
    const xml = stripComments(readFileSync(pom, "utf8"));
    const withoutParent = xml.replace(/<parent>[\s\S]*?<\/parent>/g, "");
    const packaging = /<packaging>([^<]*)<\/packaging>/.exec(withoutParent)?.[1]?.trim() || "jar";
    out.push({ dir: posix(dir) || ".", packaging, pom: posix(relative(root, pom)) });
    for (const block of xml.match(/<modules>[\s\S]*?<\/modules>/g) ?? []) {
      for (const match of block.matchAll(/<module>([^<]*)<\/module>/g)) {
        visit(join(dir, (match[1] ?? "").trim()));
      }
    }
  };
  visit("");
  return out;
}

/** Modules that must produce classes + a surefire report (aggregators excluded). */
export function buildModules(modules: MavenModule[]): MavenModule[] {
  return modules.filter((module) => module.packaging !== "pom");
}

const SKIP_TAGS = [
  "skip",
  "skipTests",
  "skipExec",
  "maven.test.skip",
  "maven.test.skip.exec",
  "maven.test.failure.ignore",
  "testFailureIgnore",
  "failIfNoTests",
  "excludes",
  "includes",
  "excludesFile",
  "includesFile",
  "test",
  "groups",
  "excludedGroups",
  "reportsDirectory",
  "directory",
  "outputDirectory",
  "testOutputDirectory",
  "testSourceDirectory",
];

/** Anything that looks like the pom choosing its own pass bar. */
const THRESHOLD_TAG_RE = /<([\w.-]*(?:threshold|minimum|coverage|minTests)[\w.-]*)>/gi;

export type PomFinding = { pom: string; message: string };

/**
 * Pom guard (S1, static): thresholds and skips belong to the base config, never the pom.
 * Scans every module pom for skip/redirect tags and threshold-like elements.
 */
export function pomGuard(root: string, modules: MavenModule[]): PomFinding[] {
  const findings: PomFinding[] = [];
  for (const module of modules) {
    const file = resolve(root, module.pom);
    if (!existsSync(file)) {
      findings.push({ pom: module.pom, message: `declared module ${module.dir} has no pom.xml` });
      continue;
    }
    const xml = stripComments(readFileSync(file, "utf8"));
    for (const tag of SKIP_TAGS) {
      const escaped = tag.replaceAll(".", String.raw`\.`);
      const re = new RegExp(String.raw`<${escaped}(?:\s[^>]*)?>`, "g");
      if (re.test(xml)) {
        findings.push({
          pom: module.pom,
          message: `<${tag}> in pom: skips/filters/redirects are core-owned (fail closed)`,
        });
      }
    }
    for (const match of xml.matchAll(THRESHOLD_TAG_RE)) {
      findings.push({
        pom: module.pom,
        message: `<${match[1]}> in pom: thresholds come from the base gauntlet.config.json, never the pom`,
      });
    }
  }
  return findings;
}

/** Core-chosen staging dir outside the workspace; never copies target/, .mvn/, .git. */
export function stageWorkspace(root: string): string {
  const stage = mkdtempSync(join(tmpdir(), "gauntlet-maven-"));
  const rel = relative(resolve(root), resolve(stage));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    rmSync(stage, { recursive: true, force: true });
    throw new Error(`staging dir ${stage} is inside the workspace; set TMPDIR outside it`);
  }
  const blocked = new Set(["target", ".mvn", ".git", "node_modules"]);
  cpSync(root, stage, {
    recursive: true,
    filter: (src) => {
      if (resolve(src) === resolve(root)) {
        return true;
      }
      if (lstatSync(src).isSymbolicLink()) {
        return false;
      }
      return !blocked.has(src.split(sep).pop() ?? "");
    },
  });
  return stage;
}

function walk(dir: string, filter: (file: string) => boolean): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, filter));
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

const CP_SIZES: Record<number, number> = {
  3: 4,
  4: 4,
  5: 8,
  6: 8,
  7: 2,
  8: 2,
  9: 4,
  10: 4,
  11: 4,
  12: 4,
  15: 3,
  16: 2,
  17: 4,
  18: 4,
  19: 2,
  20: 2,
};

/** access_flags of a .class file (walks the constant pool). */
export function classAccessFlags(buf: Buffer): number {
  if (buf.readUInt32BE(0) !== 0xcafebabe) {
    throw new Error("not a class file");
  }
  const count = buf.readUInt16BE(8);
  let offset = 10;
  for (let index = 1; index < count; index += 1) {
    const tag = buf.readUInt8(offset);
    if (tag === 1) {
      offset += 3 + buf.readUInt16BE(offset + 1);
      continue;
    }
    const size = CP_SIZES[tag];
    if (size === undefined) {
      throw new Error(`unknown constant pool tag ${tag}`);
    }
    offset += 1 + size;
    if (tag === 5 || tag === 6) {
      index += 1;
    }
  }
  return buf.readUInt16BE(offset);
}

/** Surefire default includes: Test*, *Test, *Tests, *TestCase; no nested ($) classes. */
const TEST_NAME_RE = /^(?:Test\w*|\w*Test|\w*Tests|\w*TestCase)$/;

/** Concrete test classes surefire should report, as FQCNs. */
export function compiledTestClasses(testClassesDir: string): string[] {
  return walk(testClassesDir, (file) => file.endsWith(".class") && !file.includes("$"))
    .filter((file) => TEST_NAME_RE.test((file.split(sep).pop() ?? "").replace(/\.class$/, "")))
    .filter((file) => (classAccessFlags(readFileSync(file)) & (0x0200 | 0x0400)) === 0)
    .map((file) =>
      posix(relative(testClassesDir, file))
        .replace(/\.class$/, "")
        .replaceAll("/", "."),
    )
    .sort((a, b) => a.localeCompare(b));
}

export type SuiteReport = {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  testcases: number;
};

function attr(tag: string, name: string): number {
  const value = new RegExp(String.raw`\s${name}="([^"]*)"`).exec(tag)?.[1];
  return value === undefined ? Number.NaN : Number(value);
}

export function parseSurefireXml(xml: string): SuiteReport | undefined {
  const tag = /<testsuite\b[^>]*>/.exec(xml)?.[0];
  if (!tag) {
    return undefined;
  }
  const name = /\sname="([^"]*)"/.exec(tag)?.[1] ?? "";
  return {
    name,
    tests: attr(tag, "tests"),
    failures: attr(tag, "failures"),
    errors: attr(tag, "errors"),
    skipped: attr(tag, "skipped"),
    testcases: (xml.match(/<testcase\b/g) ?? []).length,
  };
}

export type ModuleTests = {
  module: string;
  suites: SuiteReport[];
  compiled: string[];
  problems: string[];
};

/** One module: read core-dir reports, cross-check against compiled test classes. */
export function checkModuleTests(stage: string, module: MavenModule): ModuleTests {
  const base = resolve(stage, module.dir);
  const reportsDir = join(base, "target", "surefire-reports");
  const compiled = compiledTestClasses(join(base, "target", "test-classes"));
  const problems: string[] = [];
  const files = existsSync(reportsDir)
    ? readdirSync(reportsDir).filter((name) => /^TEST-.+\.xml$/.test(name))
    : [];
  if (files.length === 0) {
    problems.push(`module ${module.dir}: no surefire report (fail closed)`);
  }
  const suites: SuiteReport[] = [];
  for (const file of files) {
    const suite = parseSurefireXml(readFileSync(join(reportsDir, file), "utf8"));
    if (!suite || [suite.tests, suite.failures, suite.errors, suite.skipped].some(Number.isNaN)) {
      problems.push(`module ${module.dir}: unreadable surefire report ${file}`);
      continue;
    }
    if (suite.tests !== suite.testcases) {
      problems.push(
        `module ${module.dir}: ${file} says tests=${suite.tests} but has ${suite.testcases} <testcase>`,
      );
    }
    suites.push(suite);
  }
  const reported = new Set(suites.map((suite) => suite.name));
  for (const name of compiled) {
    if (!reported.has(name)) {
      problems.push(`module ${module.dir}: compiled test class ${name} has no surefire report`);
    }
  }
  const compiledSet = new Set(compiled);
  for (const name of reported) {
    if (!compiledSet.has(name)) {
      problems.push(`module ${module.dir}: surefire report ${name} has no compiled test class`);
    }
  }
  return { module: module.dir, suites, compiled, problems };
}

function mvnArgs(stage: string, goals: string[]): string[] {
  return ["-B", "-ntp", "-f", join(stage, "pom.xml"), ...FORCED_PROPS, ...goals];
}

export function compileAdapter(stage: string, modules: MavenModule[]): Adapter {
  const built = buildModules(modules);
  return {
    capability: "maven:compile",
    command: process.env.GAUNTLET_MVN ?? "mvn",
    args: mvnArgs(stage, [
      MAVEN_GOALS.resources,
      MAVEN_GOALS.compile,
      MAVEN_GOALS.testResources,
      MAVEN_GOALS.testCompile,
    ]),
    cwd: stage,
    // total: main classes compiled across modules; metric: modules without classes.
    parser: (raw): AdapterResult => {
      const detail: string[] = [];
      let total = 0;
      for (const module of built) {
        const classes = walk(join(stage, module.dir, "target", "classes"), (f) =>
          f.endsWith(".class"),
        );
        if (classes.length === 0) {
          detail.push(`module ${module.dir}: no compiled main classes`);
        }
        total += classes.length;
      }
      return { ran: raw.exitCode === 0, total, metric: detail.length, detail };
    },
    accept: (result) =>
      result.metric === 0 ? undefined : "maven:compile: module(s) without classes",
  };
}

export function testAdapter(stage: string, modules: MavenModule[], sink: ModuleTests[]): Adapter {
  const built = buildModules(modules);
  return {
    capability: "maven:test",
    command: process.env.GAUNTLET_MVN ?? "mvn",
    args: mvnArgs(stage, [MAVEN_GOALS.surefire]),
    cwd: stage,
    // total: tests reported; metric: failures + errors + skipped.
    parser: (raw): AdapterResult => {
      const results = built.map((module) => checkModuleTests(stage, module));
      sink.push(...results);
      const suites = results.flatMap((result) => result.suites);
      const total = suites.reduce((sum, suite) => sum + suite.tests, 0);
      const metric = suites.reduce((sum, s) => sum + s.failures + s.errors + s.skipped, 0);
      const detail = results.flatMap((result) => result.problems);
      if (raw.exitCode !== 0 && metric === 0) {
        detail.push(`maven:test: mvn exited ${raw.exitCode} with no failing test in the reports`);
      }
      return { ran: suites.length > 0, total, metric, detail };
    },
    accept: (result) => {
      if (result.metric > 0) {
        return `maven:test: ${result.metric} failed/errored/skipped test(s) (skipped does not count as pass)`;
      }
      return result.detail.length > 0 ? "maven:test: report cross-check failed" : undefined;
    },
  };
}

const FRESHNESS_ROOTS = [
  ["src/main/java", "target/classes"],
  ["src/test/java", "target/test-classes"],
] as const;

function isDescriptor(relClass: string): boolean {
  return relClass.endsWith("package-info.class") || relClass.endsWith("module-info.class");
}

/** One module: each source has a class from this run; no class or report predates the run. */
function moduleFreshness(
  base: string,
  label: string,
  startedAt: number,
): { total: number; detail: string[] } {
  const detail: string[] = [];
  let total = 0;
  for (const [srcRoot, outRoot] of FRESHNESS_ROOTS) {
    for (const source of walk(join(base, srcRoot), (f) => f.endsWith(".java"))) {
      total += 1;
      const relClass = posix(relative(join(base, srcRoot), source)).replace(/\.java$/, ".class");
      if (isDescriptor(relClass)) {
        continue;
      }
      const out = join(base, outRoot, relClass);
      if (!existsSync(out)) {
        const relSource = relClass.replace(/\.class$/, ".java");
        detail.push(`module ${label}: ${srcRoot}/${relSource} has no class`);
      } else if (statSync(out).mtimeMs < startedAt) {
        detail.push(`module ${label}: ${outRoot}/${relClass} predates this run`);
      }
    }
  }
  for (const report of walk(join(base, "target", "surefire-reports"), (f) => f.endsWith(".xml"))) {
    if (statSync(report).mtimeMs < startedAt) {
      detail.push(`module ${label}: ${posix(relative(base, report))} predates this run`);
    }
  }
  return { total, detail };
}

/**
 * Freshness: every main/test source has a class compiled in THIS run, and every class and
 * report in the core dir was written after the run started (nothing stale or pre-seeded).
 */
export function freshnessAdapter(
  stage: string,
  modules: MavenModule[],
  startedAt: number,
): Adapter {
  const built = buildModules(modules);
  return {
    capability: "maven:freshness",
    args: [],
    cwd: stage,
    // total: sources checked; metric: stale or missing outputs.
    parser: (): AdapterResult => {
      const detail: string[] = [];
      let total = 0;
      for (const module of built) {
        const checked = moduleFreshness(join(stage, module.dir), module.dir, startedAt);
        total += checked.total;
        detail.push(...checked.detail);
      }
      return { ran: true, total, metric: detail.length, detail };
    },
    accept: (result) =>
      result.metric === 0 ? undefined : `maven:freshness: ${result.metric} stale/missing output(s)`,
  };
}

export type MavenRun = {
  ok: boolean;
  stage: string;
  modules: MavenModule[];
  pomFindings: PomFinding[];
  verdicts: CapabilityVerdict[];
  tests: ModuleTests[];
};

/**
 * Walking skeleton: pom guard -> stage -> compile -> test -> freshness. Every capability runs
 * (no short-circuit after the pom guard) so the report shows each false-green it caught.
 */
export async function runMavenSkeleton(
  root: string,
  log: (line: string) => void = console.info,
): Promise<MavenRun> {
  const modules = enumerateModules(root);
  const pomFindings = pomGuard(root, modules);
  const startedAt = Date.now();
  const stage = stageWorkspace(root);
  log(`maven: staged ${root} -> ${stage} (core-chosen, outside the workspace)`);
  const listed = modules.map((m) => m.dir + "[" + m.packaging + "]").join(", ");
  log(`maven: modules ${listed}`);
  const tests: ModuleTests[] = [];
  const verdicts: CapabilityVerdict[] = [];
  const guard: CapabilityVerdict = {
    capability: "maven:pom-guard",
    ok: pomFindings.length === 0,
    exitCode: pomFindings.length === 0 ? 0 : 1,
    durationMs: 0,
    ran: true,
    total: modules.length,
    metric: pomFindings.length,
    reasons: pomFindings.map((finding) => `${finding.pom}: ${finding.message}`),
  };
  verdicts.push(guard);
  for (const adapter of [
    compileAdapter(stage, modules),
    testAdapter(stage, modules, tests),
    freshnessAdapter(stage, modules, startedAt),
  ]) {
    log(`\n=== CAPABILITY: ${adapter.capability} ===`);
    verdicts.push(await runAdapter(adapter));
  }
  const run: MavenRun = {
    ok: verdicts.every((verdict) => verdict.ok),
    stage,
    modules,
    pomFindings,
    verdicts,
    tests,
  };
  if (process.env.GAUNTLET_KEEP_STAGE !== "1") {
    rmSync(stage, { recursive: true, force: true });
  }
  return run;
}
