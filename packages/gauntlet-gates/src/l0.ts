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
