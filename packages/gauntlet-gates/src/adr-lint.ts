import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { includeGitBranchDivergence, loadConfig } from "./inventory.js";
import { matchGlob, parseMarkdownSections } from "./holes-review.js";

export type AdrFinding = {
  id: "D14" | "adr-lint";
  severity: "fail" | "warn" | "info";
  message: string;
};

export const DEFAULT_ADR_GLOB = "docs/adr/**/*.md";

export const REQUIRED_ADR_SECTIONS = [
  "Context",
  "Decision",
  "Consequences",
  "Discarded",
  "Status",
] as const;

type AdrLintConfig = {
  glob?: string;
};

type ConfigWithAdr = ReturnType<typeof loadConfig> & {
  adrLint?: AdrLintConfig;
};

export type ChangedAdrFile = {
  /** Path relative to app/cwd (posix). */
  rel: string;
  /** git name-status: A | M | D | R… */
  status: string;
  /** File body when status is not delete. */
  content?: string;
};

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function gitLines(cwd: string, args: string[]): string[] | undefined {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return undefined;
  }
}

function repoRoot(cwd: string): string | undefined {
  return gitLines(cwd, ["rev-parse", "--show-toplevel"])?.[0];
}

function prBaseNameStatus(cwd: string): string[] {
  const base = process.env.GITHUB_BASE_REF;
  if (!base) {
    return [];
  }
  return [
    ...(gitLines(cwd, ["diff", "--name-status", `origin/${base}...HEAD`]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-status", `${base}...HEAD`]) ?? []),
  ];
}

export function isAdrPath(rel: string, glob = DEFAULT_ADR_GLOB): boolean {
  return matchGlob(rel, glob);
}

/** TEMPLATE.md / README.md are scaffolding — body not linted; deletions still fail. */
export function isAdrScaffoldPath(rel: string): boolean {
  const base = basename(rel).toLowerCase();
  return base === "template.md" || base === "readme.md";
}

/** Extract Status section body, or fall back to `- **Status:**` metadata. */
export function extractStatusText(markdown: string): string | undefined {
  const sections = parseMarkdownSections(markdown);
  const fromHeading = sections.get("Status");
  if (fromHeading !== undefined) {
    return fromHeading;
  }
  const meta = markdown.match(/^\s*[-*]\s*\*\*Status:\*\*\s*(.+)$/im);
  return meta?.[1]?.trim();
}

export type ParsedAdrStatus =
  | { kind: "accepted"; date: string }
  | { kind: "superseded"; ref: string; date: string }
  | { kind: "invalid"; reason: string };

const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;
const SUPERSEDED_RE = /\bSuperseded\s+by\s+(ADR-[A-Za-z0-9][\w.-]*)/i;
const ACCEPTED_RE = /\bAccepted\b/i;

/** Parse Status body: Accepted|Superseded by ADR-… plus mandatory ISO date. */
export function parseAdrStatus(statusText: string): ParsedAdrStatus {
  const text = statusText.replace(/\s+/g, " ").trim();
  if (text.length === 0) {
    return { kind: "invalid", reason: "Status is empty" };
  }
  const date = DATE_RE.exec(text)?.[1];
  if (!date) {
    return {
      kind: "invalid",
      reason: "Status must include an ISO date (YYYY-MM-DD)",
    };
  }
  const superseded = SUPERSEDED_RE.exec(text);
  if (superseded?.[1]) {
    return { kind: "superseded", ref: superseded[1], date };
  }
  if (ACCEPTED_RE.test(text)) {
    return { kind: "accepted", date };
  }
  return {
    kind: "invalid",
    reason: "Status must be `Accepted` or `Superseded by ADR-XXXX` (with YYYY-MM-DD date)",
  };
}

export type AdrDocValidation = {
  ok: boolean;
  missingSections: string[];
  emptySections: string[];
  status: ParsedAdrStatus | undefined;
};

/** Required sections present with non-empty bodies; Status shape checked. */
export function validateAdrDocument(markdown: string): AdrDocValidation {
  const sections = parseMarkdownSections(markdown);
  const missingSections: string[] = [];
  const emptySections: string[] = [];
  for (const name of REQUIRED_ADR_SECTIONS) {
    if (name === "Status") {
      // Status may be a ## heading or metadata line — handled below.
      continue;
    }
    const body = sections.get(name);
    if (body === undefined) {
      missingSections.push(name);
      continue;
    }
    if (body.length === 0) {
      emptySections.push(name);
    }
  }

  const statusText = extractStatusText(markdown);
  let status: ParsedAdrStatus | undefined;
  if (statusText === undefined) {
    missingSections.push("Status");
  } else if (statusText.length === 0) {
    emptySections.push("Status");
  } else {
    status = parseAdrStatus(statusText);
  }

  const statusOk = status !== undefined && status.kind !== "invalid";
  return {
    ok: missingSections.length === 0 && emptySections.length === 0 && statusOk,
    missingSections,
    emptySections,
    status,
  };
}

/** True if `ref` (e.g. ADR-gates-source) matches an existing ADR path basename. */
export function adrRefExists(ref: string, adrPaths: readonly string[]): boolean {
  const needle = ref.toLowerCase();
  return adrPaths.some((p) => {
    const base = basename(p).toLowerCase().replace(/\.md$/i, "");
    if (base === "template" || base === "readme") {
      return false;
    }
    return base === needle || base.startsWith(`${needle}-`) || base.includes(needle);
  });
}

/** Walk markdown files under docs/ that look like ADRs (docs/adr tree and docs/ADR-*). */
export function listAdrPaths(cwd: string, adrGlob = DEFAULT_ADR_GLOB): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) {
      return;
    }
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.toLowerCase().endsWith(".md")) {
        continue;
      }
      const rel = posixRel(cwd, full);
      if (isAdrPath(rel, adrGlob) || /^docs\/ADR-/i.test(rel)) {
        out.push(rel);
      }
    }
  };
  walk(resolve(cwd, "docs"));
  return out.sort((a, b) => a.localeCompare(b));
}

