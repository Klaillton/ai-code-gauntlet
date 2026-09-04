import { readFileSync, writeFileSync } from "node:fs";
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
  strictness?: string;
  gates: Gate[];
};

type GateResult = {
  id: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  skipped?: boolean;
};

function loadConfig(): GauntletConfig {
  const path = resolve(process.cwd(), "gauntlet.config.json");
  return JSON.parse(readFileSync(path, "utf8")) as GauntletConfig;
}

function runStep(gate: Gate): Promise<number> {
  return new Promise((resolveCode) => {
    console.info(`\n=== GATE: ${gate.id} ===`);
    const child = spawn(gate.command, gate.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("exit", (code) => resolveCode(code ?? 1));
  });
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch {
    return undefined;
  }
}

function writeReport(config: GauntletConfig, gates: GateResult[], ok: boolean): void {
  const report = {
    name: config.name ?? "gauntlet",
    generatedAt: new Date().toISOString(),
    strictness: config.strictness ?? "strict",
    ok,
    gates,
    specSync: readJson("spec-sync-report.json"),
    noCheat: readJson("no-cheat-report.json"),
    protectSpecs: readJson("protect-specs-report.json"),
    complexity: readJson("complexity-report.json"),
    mutation: readJson("mutation-report.json"),
    depsLock: readJson("deps-lock-report.json"),
  };
  writeFileSync(resolve("gauntlet-report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const title = config.name ?? "gauntlet";
  console.info(`AI Code Gauntlet — verify pipeline (${title})`);
  const results: GateResult[] = [];

  for (const gate of config.gates) {
    if (gate.enabled === false) {
      console.error(`\nGate ${gate.id} has enabled:false — mainline verify is fail-closed.`);
      results.push({ id: gate.id, ok: false, exitCode: 1, durationMs: 0, skipped: true });
      writeReport(config, results, false);
      process.exitCode = 1;
      return;
    }
    const started = Date.now();
    const code = await runStep(gate);
    const durationMs = Date.now() - started;
    const gateOk = code === 0;
    results.push({ id: gate.id, ok: gateOk, exitCode: code, durationMs });
    if (!gateOk) {
      writeReport(config, results, false);
      console.error(`\nGate failed: ${gate.id} (exit ${code})`);
      process.exitCode = code;
      return;
    }
    console.info(`Gate passed: ${gate.id}`);
  }
  writeReport(config, results, true);
  console.info("\nAll gates passed. Code is eligible for human exploratory check.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
