/**
 * Simple red→green loop runner for AI agents.
 * Runs `npm run verify` up to MAX_ITERATIONS times.
 * Exits 0 on first full green; exits 1 if still red after max attempts.
 *
 * Agents should implement fixes between iterations (this script only re-runs verify).
 * For fully autonomous loops, wrap with your agent harness calling this after each edit.
 */
import { spawn } from "node:child_process";
import process from "node:process";

const maxIterations = Number(process.env.MAX_ITERATIONS ?? 5);

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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