export type AdrLintEvalInput = {
  changed: ChangedAdrFile[];
  /** All ADR paths currently in the tree (for supersede target checks). */
  existingAdrPaths: string[];
  adrGlob?: string;
};

/**
 * D14 — ADR template light gate (diff-based).
 * Skip when the PR/diff does not touch docs/adr/**.
 * Deleting an ADR fails (mark Superseded only).
 */
export function evaluateAdrLint(input: AdrLintEvalInput): AdrFinding[] {
  const glob = input.adrGlob ?? DEFAULT_ADR_GLOB;
  const findings: AdrFinding[] = [];
  const touched = input.changed.filter((f) => isAdrPath(f.rel, glob));

  if (touched.length === 0) {
    findings.push({
      id: "D14",
      severity: "info",
      message: "D14 adr-lint: no docs/adr/** paths in the git diff; gate skipped.",
    });
    return findings;
  }

  for (const file of touched) {
    const statusCode = file.status.charAt(0).toUpperCase();
    if (statusCode === "D") {
      findings.push({
        id: "D14",
        severity: "fail",
        message:
          `D14 adr-lint: deleted ${file.rel} — do not delete ADRs; ` +
          `set Status to \`Superseded by ADR-XXXX\` (with date) instead.`,
      });
      continue;
    }

    if (isAdrScaffoldPath(file.rel)) {
      findings.push({
        id: "D14",
        severity: "info",
        message: `D14 adr-lint: scaffold ${file.rel} touched (body not linted).`,
      });
      continue;
    }

    const content = file.content ?? "";
    const v = validateAdrDocument(content);
    if (!v.ok) {
      const parts: string[] = [];
      if (v.missingSections.length > 0) {
        parts.push(`missing sections: ${v.missingSections.join(", ")}`);
      }
      if (v.emptySections.length > 0) {
        parts.push(`empty sections: ${v.emptySections.join(", ")}`);
      }
      if (v.status?.kind === "invalid") {
        parts.push(v.status.reason);
      }
      findings.push({
        id: "D14",
        severity: "fail",
        message: `D14 adr-lint: ${file.rel} failed — ${parts.join("; ")}.`,
      });
      continue;
    }

    if (v.status?.kind === "superseded") {
      // Prefer on-disk paths; deleted targets won't be listed.
      if (!adrRefExists(v.status.ref, input.existingAdrPaths)) {
        findings.push({
          id: "D14",
          severity: "fail",
          message:
            `D14 adr-lint: ${file.rel} Status supersedes ${v.status.ref}, ` +
            `but that ADR was not found under docs/adr/** (or docs/ADR-*).`,
        });
        continue;
      }
    }

    findings.push({
      id: "D14",
      severity: "info",
      message: `D14 adr-lint: accepted ${file.rel}`,
    });
  }

  return findings;
}

function toAppRel(repoRel: string, prefix: string): string {
  const normalized = repoRel.split(sep).join("/");
  if (prefix.length > 0 && normalized.startsWith(prefix + "/")) {
    return normalized.slice(prefix.length + 1);
  }
  return normalized;
}

