/**
 * Simple red→green loop runner for AI agents.
 * Runs `npm run verify` up to a configured max iterations.
 * Uses gauntlet.config.json agent.maxVerifyCycles (default 5); MAX_ITERATIONS env overrides when set.
 * Exits 0 on first full green; exits 1 if still red after max attempts.
 *
 * Agents should implement fixes between iterations (this script only re-runs verify).
 * For fully autonomous loops, wrap with your agent harness calling this after each edit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function readConfiguredMax(cwd = process.cwd()): number | undefined {
  try {
    const raw = readFileSync(join(cwd, "gauntlet.config.json"), "utf8");
    const n = (JSON.parse(raw) as { agent?: { maxVerifyCycles?: unknown } }).agent?.maxVerifyCycles;
    if (typeof n === "number" && Number.isInteger(n) && n >= 1) return n;
  } catch {
    /* missing/invalid config → fall through */
  }
  return undefined;
}

/** Throws when MAX_ITERATIONS is set but not an integer >= 1. Never returns a non-positive cap. */
export function resolveMaxIterations(
  env: NodeJS.ProcessEnv = process.env,
  configured: number | undefined = readConfiguredMax(),
): number {
  const fromEnv = env.MAX_ITERATIONS;
  if (fromEnv !== undefined) {
    const n = Number(fromEnv);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`Invalid MAX_ITERATIONS=${JSON.stringify(fromEnv)}; need integer >= 1`);
    }
    return n;
  }
  return configured ?? 5;
}

function runVerify(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", "verify"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  let maxIterations: number;
  try {
    maxIterations = resolveMaxIterations();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  console.info(`Agent loop: max ${maxIterations} verify iterations`);
  for (let i = 1; i <= maxIterations; i += 1) {
    console.info(`\n──────── iteration ${i}/${maxIterations} ────────`);
    const code = await runVerify();
    if (code === 0) {
      console.info(`\n✅ Green on iteration ${i}`);
      process.exit(0);
    }
    console.error(`\n✖ Still red on iteration ${i}`);
    if (i === maxIterations) {
      console.error("Max iterations reached. Hand back to human.");
      process.exit(1);
    }
    console.info(
      "Agent must fix failures before next iteration. " +
        "If you are an agent reading this output, apply fixes and re-run agent:loop, " +
        "or re-run verify after edits.",
    );
    // Single-shot by default: agents re-invoke after edits.
    // Set CONTINUOUS=1 only if an outer agent already applied fixes (not recommended alone).
    if (process.env.CONTINUOUS !== "1") {
      process.exit(code);
    }
  }
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isCliEntry()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
