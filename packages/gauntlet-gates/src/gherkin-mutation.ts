import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { includeGitBranchDivergence, loadConfig } from "./inventory.js";
import {
  listGitChangedRels,
  selectMutationFiles,
  type MutantResult,
  type MutantStatus,
} from "./mutation.js";

/**
 * Mutate Gherkin examples/assertions. If cucumber still passes, the scenario
 * was not actually pinning that value (theater). Does not replace unit mutation.
 *
 * Todo verify includes the gate after e2e. Template ships the script opt-in.
 */

export type GherkinMutant = {
  start: number;
  end: number;
  replacement: string;
  operator: string;
};

type GherkinConfig = {
  include?: string[];
  threshold?: number;
  timeoutMs?: number;
  maxMutants?: number;
};

const DEFAULT_INCLUDE = "features";
const DEFAULT_THRESHOLD = 80;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX = 12;
const STEP_RE = /^[ \t]*(Given|When|Then|And|But)\b(.*)$/gm;

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function walkFeatures(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkFeatures(full));
    } else if (full.endsWith(".feature")) {
      out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function mutateQuoted(inner: string): string {
  return inner.trim().length === 0 ? "x" : `${inner}X`;
}

export function planGherkinMutants(source: string, max = DEFAULT_MAX): GherkinMutant[] {
  const thenAnd: GherkinMutant[] = [];
  const givenWhen: GherkinMutant[] = [];
  const step = new RegExp(STEP_RE.source, "gm");
  for (const match of source.matchAll(step)) {
    const keyword = match[1] ?? "";
    const rest = match[2] ?? "";
    const restStart = (match.index ?? 0) + (match[0].length - rest.length);
    const bucket =
      keyword === "Then" || keyword === "And" || keyword === "But" ? thenAnd : givenWhen;

    const quote = /"([^"]*)"/g;
    for (const q of rest.matchAll(quote)) {
      const inner = q[1] ?? "";
      const abs = restStart + (q.index ?? 0);
      bucket.push({
        start: abs,
        end: abs + q[0].length,
        replacement: `"${mutateQuoted(inner)}"`,
        operator: "gherkin:quote",
      });
    }

    if (keyword === "Then" || keyword === "And" || keyword === "But") {
      const status = /\b([1-5]\d{2})\b/g;
      for (const s of rest.matchAll(status)) {
        const raw = s[1] ?? "";
        const abs = restStart + (s.index ?? 0);
        bucket.push({
          start: abs,
          end: abs + raw.length,
          replacement: String(Number(raw) + 1),
          operator: "gherkin:status",
        });
      }
    }
  }
  return [...thenAnd, ...givenWhen].slice(0, max);
}

function applyMutant(source: string, mutant: GherkinMutant): string {
  return source.slice(0, mutant.start) + mutant.replacement + source.slice(mutant.end);
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const rec = error as { killed?: boolean; signal?: string; code?: string };
  return rec.killed === true || rec.signal === "SIGTERM" || rec.code === "ETIMEDOUT";
}

function runE2e(cwd: string, timeoutMs: number): MutantStatus {
  try {
    execFileSync("npx", ["tsx", "scripts/run-e2e.ts"], {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: process.env.CI ?? "1", GAUNTLET_E2E: "1" },
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

function lineCol(source: string, pos: number): { line: number; column: number } {
  const prefix = source.slice(0, pos);
  const lines = prefix.split(/\r?\n/);
  return { line: lines.length, column: (lines[lines.length - 1] ?? "").length + 1 };
}

export function runGherkinMutation(cwd = process.cwd()): {
  ok: boolean;
  score: number;
  findings: string[];
  mutants: MutantResult[];
} {
  const config = loadConfig(cwd) as ReturnType<typeof loadConfig> & {
    gherkinMutation?: GherkinConfig;
  };
  const includeRel = config.gherkinMutation?.include?.[0] ?? DEFAULT_INCLUDE;
  const threshold = config.gherkinMutation?.threshold ?? DEFAULT_THRESHOLD;
  const timeoutMs = config.gherkinMutation?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxMutants = config.gherkinMutation?.maxMutants ?? DEFAULT_MAX;
  const includeDir = resolve(cwd, includeRel);
  const findings: string[] = [];

  const allFiles = walkFeatures(includeDir);
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

  const baseline = runE2e(cwd, timeoutMs);
  if (baseline !== "survived") {
    findings.push(`Baseline e2e did not pass (${baseline}); gherkin-mutation is fail-closed.`);
    const report = {
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
      mutants: [] as MutantResult[],
    };
    writeFileSync(
      resolve(cwd, "gherkin-mutation-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    return report;
  }

  const mutants: MutantResult[] = [];
  try {
    for (const file of files) {
      const source = originals.get(file) ?? "";
      const rel = posixRel(cwd, file);
      for (const mutant of planGherkinMutants(source, maxMutants)) {
        const loc = lineCol(source, mutant.start);
        writeFileSync(file, applyMutant(source, mutant));
        const status = runE2e(cwd, timeoutMs);
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
          findings.push(
            `Survivor ${rel}:${loc.line}:${loc.column} ${mutant.operator} (assertion did not pin the example)`,
          );
        }
        if (mutants.length >= maxMutants) {
          break;
        }
      }
      if (mutants.length >= maxMutants) {
        break;
      }
    }
  } finally {
    for (const [file, content] of originals) {
      writeFileSync(file, content);
    }
  }

  const killed = mutants.filter((m) => m.status === "killed" || m.status === "timeout").length;
  const survived = mutants.filter((m) => m.status === "survived").length;
  const timeout = mutants.filter((m) => m.status === "timeout").length;
  const error = mutants.filter((m) => m.status === "error").length;
  const mutantCount = mutants.length;
  const score = mutantCount === 0 ? 100 : Math.round((killed / mutantCount) * 100);
  if (mutantCount === 0) {
    findings.push(`No Gherkin assertion sites under ${includeRel}; treating score as 100.`);
  }
  if (score < threshold) {
    findings.push(`Gherkin kill score ${score}% is below threshold ${threshold}%.`);
  }

  const ok = score >= threshold && error === 0;
  const report = {
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
  };
  writeFileSync(
    resolve(cwd, "gherkin-mutation-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
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
  const result = runGherkinMutation();
  console.info(`gherkin-mutation — ${result.score}% killed (${result.mutants.length} site(s))`);
  for (const finding of result.findings) {
    const log = result.ok ? console.info : console.error;
    log(`  ${result.ok ? "i" : "x"} ${finding}`);
  }
  if (!result.ok) {
    console.error("gherkin-mutation failed.");
    process.exitCode = 1;
    return;
  }
  console.info("gherkin-mutation passed.");
}

if (isDirectRun()) {
  main();
}
