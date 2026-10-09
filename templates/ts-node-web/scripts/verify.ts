import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { checkStack, npmGateAdapter, runAdapter, type Stack } from "./adapter.js";
import { checkL0Gates, L0_GATES, runL0Gate } from "./l0.js";
import { runMavenSkeleton } from "./maven.js";
import { loadPolicyConfig, printPolicyFindings, runPolicyBase } from "./policy-base.js";

type Gate = {
  id: string;
  command: string;
  args: string[];
  enabled?: boolean;
};

type GauntletConfig = {
  name?: string;
  /** ADD-POLY: npm | maven (gradle declared, not implemented). Missing = FAIL. */
  stack?: unknown;
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

/** CHANGE-4: gates[] / strictness come from the base-branch config (policy-base.ts). */
function loadConfig(): GauntletConfig {
  return loadPolicyConfig(process.cwd()) as unknown as GauntletConfig;
}

/** npm L2 adapter: same command, same exit-code verdict as before ADD-POLY (parity). */
async function runStep(gate: Gate): Promise<number> {
  console.info(`\n=== GATE: ${gate.id} ===`);
  const verdict = await runAdapter(npmGateAdapter(gate, process.cwd()));
  return verdict.ok ? 0 : verdict.exitCode;
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
    stack: typeof config.stack === "string" ? config.stack : null,
    strictness: config.strictness ?? "strict",
    ok,
    gates,
    maven: readJson("maven-report.json"),
    policyBase: readJson("policy-base-report.json"),
    specSync: readJson("spec-sync-report.json"),
    noCheat: readJson("no-cheat-report.json"),
    protectSpecs: readJson("protect-specs-report.json"),
    complexity: readJson("complexity-report.json"),
    mutation: readJson("mutation-report.json"),
    depsLock: readJson("deps-lock-report.json"),
    secretsScan: readJson("secrets-scan-report.json"),
    archBound: readJson("arch-bound-report.json"),
    crap: readJson("crap-report.json"),
    holesReview: readJson("holes-review-report.json"),
    gherkinMutation: readJson("gherkin-mutation-report.json"),
  };
  writeFileSync(resolve("gauntlet-report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const title = config.name ?? "gauntlet";
  console.info(`AI Code Gauntlet — verify pipeline (${title})`);
  const results: GateResult[] = [];

  // CHANGE-4: built-in first step; not in gates[] so a head edit cannot drop it.
  console.info("\n=== GATE: policy-base (built-in) ===");
  const policyStarted = Date.now();
  const policy = runPolicyBase();
  printPolicyFindings(policy);
  results.push({
    id: "policy-base",
    ok: policy.ok,
    exitCode: policy.ok ? 0 : 1,
    durationMs: Date.now() - policyStarted,
  });
  if (!policy.ok) {
    writeReport(config, results, false);
    console.error("\nGate failed: policy-base (exit 1)");
    process.exitCode = 1;
    return;
  }

  // ADD-POLY: built-in, fail-closed; `stack` is read from the base config like every policy key.
  console.info("\n=== GATE: stack (built-in) ===");
  const stackCheck = checkStack(config.stack, process.cwd());
  results.push({ id: "stack", ok: stackCheck.ok, exitCode: stackCheck.ok ? 0 : 1, durationMs: 0 });
  if (!stackCheck.ok) {
    writeReport(config, results, false);
    console.error(`\nGate failed: stack — ${stackCheck.reason}`);
    process.exitCode = 1;
    return;
  }
  console.info(`Gate passed: stack (${stackCheck.stack})`);

  // ADD-POLY: L0 gates are mandatory for every stack (config validation, built-in).
  console.info("\n=== GATE: l0-config (built-in) ===");
  const l0Problems = checkL0Gates(stackCheck.stack, config.gates);
  results.push({
    id: "l0-config",
    ok: l0Problems.length === 0,
    exitCode: l0Problems.length === 0 ? 0 : 1,
    durationMs: 0,
  });
  if (l0Problems.length > 0) {
    for (const problem of l0Problems) {
      console.error(`  x ${problem}`);
    }
    writeReport(config, results, false);
    console.error("\nGate failed: l0-config");
    process.exitCode = 1;
    return;
  }
  console.info(`Gate passed: l0-config (${L0_GATES.join(", ")})`);
  if (stackCheck.stack !== "npm") {
    await runCoreStack(stackCheck.stack, config, results);
    return;
  }

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

/**
 * Non-npm stacks: the core picks every command. gates[] holds L0 ids only (validated above);
 * L0 runs from this kit copy in canonical order, then the stack's capabilities.
 */
async function runCoreStack(stack: Stack, config: GauntletConfig, results: GateResult[]) {
  for (const id of L0_GATES) {
    console.info(`\n=== GATE: ${id} (L0, runner-owned) ===`);
    const started = Date.now();
    const code = await runL0Gate(id, stack, process.cwd());
    results.push({ id, ok: code === 0, exitCode: code, durationMs: Date.now() - started });
    if (code !== 0) {
      writeReport(config, results, false);
      console.error(`\nGate failed: ${id} (exit ${code})`);
      process.exitCode = code;
      return;
    }
    console.info(`Gate passed: ${id}`);
  }
  const run = await runMavenSkeleton(process.cwd());
  writeFileSync(
    resolve("maven-report.json"),
    `${JSON.stringify({ ...run, generatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  for (const verdict of run.verdicts) {
    results.push({
      id: verdict.capability,
      ok: verdict.ok,
      exitCode: verdict.exitCode,
      durationMs: verdict.durationMs,
    });
    const mark = verdict.ok ? "Gate passed" : "Gate failed";
    const counts = `ran=${verdict.ran} total=${verdict.total} metric=${verdict.metric}`;
    (verdict.ok ? console.info : console.error)(`${mark}: ${verdict.capability} (${counts})`);
    for (const reason of verdict.reasons) {
      console.error(`  x ${reason}`);
    }
  }
  writeReport(config, results, run.ok);
  if (!run.ok) {
    process.exitCode = 1;
    return;
  }
  console.info("\nAll gates passed (L0 + maven S1 skeleton: compile, test, freshness).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
