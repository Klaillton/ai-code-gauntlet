import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

type Gate = {
  id: string;
  command: string;
  args: string[];
  enabled?: boolean;
};

type GauntletConfig = {
  name?: string;
  gates: Gate[];
};

function loadConfig(): GauntletConfig {
  const path = resolve(process.cwd(), "gauntlet.config.json");
  return JSON.parse(readFileSync(path, "utf8")) as GauntletConfig;
}

function runStep(gate: Gate): Promise<number> {
  return new Promise((resolveCode) => {
    console.info(`\n═══ GATE: ${gate.id} ═══`);
    const child = spawn(gate.command, gate.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("exit", (code) => resolveCode(code ?? 1));
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const title = config.name ?? "gauntlet";
  console.info(`AI Code Gauntlet — verify pipeline (${title})`);

  for (const gate of config.gates) {
    if (gate.enabled === false) {
      console.info(`\n⏭ GATE skipped: ${gate.id}`);
      continue;
    }
    const code = await runStep(gate);
    if (code !== 0) {
      console.error(`\n✖ Gate failed: ${gate.id} (exit ${code})`);
      process.exit(code);
    }
    console.info(`✓ Gate passed: ${gate.id}`);
  }
  console.info("\n✅ All gates passed. Code is eligible for human exploratory check.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