function parseNameStatusLine(line: string): { status: string; path: string } | undefined {
  // M\tpath | A\tpath | D\tpath | R100\told\tnew
  const parts = line.split(/\t/);
  if (parts.length < 2) {
    return undefined;
  }
  const status = parts[0] ?? "";
  if (status.startsWith("R") || status.startsWith("C")) {
    const dest = parts[2] ?? parts[1];
    if (!dest) {
      return undefined;
    }
    return { status, path: dest };
  }
  const path = parts[1];
  if (!path) {
    return undefined;
  }
  return { status, path };
}

function collectNameStatus(cwd: string): { status: string; path: string }[] {
  const lines = new Set<string>([
    ...(gitLines(cwd, ["diff", "--name-status", "HEAD"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-status", "--cached"]) ?? []),
    ...(includeGitBranchDivergence()
      ? [
          ...(gitLines(cwd, ["diff", "--name-status", "origin/main...HEAD"]) ?? []),
          ...(gitLines(cwd, ["diff", "--name-status", "main...HEAD"]) ?? []),
          ...prBaseNameStatus(cwd),
        ]
      : []),
  ]);
  const out: { status: string; path: string }[] = [];
  for (const line of lines) {
    const parsed = parseNameStatusLine(line);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

export function runAdrLint(cwd = process.cwd()): {
  ok: boolean;
  findings: AdrFinding[];
} {
  const config = loadConfig(cwd) as ConfigWithAdr;
  const adrGlob = config.adrLint?.glob ?? DEFAULT_ADR_GLOB;
  const findings: AdrFinding[] = [];

  const root = repoRoot(cwd);
  if (!root) {
    findings.push({
      id: "D14",
      severity: "fail",
      message: "adr-lint: git required for this gate (rev-parse failed or not a git checkout).",
    });
    writeReport(cwd, false, findings);
    return { ok: false, findings };
  }

  const prefix = posixRel(root, cwd);
  const nameStatus = collectNameStatus(cwd);

  // Untracked (not ignored) ADRs — so local verify catches bad new files before commit.
  // `git ls-files --others` from a subdirectory is cwd-relative; prefix with show-prefix.
  const showPrefix = (gitLines(cwd, ["rev-parse", "--show-prefix"])?.[0] ?? "").replace(/\/+$/, "");
  for (const rel of gitLines(cwd, ["ls-files", "--others", "--exclude-standard"]) ?? []) {
    const local = rel.split(sep).join("/");
    const repoRel = showPrefix.length > 0 ? `${showPrefix}/${local}` : local;
    if (prefix.length > 0 && !(repoRel === prefix || repoRel.startsWith(prefix + "/"))) {
      continue;
    }
    const appRel = toAppRel(repoRel, prefix);
    if (!isAdrPath(appRel, adrGlob)) {
      continue;
    }
    nameStatus.push({ status: "A", path: repoRel });
  }

  const changed: ChangedAdrFile[] = [];
  const seen = new Set<string>();
  for (const entry of nameStatus) {
    const repoRel = entry.path.split(sep).join("/");
    if (prefix.length > 0 && !(repoRel === prefix || repoRel.startsWith(prefix + "/"))) {
      continue;
    }
    const rel = toAppRel(repoRel, prefix);
    if (!isAdrPath(rel, adrGlob)) {
      continue;
    }
    const dedupeKey = `${entry.status.charAt(0).toUpperCase()}:${rel}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const statusCode = entry.status.charAt(0).toUpperCase();
    if (statusCode === "D") {
      changed.push({ rel, status: entry.status });
      continue;
    }
    const full = resolve(cwd, rel);
    if (!existsSync(full)) {
      changed.push({ rel, status: entry.status, content: "" });
      continue;
    }
    changed.push({
      rel,
      status: entry.status,
      content: readFileSync(full, "utf8"),
    });
  }

  const existingAdrPaths = listAdrPaths(cwd, adrGlob);
  findings.push(
    ...evaluateAdrLint({
      changed,
      existingAdrPaths,
      adrGlob,
    }),
  );

  const ok = findings.every((f) => f.severity !== "fail");
  writeReport(cwd, ok, findings);
  return { ok, findings };
}

function writeReport(cwd: string, ok: boolean, findings: AdrFinding[]): void {
  writeFileSync(
    resolve(cwd, "adr-lint-report.json"),
    `${JSON.stringify({ ok, generatedAt: new Date().toISOString(), findings }, null, 2)}\n`,
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

export function printAdrLint(result: { ok: boolean; findings: AdrFinding[] }): void {
  console.info(`adr-lint — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : finding.severity === "warn" ? "!" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("adr-lint failed.");
    return;
  }
  console.info("adr-lint passed.");
}

if (isDirectRun()) {
  const result = runAdrLint();
  printAdrLint(result);
  process.exit(result.ok ? 0 : 1);
}
