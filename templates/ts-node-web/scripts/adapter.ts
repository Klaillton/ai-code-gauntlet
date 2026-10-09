/**
 * ADD-POLY S1 — L1 adapter contract + fail-closed `stack`.
 *
 * - L0 core (policy-base, protect-specs, secrets, adr-lint, ...) is files + git only.
 * - L1: one adapter per capability, `{ command, args, parser }` -> `{ ran, total, metric }`.
 *   The core runs the command, then the parser turns raw output into counts. `ran: false`
 *   or `total === 0` is FAIL in the core, never in the adapter (a parser cannot pass itself).
 * - L2: concrete adapters. `npm` = today's config gates at parity (exit-code parser);
 *   `maven` = walking skeleton (see maven.ts). `gradle` is not implemented yet (FAIL).
 * - `stack` comes from the BASE config (policy-base). Missing, unknown, or not matching the
 *   build files on disk is FAIL.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export const STACKS = ["npm", "maven", "gradle"] as const;
export type Stack = (typeof STACKS)[number];

/** Stacks the S1 core can actually run. gradle is declared in the design, not built yet. */
export const SUPPORTED_STACKS: readonly Stack[] = ["npm", "maven"];

export type RawRun = { exitCode: number; durationMs: number };

/** What every adapter parser returns. `metric` is capability-specific (see each adapter). */
export type AdapterResult = {
  ran: boolean;
  total: number;
  metric: number;
  detail: string[];
};

export type Adapter = {
  capability: string;
  /** Omitted only for core-internal checks that read files the previous adapters wrote. */
  command?: string;
  args: string[];
  /** Working directory chosen by the core (never by the consumer config). */
  cwd: string;
  stdio?: "inherit" | "ignore";
  parser: (raw: RawRun) => AdapterResult;
  /** Extra verdict rule on top of ran/total (e.g. failures must be 0). */
  accept?: (result: AdapterResult) => string | undefined;
};

export type CapabilityVerdict = {
  capability: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  ran: boolean;
  total: number;
  metric: number;
  reasons: string[];
};

function spawnCommand(adapter: Adapter): Promise<number> {
  return new Promise((resolveCode) => {
    if (adapter.command === undefined) {
      resolveCode(0);
      return;
    }
    const child = spawn(adapter.command, adapter.args, {
      cwd: adapter.cwd,
      stdio: adapter.stdio ?? "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("error", () => resolveCode(127));
    child.on("exit", (code) => resolveCode(code ?? 1));
  });
}

/** Core verdict: ran, total > 0, then the adapter's own accept rule. */
export function judge(capability: string, result: AdapterResult, raw: RawRun): CapabilityVerdict {
  const reasons: string[] = [];
  if (!result.ran) {
    reasons.push(`${capability}: did not run (exit ${raw.exitCode})`);
  } else if (result.total === 0) {
    reasons.push(`${capability}: total == 0 (nothing was measured; fail closed)`);
  }
  return {
    capability,
    ok: reasons.length === 0,
    exitCode: reasons.length === 0 ? 0 : raw.exitCode || 1,
    durationMs: raw.durationMs,
    ran: result.ran,
    total: result.total,
    metric: result.metric,
    reasons: [...reasons, ...result.detail],
  };
}

export async function runAdapter(adapter: Adapter): Promise<CapabilityVerdict> {
  const started = Date.now();
  const exitCode = await spawnCommand(adapter);
  const raw = { exitCode, durationMs: Date.now() - started };
  let result: AdapterResult;
  try {
    result = adapter.parser(raw);
  } catch (error) {
    result = { ran: false, total: 0, metric: 0, detail: [`parser error: ${String(error)}`] };
  }
  const verdict = judge(adapter.capability, result, raw);
  const rejected = verdict.ok ? adapter.accept?.(result) : undefined;
  if (rejected !== undefined) {
    return {
      ...verdict,
      ok: false,
      exitCode: exitCode || 1,
      reasons: [rejected, ...verdict.reasons],
    };
  }
  return verdict;
}

/** npm (L2): a config gate is one command; the exit code is the whole signal (parity). */
export function npmGateAdapter(
  gate: { id: string; command: string; args: string[] },
  cwd: string,
): Adapter {
  return {
    capability: gate.id,
    command: gate.command,
    args: gate.args,
    cwd,
    // ran: the command was started; metric: its exit code; the verdict is exit 0 (as before).
    parser: (raw) => ({ ran: true, total: 1, metric: raw.exitCode, detail: [] }),
    accept: (result) => (result.metric === 0 ? undefined : `${gate.id}: exit ${result.metric}`),
  };
}

const BUILD_FILES: Record<Stack, string[]> = {
  npm: ["package.json"],
  maven: ["pom.xml"],
  gradle: ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
};

/** Stacks whose root build files are present in `cwd`. */
export function detectStacks(cwd: string): Stack[] {
  return STACKS.filter((stack) => BUILD_FILES[stack].some((file) => existsSync(join(cwd, file))));
}

export type StackCheck = { ok: true; stack: Stack } | { ok: false; reason: string };

/** Fail-closed: declared stack must be known, supported, and the only stack on disk. */
export function checkStack(declared: unknown, cwd: string): StackCheck {
  if (declared === undefined || declared === null || declared === "") {
    return {
      ok: false,
      reason: `gauntlet.config.json has no "stack" (one of ${STACKS.join(", ")}); fail closed`,
    };
  }
  if (typeof declared !== "string" || !(STACKS as readonly string[]).includes(declared)) {
    return { ok: false, reason: `unknown stack ${JSON.stringify(declared)}` };
  }
  const stack = declared as Stack;
  if (!SUPPORTED_STACKS.includes(stack)) {
    return {
      ok: false,
      reason: `stack "${stack}" is not implemented yet (ADD-POLY S1: npm, maven)`,
    };
  }
  const present = detectStacks(cwd);
  if (!present.includes(stack)) {
    return {
      ok: false,
      reason: `stack "${stack}" declared but ${BUILD_FILES[stack].join(" / ")} not found (build files present: ${present.join(", ") || "none"})`,
    };
  }
  const others = present.filter((other) => other !== stack);
  if (others.length > 0) {
    return {
      ok: false,
      reason: `stack "${stack}" declared but build files for ${others.join(", ")} are also present (S1 supports one stack per tree)`,
    };
  }
  return { ok: true, stack };
}
