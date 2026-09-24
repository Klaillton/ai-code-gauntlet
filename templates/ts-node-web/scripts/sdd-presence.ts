/**
 * D15 — Security + Observability presence (greenfield / SDD-active apps).
 *
 * When SDD is active, require docs/sdd/Security.md and docs/sdd/Observability.md
 * (or config overrides). Each file needs a markdown heading and ≥1 requirement
 * list item. Quality of prose is Spec's job — lorem/TODO-only still passes.
 *
 * Skip when `sdd: false` (no SDD).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { getSddOptions, isSddActive, loadConfig } from "./inventory.js";

export type SddPresenceFinding = {
  id: "D15" | "sdd-presence";
  severity: "fail" | "warn" | "info";
  message: string;
};

export const DEFAULT_SECURITY_PATH = "docs/sdd/Security.md";
export const DEFAULT_OBSERVABILITY_PATH = "docs/sdd/Observability.md";

export type SddDocKind = "Security" | "Observability";

export type SddDocValidation = {
  ok: boolean;
  missing: boolean;
  empty: boolean;
  hasHeading: boolean;
  hasRequirement: boolean;
};

const HEADING_RE = /^#{1,6}\s+\S/m;
/** Bullet or numbered list item with non-whitespace body. */
const REQUIREMENT_RE = /^\s*(?:[-*+]|\d+\.)\s+\S/m;

/** Presence-only: heading + ≥1 requirement list item. */
export function validateSddPresenceDoc(markdown: string): SddDocValidation {
  const text = markdown.replace(/^\uFEFF/, "");
  if (text.trim().length === 0) {
    return {
      ok: false,
      missing: false,
      empty: true,
      hasHeading: false,
      hasRequirement: false,
    };
  }
  const hasHeading = HEADING_RE.test(text);
  const hasRequirement = REQUIREMENT_RE.test(text);
  return {
    ok: hasHeading && hasRequirement,
    missing: false,
    empty: false,
    hasHeading,
    hasRequirement,
  };
}

export function resolveSddPresencePaths(config: ReturnType<typeof loadConfig>): {
  securityPath: string;
  observabilityPath: string;
} {
  const sdd = getSddOptions(config);
  return {
    securityPath: sdd.securityPath ?? DEFAULT_SECURITY_PATH,
    observabilityPath: sdd.observabilityPath ?? DEFAULT_OBSERVABILITY_PATH,
  };
}

export type SddPresenceEvalInput = {
  sddActive: boolean;
  securityRel: string;
  observabilityRel: string;
  securityContent: string | undefined;
  observabilityContent: string | undefined;
};

function findingsForDoc(
  kind: SddDocKind,
  rel: string,
  content: string | undefined,
): SddPresenceFinding[] {
  if (content === undefined) {
    return [
      {
        id: "D15",
        severity: "fail",
        message: `D15 sdd-presence: missing ${kind} doc at ${rel}.`,
      },
    ];
  }
  const v = validateSddPresenceDoc(content);
  if (v.ok) {
    return [
      {
        id: "D15",
        severity: "info",
        message: `D15 sdd-presence: ${rel} present (heading + ≥1 requirement).`,
      },
    ];
  }
  const reasons: string[] = [];
  if (v.empty) {
    reasons.push("file is empty");
  }
  if (!v.hasHeading) {
    reasons.push("needs a markdown heading");
  }
  if (!v.hasRequirement) {
    reasons.push("needs ≥1 requirement list item (- / * / 1.)");
  }
  return [
    {
      id: "D15",
      severity: "fail",
      message: `D15 sdd-presence: ${rel} failed — ${reasons.join("; ")}.`,
    },
  ];
}

export function evaluateSddPresence(input: SddPresenceEvalInput): SddPresenceFinding[] {
  if (!input.sddActive) {
    return [
      {
        id: "D15",
        severity: "info",
        message: "D15 sdd-presence: sdd is false / no SDD; gate skipped.",
      },
    ];
  }
  return [
    ...findingsForDoc("Security", input.securityRel, input.securityContent),
    ...findingsForDoc("Observability", input.observabilityRel, input.observabilityContent),
  ];
}

function readIfExists(cwd: string, rel: string): string | undefined {
  const full = resolve(cwd, rel);
  if (!existsSync(full)) {
    return undefined;
  }
  return readFileSync(full, "utf8");
}

export function runSddPresence(cwd = process.cwd()): {
  ok: boolean;
  findings: SddPresenceFinding[];
} {
  const config = loadConfig(cwd);
  const sddActive = isSddActive(config);
  const paths = resolveSddPresencePaths(config);
  const findings = evaluateSddPresence({
    sddActive,
    securityRel: paths.securityPath,
    observabilityRel: paths.observabilityPath,
    securityContent: sddActive ? readIfExists(cwd, paths.securityPath) : undefined,
    observabilityContent: sddActive ? readIfExists(cwd, paths.observabilityPath) : undefined,
  });
  const ok = findings.every((f) => f.severity !== "fail");
  writeFileSync(
    resolve(cwd, "sdd-presence-report.json"),
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

export function printSddPresence(result: { ok: boolean; findings: SddPresenceFinding[] }): void {
  console.info(`sdd-presence — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : finding.severity === "warn" ? "!" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("sdd-presence failed.");
    process.exitCode = 1;
    return;
  }
  console.info("sdd-presence passed.");
}

if (isDirectRun()) {
  printSddPresence(runSddPresence());
}
