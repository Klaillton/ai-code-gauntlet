/**
 * ADD-POLY L0 core: files + git gates that every stack runs (Gate design, S1 revise #2).
 *
 * - policy-base is built-in (verify.ts), so it is not listed here.
 * - D11 + D13 live in spec-sync. npm runs the full spec-sync (D1-D13); other stacks run
 *   `spec-sync --l0` (D11 edge inventory + D13 OpenAPI <-> contract.cases only), because the
 *   other D-checks read TypeScript routes/domain.
 * - Config validation (every stack): each L0 id must be in gates[]. npm entries must be exactly
 *   `npm run <id>`; non-npm entries are ids only (the runner owns the command). Missing = FAIL.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Stack } from "./adapter.js";
import { DEFAULT_IMPLEMENTATION_GLOBS, isImplementationPath } from "./holes-review.js";
import { buildModules, enumerateModules } from "./maven.js";

export const L0_GATES = [
  "protect-specs",
  "holes-review",
  "spec-code",
  "adr-lint",
  "sdd-presence",
  "secrets-scan",
  "spec-sync",
] as const;
export type L0Gate = (typeof L0_GATES)[number];

type RawGate = { id?: unknown; command?: unknown; args?: unknown };

function isRawGate(value: unknown): value is RawGate {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** FAIL reasons for the L0 part of gates[] (empty = ok). */
export function checkL0Gates(stack: Stack, gates: unknown): string[] {
  if (!Array.isArray(gates)) {
    return ["gates[] missing or not an array: L0 gates cannot be proven (fail closed)"];
  }
  const entries = gates.filter(isRawGate);
  const problems: string[] = [];
  for (const id of L0_GATES) {
    const entry = entries.find((gate) => gate.id === id);
    if (!entry) {
      problems.push(`L0 gate "${id}" missing from gates[] (required for every stack)`);
      continue;
    }
    if (stack === "npm") {
      const args = Array.isArray(entry.args) ? entry.args : [];
      if (entry.command !== "npm" || args.length !== 2 || args[0] !== "run" || args[1] !== id) {
        problems.push(`L0 gate "${id}" must be exactly \`npm run ${id}\``);
      }
    } else if ("command" in entry || "args" in entry) {
      problems.push(`L0 gate "${id}": stack ${stack} gates are ids only; the runner owns commands`);
    }
  }
  if (stack !== "npm") {
    for (const entry of entries) {
      if (!(L0_GATES as readonly unknown[]).includes(entry.id)) {
        problems.push(
          `gates[] entry ${JSON.stringify(entry.id)} is not an L0 gate (stack ${stack})`,
        );
      }
    }
  }
  return problems;
}

/** Maven build files: whole-file protected until S2's semantic pom diff (adopt writes these). */
export const MAVEN_BUILD_GLOBS = ["**/pom.xml", ".mvn/**", "mvnw", "mvnw.cmd"] as const;

type L0Config = {
  agent?: { protectedGlobs?: unknown };
  holesReview?: { implementationGlobs?: unknown };
  specCode?: { implementationGlobs?: unknown };
};

function stringList(value: unknown, fallback: readonly string[]): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [...fallback];
}

/** Probe paths that stand for "this module's main sources" (code + resources). */
function moduleProbes(dir: string): string[] {
  const base = dir === "." ? "" : `${dir}/`;
  return [`${base}src/main/java/gauntlet/Probe.java`, `${base}src/main/resources/gauntlet.probe`];
}

/**
 * Maven-only L0 config checks (FAIL reasons; empty = ok): every build module (enumerated
 * recursively, like the core) must have its src/main covered by holesReview and specCode
 * implementationGlobs, and the build files must be in agent.protectedGlobs.
 */
export function checkMavenL0Coverage(root: string, config: unknown): string[] {
  const cfg = (typeof config === "object" && config !== null ? config : {}) as L0Config;
  const problems: string[] = [];
  const protectedGlobs = stringList(cfg.agent?.protectedGlobs, []);
  for (const glob of MAVEN_BUILD_GLOBS) {
    if (!protectedGlobs.includes(glob)) {
      problems.push(`agent.protectedGlobs must include "${glob}" (maven build files, until S2)`);
    }
  }
  const scopes: [string, string[]][] = [
    ["holesReview", stringList(cfg.holesReview?.implementationGlobs, DEFAULT_IMPLEMENTATION_GLOBS)],
    ["specCode", stringList(cfg.specCode?.implementationGlobs, DEFAULT_IMPLEMENTATION_GLOBS)],
  ];
  for (const module of buildModules(enumerateModules(root))) {
    for (const [key, globs] of scopes) {
      if (!moduleProbes(module.dir).every((probe) => isImplementationPath(probe, globs))) {
        const where = module.dir === "." ? "src/main/**" : `${module.dir}/src/main/**`;
        problems.push(
          `module ${module.dir}: ${where} not covered by ${key}.implementationGlobs (add "${where}"; a policy change)`,
        );
      }
    }
  }
  return problems;
}

/** Runner-owned invocation of an L0 script from THIS kit copy (never the consumer's scripts/). */
export function l0Command(id: L0Gate, stack: Stack): { command: string; args: string[] } {
  const here = dirname(fileURLToPath(import.meta.url));
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  const extra = id === "spec-sync" && stack !== "npm" ? ["--l0"] : [];
  return { command: process.execPath, args: [tsxCli, join(here, `${id}.ts`), ...extra] };
}

export function runL0Gate(id: L0Gate, stack: Stack, cwd: string): Promise<number> {
  const { command, args } = l0Command(id, stack);
  return new Promise((resolveCode) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.on("error", () => resolveCode(127));
    child.on("exit", (code) => resolveCode(code ?? 1));
  });
}
