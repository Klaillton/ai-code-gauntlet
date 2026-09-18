import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { loadConfig, type Strictness } from "./inventory.js";

export type CheatFinding = {
  id: "D9";
  severity: "fail" | "warn" | "info";
  message: string;
};

const CHEAT_RE =
  /\b(?:test|it|describe)\.(?:skip|only)\s*\(|\b(?:xit|xdescribe|xtest)\s*\(|\bpending\s*\(/;

const THRESHOLD_DISABLE_RE = /threshold|coverage/i;
const DISABLE_RE = /\b(disable|disabled|skip|ignore|off)\b/i;

const THRESHOLD_KEYS = ["lines", "functions", "branches", "statements"] as const;

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function gitShow(cwd: string, spec: string): string | undefined {
  try {
    return execFileSync("git", ["show", spec], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
}

function parseThresholds(source: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of THRESHOLD_KEYS) {
    const match = source.match(new RegExp(key + ":\\s*(\\d+)"));
    if (match?.[1]) {
      out[key] = Number(match[1]);
    }
  }
  return out;
}

function scanCheats(cwd: string): CheatFinding[] {
  const findings: CheatFinding[] = [];
  const roots = ["tests", "e2e", "features", "src"];
  const extra = ["vitest.config.ts", "cucumber.cjs", "gauntlet.config.json"];
  const files = [
    ...roots.flatMap((root) => walk(resolve(cwd, root))),
    ...extra.map((name) => resolve(cwd, name)).filter((file) => existsSync(file)),
  ];
  for (const file of files) {
    if (!/\.(ts|js|cjs|feature|json)$/.test(file)) {
      continue;
    }
    const rel = posixRel(cwd, file);
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return;
      }
      if (CHEAT_RE.test(line) || /@skip\b/.test(line) || /\bScenario\s+\(skipped\)/i.test(line)) {
        findings.push({
          id: "D9",
          severity: "fail",
          message: `D9 cheat marker in ${rel}:${index + 1}: ${trimmed}`,
        });
      }
      if (
        (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) &&
        THRESHOLD_DISABLE_RE.test(trimmed) &&
        DISABLE_RE.test(trimmed)
      ) {
        findings.push({
          id: "D9",
          severity: "fail",
          message: `D9 coverage/threshold disable comment in ${rel}:${index + 1}: ${trimmed}`,
        });
      }
    });
  }
  return findings;
}

function scanDisabledGates(cwd: string): CheatFinding[] {
  const config = loadConfig(cwd);
  const findings: CheatFinding[] = [];
  for (const gate of config.gates) {
    if (gate.enabled === false) {
      findings.push({
        id: "D9",
        severity: "fail",
        message: `D9 gauntlet gate "${gate.id}" has enabled:false — mainline verify must not skip gates`,
      });
    }
  }
  return findings;
}

function scanCoverageFloors(cwd: string, strictness: Strictness): CheatFinding[] {
  const currentPath = resolve(cwd, "vitest.config.ts");
  if (!existsSync(currentPath)) {
    return [
      {
        id: "D9",
        severity: strictness === "strict" ? "fail" : "warn",
        message: "D9 vitest.config.ts missing; cannot prove coverage floors.",
      },
    ];
  }
  const current = parseThresholds(readFileSync(currentPath, "utf8"));
  const base =
    gitShow(cwd, "HEAD:vitest.config.ts") ??
    gitShow(cwd, "origin/main:vitest.config.ts") ??
    gitShow(cwd, "main:vitest.config.ts");
  if (!base) {
    return [
      {
        id: "D9",
        severity: "info",
        message: "D9 no git baseline for vitest.config.ts; skip/only scan still applies.",
      },
    ];
  }
  const previous = parseThresholds(base);
  const findings: CheatFinding[] = [];
  for (const key of THRESHOLD_KEYS) {
    const before = previous[key];
    const after = current[key];
    if (before !== undefined && after !== undefined && after < before) {
      findings.push({
        id: "D9",
        severity: "fail",
        message: `D9 coverage ${key} lowered ${before} -> ${after}`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "D9",
      severity: "info",
      message: "D9 coverage floors were not lowered versus git baseline.",
    });
  }
  return findings;
}

export function runNoCheat(cwd = process.cwd()): {
  ok: boolean;
  findings: CheatFinding[];
} {
  const config = loadConfig(cwd);
  const strictness: Strictness = config.strictness === "lenient" ? "lenient" : "strict";
  const findings = [
    ...scanCheats(cwd),
    ...scanDisabledGates(cwd),
    ...scanCoverageFloors(cwd, strictness),
  ];
  const ok = findings.every((finding) => finding.severity !== "fail");
  writeFileSync(
    resolve(cwd, "no-cheat-report.json"),
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
  const result = runNoCheat();
  console.info(`no-cheat — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : finding.severity === "warn" ? "!" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("no-cheat failed.");
    process.exitCode = 1;
    return;
  }
  console.info("no-cheat passed.");
}

if (isDirectRun()) {
  main();
}
