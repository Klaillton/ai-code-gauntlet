import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { includeGitBranchDivergence, loadConfig } from "./inventory.js";

export type HolesFinding = {
  id: "D12" | "holes-review";
  severity: "fail" | "warn" | "info";
  message: string;
};

export const DEFAULT_IMPLEMENTATION_GLOBS = ["src/**"] as const;
export const DEFAULT_ARTIFACT_GLOB = "docs/holes-review/**/*.md";
export const REQUIRED_HOLES_SECTIONS = [
  "Ambiguities",
  "Contradictions",
  "Missing AC",
  "Unhappy/edge",
] as const;

type HolesConfig = {
  implementationGlobs?: string[];
  artifactGlob?: string;
  approved?: boolean;
};

type ConfigWithHoles = ReturnType<typeof loadConfig> & {
  allowHolesReviewSkip?: boolean;
  holesReview?: HolesConfig;
};

function posixRel(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function prBaseDiffs(cwd: string): string[] {
  const base = process.env.GITHUB_BASE_REF;
  if (!base) {
    return [];
  }
  return [
    ...(gitLines(cwd, ["diff", "--name-only", `origin/${base}...HEAD`]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", `${base}...HEAD`]) ?? []),
  ];
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

/** Minimal glob matcher for implementation and holes-review artifact globs. */
export function matchGlob(rel: string, glob: string): boolean {
  const normalized = rel.split(sep).join("/");
  const pattern = glob.split(sep).join("/");
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3).replace(/\/$/, "");
    return normalized === prefix || normalized.startsWith(prefix + "/");
  }
  if (pattern.includes("**")) {
    const [head, tail] = pattern.split("**");
    const prefix = (head ?? "").replace(/\/$/, "");
    const suffix = (tail ?? "").replace(/^\//, "");
    const headOk =
      prefix.length === 0 || normalized.startsWith(prefix + "/") || normalized === prefix;
    let tailOk = suffix.length === 0;
    if (!tailOk && suffix.startsWith("*.")) {
      tailOk = normalized.endsWith(suffix.slice(1));
    } else if (!tailOk) {
      tailOk = normalized.endsWith(suffix) || normalized.includes("/" + suffix);
    }
    return headOk && tailOk;
  }
  return normalized === pattern || normalized.endsWith("/" + pattern);
}

export function isImplementationPath(
  appRel: string,
  globs: readonly string[] = DEFAULT_IMPLEMENTATION_GLOBS,
): boolean {
  return globs.some((glob) => matchGlob(appRel, glob));
}

export function isHolesReviewArtifact(
  appRel: string,
  artifactGlob = DEFAULT_ARTIFACT_GLOB,
): boolean {
  return matchGlob(appRel, artifactGlob);
}

/** Grants: env, committed config, or CI label — not a working-tree allow file. */
export function holesReviewAllowed(
  cwd: string,
  allowSkip: boolean,
): { allowed: boolean; reason: string } {
  if (process.env.HOLES_REVIEW_APPROVED === "1") {
    return { allowed: true, reason: "HOLES_REVIEW_APPROVED=1" };
  }
  if (allowSkip) {
    return { allowed: true, reason: "gauntlet.config.json allowHolesReviewSkip=true" };
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8")) as {
        pull_request?: { labels?: { name?: string }[] };
      };
      const labels = event.pull_request?.labels ?? [];
      if (labels.some((label) => label.name === "holes-approved")) {
        return { allowed: true, reason: "GitHub label holes-approved" };
      }
    } catch {
      // fall through
    }
  }
  return { allowed: false, reason: "no human holes-review grant" };
}

function normalizeHeaderTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Parse markdown ##/# sections. Returns map of title → body (trimmed).
 */
export function parseMarkdownSections(markdown: string): Map<string, string> {
  const lines = markdown.split(/\r?\n/);
  const sections = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      current = normalizeHeaderTitle(heading[1] ?? "");
      if (!sections.has(current)) {
        sections.set(current, []);
      }
      continue;
    }
    if (current) {
      sections.get(current)!.push(line);
    }
  }
  const out = new Map<string, string>();
  for (const [title, bodyLines] of sections) {
    out.set(title, bodyLines.join("\n").trim());
  }
  return out;
}

export type ArtifactValidation = {
  ok: boolean;
  missingSections: string[];
  emptySections: string[];
};

/** Headers present with non-empty bodies for each required section. */
export function validateHolesReviewArtifact(
  markdown: string,
  required: readonly string[] = REQUIRED_HOLES_SECTIONS,
): ArtifactValidation {
  const sections = parseMarkdownSections(markdown);
  const missingSections: string[] = [];
  const emptySections: string[] = [];
  for (const name of required) {
    const body = sections.get(name);
    if (body === undefined) {
      missingSections.push(name);
      continue;
    }
    if (body.length === 0) {
      emptySections.push(name);
    }
  }
  return {
    ok: missingSections.length === 0 && emptySections.length === 0,
    missingSections,
    emptySections,
  };
}

export type HolesReviewEvalInput = {
  appRelChanged: string[];
  grant: { allowed: boolean; reason: string };
  artifacts: { rel: string; content: string }[];
  implementationGlobs?: readonly string[];
  artifactGlob?: string;
};

/** Pure D12 rules (no git). */
export function evaluateHolesReview(input: HolesReviewEvalInput): HolesFinding[] {
  const implGlobs = input.implementationGlobs ?? DEFAULT_IMPLEMENTATION_GLOBS;
  const artifactGlob = input.artifactGlob ?? DEFAULT_ARTIFACT_GLOB;
  const implChanges = input.appRelChanged.filter((rel) => isImplementationPath(rel, implGlobs));
  const findings: HolesFinding[] = [];

  if (implChanges.length === 0) {
    findings.push({
      id: "D12",
      severity: "info",
      message: "D12 holes-review: no implementation paths in the git diff; review not required.",
    });
    return findings;
  }

  if (input.grant.allowed) {
    findings.push({
      id: "D12",
      severity: "info",
      message: `D12 holes-review: skipped via grant (${input.grant.reason}) for ${implChanges.join(", ")}`,
    });
    return findings;
  }

  const artifactsInDiff = input.appRelChanged.filter((rel) =>
    isHolesReviewArtifact(rel, artifactGlob),
  );
  if (artifactsInDiff.length === 0) {
    findings.push({
      id: "D12",
      severity: "fail",
      message:
        `D12 holes-review: implementation changed (${implChanges.join(", ")}) without ` +
        `docs/holes-review/**/*.md in the same diff and without a human grant ` +
        `(HOLES_REVIEW_APPROVED=1, allowHolesReviewSkip: true, or label holes-approved).`,
    });
    return findings;
  }

  const loaded = input.artifacts.filter((a) => artifactsInDiff.includes(a.rel));
  if (loaded.length === 0) {
    findings.push({
      id: "D12",
      severity: "fail",
      message: `D12 holes-review: artifact path(s) in diff but unreadable: ${artifactsInDiff.join(", ")}`,
    });
    return findings;
  }

  let anyOk = false;
  for (const art of loaded) {
    const validation = validateHolesReviewArtifact(art.content);
    if (validation.ok) {
      anyOk = true;
      findings.push({
        id: "D12",
        severity: "info",
        message: `D12 holes-review: accepted artifact ${art.rel}`,
      });
      continue;
    }
    const parts: string[] = [];
    if (validation.missingSections.length > 0) {
      parts.push(`missing sections: ${validation.missingSections.join(", ")}`);
    }
    if (validation.emptySections.length > 0) {
      parts.push(`empty (headers-only) sections: ${validation.emptySections.join(", ")}`);
    }
    findings.push({
      id: "D12",
      severity: "fail",
      message: `D12 holes-review: ${art.rel} failed — ${parts.join("; ")}. Each of ${REQUIRED_HOLES_SECTIONS.join(", ")} must have non-empty body text.`,
    });
  }

  if (!anyOk) {
    findings.push({
      id: "D12",
      severity: "fail",
      message:
        "D12 holes-review: no valid holes-review artifact in the same diff as implementation changes.",
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

export function runHolesReview(cwd = process.cwd()): {
  ok: boolean;
  findings: HolesFinding[];
} {
  const config = loadConfig(cwd) as ConfigWithHoles;
  const holes = config.holesReview ?? {};
  const implGlobs = holes.implementationGlobs ?? [...DEFAULT_IMPLEMENTATION_GLOBS];
  const artifactGlob = holes.artifactGlob ?? DEFAULT_ARTIFACT_GLOB;
  const allowSkip = config.allowHolesReviewSkip === true || holes.approved === true;
  const grant = holesReviewAllowed(cwd, allowSkip);
  const findings: HolesFinding[] = [];

  const root = repoRoot(cwd);
  if (!root) {
    findings.push({
      id: "D12",
      severity: "fail",
      message: "holes-review: git required for this gate (rev-parse failed or not a git checkout).",
    });
    writeReport(cwd, false, findings);
    return { ok: false, findings };
  }

  const prefix = posixRel(root, cwd);
  const changed = new Set<string>([
    ...(gitLines(cwd, ["diff", "--name-only", "HEAD"]) ?? []),
    ...(gitLines(cwd, ["diff", "--name-only", "--cached"]) ?? []),
    ...(includeGitBranchDivergence()
      ? [
          ...(gitLines(cwd, ["diff", "--name-only", "origin/main...HEAD"]) ?? []),
          ...(gitLines(cwd, ["diff", "--name-only", "main...HEAD"]) ?? []),
          ...prBaseDiffs(cwd),
        ]
      : []),
  ]);

  const appRelChanged = [...changed]
    .map((file) => toAppRel(file, prefix))
    .filter((rel) => {
      // When running in a nested app, ignore sibling package paths.
      if (prefix.length > 0) {
        const repoRel = [...changed].find((c) => toAppRel(c, prefix) === rel) ?? rel;
        const full = repoRel.split(sep).join("/");
        return full.startsWith(prefix + "/") || !full.includes("/");
      }
      return true;
    });

  // Prefer only files under this app prefix when nested in a kit repo.
  const scopedAppRels =
    prefix.length === 0
      ? appRelChanged
      : [...changed]
          .map((file) => file.split(sep).join("/"))
          .filter((file) => file === prefix || file.startsWith(prefix + "/"))
          .map((file) => toAppRel(file, prefix));

  const artifacts: { rel: string; content: string }[] = [];
  for (const rel of scopedAppRels) {
    if (!isHolesReviewArtifact(rel, artifactGlob)) {
      continue;
    }
    const full = resolve(cwd, rel);
    if (!existsSync(full)) {
      continue;
    }
    artifacts.push({ rel, content: readFileSync(full, "utf8") });
  }

  findings.push(
    ...evaluateHolesReview({
      appRelChanged: scopedAppRels,
      grant,
      artifacts,
      implementationGlobs: implGlobs,
      artifactGlob,
    }),
  );

  const ok = findings.every((f) => f.severity !== "fail");
  writeReport(cwd, ok, findings);
  return { ok, findings };
}

function writeReport(cwd: string, ok: boolean, findings: HolesFinding[]): void {
  writeFileSync(
    resolve(cwd, "holes-review-report.json"),
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

function main(): void {
  const result = runHolesReview();
  console.info(`holes-review — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : finding.severity === "warn" ? "!" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("holes-review failed.");
    process.exitCode = 1;
    return;
  }
  console.info("holes-review passed.");
}

if (isDirectRun()) {
  main();
}
