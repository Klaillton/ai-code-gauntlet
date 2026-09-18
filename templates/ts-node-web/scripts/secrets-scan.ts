import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { loadConfig } from "./inventory.js";

export type SecretFinding = {
  id: "secrets-scan";
  severity: "fail" | "warn" | "info";
  path: string;
  rule: string;
  line?: number;
  message: string;
};

type ConfigWithSecrets = ReturnType<typeof loadConfig> & {
  secretsScan?: { allowPaths?: string[] };
};

const SKIP_DIRS = new Set([
  "node_modules",
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
  ".git",
  ".cucumber-js",
  ".idea",
  ".vscode",
]);

const BINARY_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mp4",
  "zip",
  "gz",
  "7z",
  "pdf",
  "p12",
  "pfx",
  "sqlite",
  "exe",
  "dll",
  "so",
  "dylib",
]);

const PRIVATE_KEY_NAMES = new Set(["id_rsa", "id_ed25519", "id_dsa", "id_ecdsa"]);

/** Path / PEM findings are never grantable. Token-shape false positives may be waived. */
const NEVER_WAIVE = new Set(["forbidden-path", "private-key", "private-key-file"]);

const MAX_BYTES = 1_000_000;

const PRIVATE_KEY_RE =
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/;

type TokenRule = { rule: string; re: RegExp; message: string };

const TOKEN_RULES: TokenRule[] = [
  { rule: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g, message: "AWS access key id" },
  {
    rule: "github-pat",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    message: "GitHub token",
  },
  {
    rule: "github-fine-grained-pat",
    re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    message: "GitHub fine-grained PAT",
  },
  { rule: "gitlab-pat", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, message: "GitLab PAT" },
  { rule: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, message: "Slack token" },
  {
    rule: "stripe-live",
    re: /\bsk_live_[A-Za-z0-9]{16,}\b/g,
    message: "Stripe live secret key",
  },
  { rule: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, message: "Google API key" },
  { rule: "openai-key", re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, message: "OpenAI project key" },
  { rule: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, message: "Anthropic API key" },
  { rule: "npm-token", re: /\bnpm_[A-Za-z0-9]{20,}\b/g, message: "npm access token" },
  {
    rule: "slack-webhook",
    re: /hooks\.slack\.com\/services\/T[A-Za-z0-9_]+\/B[A-Za-z0-9_]+\/[A-Za-z0-9_]+/g,
    message: "Slack incoming webhook",
  },
  {
    rule: "azure-access-key",
    re: /(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/=]{22,}/g,
    message: "Azure AccountKey or SharedAccessKey",
  },
];

const ASSIGN_QUOTED_RE =
  /\b(password|passwd|secret|token|api[_-]?key|client[_-]?secret|auth[_-]?token|private[_-]?key|access[_-]?key|refresh[_-]?token)\b\s*[:=]\s*(['"`])([^'"`]{8,})\2/gi;

const ASSIGN_BARE_RE =
  /\b(password|passwd|secret|token|api[_-]?key|client[_-]?secret|auth[_-]?token|private[_-]?key|access[_-]?key|refresh[_-]?token)\b\s*[:=]\s*(?!['"`$])([^\s#]{8,})/gi;

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CPF_FORMAT_RE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;
const CNPJ_FORMAT_RE = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
const SSN_RE = /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0{4})\d{4}\b/g;
const PHONE_RE =
  /(?:\+55\s?\d{2}\s?\d{4,5}-?\d{4}|\(\d{2}\)\s*\d{4,5}-?\d{4}|\+1[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g;

const PLACEHOLDER_NEEDLES = [
  "changeme",
  "your-",
  "xxx",
  "todo",
  "example",
  "redacted",
  "dummy",
  "fake",
  "placeholder",
  "sample",
  "not-a-real",
  "replace-me",
  "insert-",
  "secret-here",
  "password-here",
  "lorem",
  "test-key",
  "test_key",
  "****",
  "n/a",
  "none",
  "null",
  "undefined",
];

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

export function isEnvExampleName(name: string): boolean {
  return (
    name === ".env.example" ||
    name === ".env.sample" ||
    name === ".env.template" ||
    name.endsWith(".env.example") ||
    name.endsWith(".env.sample") ||
    name.endsWith(".env.template")
  );
}

export function isForbiddenEnvPath(rel: string): boolean {
  const base = basename(rel.split(sep).join("/"));
  if (isEnvExampleName(base)) {
    return false;
  }
  if (base === ".env" || base === ".envrc" || base === ".netrc" || base === "_netrc") {
    return true;
  }
  if (base.startsWith(".env.")) {
    return true;
  }
  return base.endsWith(".env");
}

export function isPrivateKeyFilename(rel: string): boolean {
  const base = basename(rel.split(sep).join("/"));
  if (base.endsWith(".pub")) {
    return false;
  }
  return PRIVATE_KEY_NAMES.has(base);
}

export function isSkippedRel(rel: string): boolean {
  const normalized = rel.split(sep).join("/");
  const base = basename(normalized);
  if (base === "package-lock.json" || base === "gauntlet-report.json") {
    return true;
  }
  if (base.endsWith("-report.json") || base.endsWith(".map")) {
    return true;
  }
  const ext = base.includes(".") ? (base.split(".").pop() ?? "").toLowerCase() : "";
  if (BINARY_EXT.has(ext)) {
    return true;
  }
  const parts = normalized.split("/");
  return parts.some((part) => SKIP_DIRS.has(part));
}

export function isPiiSurface(rel: string): boolean {
  const normalized = rel.split(sep).join("/");
  return (
    normalized === "features" ||
    normalized.startsWith("features/") ||
    normalized.startsWith("e2e/") ||
    normalized.startsWith("fixtures/") ||
    normalized.includes("/fixtures/")
  );
}

export function isPlaceholderValue(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) {
    return true;
  }
  const lower = v.toLowerCase();
  if (lower.includes("process.env") || v.includes("${") || (v.includes("<") && v.includes(">"))) {
    return true;
  }
  if (/^\$[A-Z_][A-Z0-9_]*$/.test(v) || /^%[A-Z0-9_]+%$/.test(v)) {
    return true;
  }
  if (/^(true|false|null|undefined|\d+)$/i.test(v)) {
    return true;
  }
  return PLACEHOLDER_NEEDLES.some((needle) => lower.includes(needle));
}

export function isSyntheticEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return (
    lower.endsWith("@example.com") ||
    lower.endsWith("@example.org") ||
    lower.endsWith("@example.net") ||
    /@(localhost|test)$/i.test(lower)
  );
}

export function isSyntheticPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.includes("555") || digits.startsWith("1555");
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) {
    return false;
  }
  const check = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) {
      sum += Number(digits[i]) * (len + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

export function isValidCnpj(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) {
    return false;
  }
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const check = (weights: number[]): number => {
    const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(weights1) === Number(digits[12]) && check(weights2) === Number(digits[13]);
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

function matchIndices(re: RegExp, text: string): { index: number }[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  const out: { index: number }[] = [];
  for (const match of text.matchAll(global)) {
    if (match.index !== undefined) {
      out.push({ index: match.index });
    }
  }
  return out;
}

function collectMatches(re: RegExp, text: string): string[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return [...text.matchAll(new RegExp(re.source, flags))].map((match) => match[0] ?? "");
}

export function scanContent(text: string, rel: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const push = (rule: string, message: string, index: number): void => {
    findings.push({
      id: "secrets-scan",
      severity: "fail",
      path: rel,
      rule,
      line: lineNumberAt(text, index),
      message: `${message} in ${rel}:${lineNumberAt(text, index)}`,
    });
  };

  if (PRIVATE_KEY_RE.test(text)) {
    const index = text.search(PRIVATE_KEY_RE);
    push("private-key", "Private key PEM block", index < 0 ? 0 : index);
  }

  for (const token of TOKEN_RULES) {
    for (const hit of matchIndices(token.re, text)) {
      push(token.rule, token.message, hit.index);
    }
  }

  for (const match of text.matchAll(new RegExp(ASSIGN_QUOTED_RE.source, "gi"))) {
    const value = match[3] ?? "";
    if (isPlaceholderValue(value) || match.index === undefined) {
      continue;
    }
    push("hardcoded-secret", "Hardcoded secret assignment", match.index);
  }

  for (const match of text.matchAll(new RegExp(ASSIGN_BARE_RE.source, "gi"))) {
    const value = match[2] ?? "";
    if (isPlaceholderValue(value) || match.index === undefined) {
      continue;
    }
    push("hardcoded-secret", "Hardcoded secret assignment", match.index);
  }

  if (isPiiSurface(rel)) {
    const emails = collectMatches(EMAIL_RE, text).filter((email) => !isSyntheticEmail(email));
    const phones = collectMatches(PHONE_RE, text).filter((phone) => !isSyntheticPhone(phone));
    const cpfs = collectMatches(CPF_FORMAT_RE, text);
    const cnpjs = collectMatches(CNPJ_FORMAT_RE, text);
    if ((cpfs.length > 0 || cnpjs.length > 0) && phones.length > 0 && emails.length > 0) {
      push("pii-bundle", "PII dump (document + phone + email)", 0);
    }
    for (const cpf of cpfs) {
      const digits = cpf.replace(/\D/g, "");
      if (isValidCpf(digits)) {
        const index = text.indexOf(cpf);
        push("pii-cpf", "Valid CPF in fixture/spec surface", index < 0 ? 0 : index);
      }
    }
    for (const cnpj of cnpjs) {
      const digits = cnpj.replace(/\D/g, "");
      if (isValidCnpj(digits)) {
        const index = text.indexOf(cnpj);
        push("pii-cnpj", "Valid CNPJ in fixture/spec surface", index < 0 ? 0 : index);
      }
    }
    for (const hit of matchIndices(SSN_RE, text)) {
      push("pii-ssn", "SSN-like identifier in fixture/spec surface", hit.index);
    }
  }

  return findings;
}

function walkRels(dir: string, root: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkRels(full, root));
      continue;
    }
    out.push(posixRel(root, full));
  }
  return out;
}

function gitScanRels(cwd: string): string[] | undefined {
  const tracked = gitLines(cwd, ["ls-files"]);
  const others = gitLines(cwd, ["ls-files", "--others", "--exclude-standard"]);
  if (tracked === undefined && others === undefined) {
    return undefined;
  }
  const rels = new Set<string>([...(tracked ?? []), ...(others ?? [])]);
  return [...rels].map((rel) => rel.split(sep).join("/"));
}

export function collectScanRels(cwd: string): { rels: string[]; git: boolean } {
  const fromGit = gitScanRels(cwd);
  if (fromGit) {
    return { rels: fromGit.filter((rel) => !isSkippedRel(rel)), git: true };
  }
  const walked = walkRels(cwd, cwd).filter((rel) => !isSkippedRel(rel));
  return { rels: walked, git: false };
}

function loadAllowPaths(cwd: string, config: ConfigWithSecrets): Set<string> {
  const fromConfig = config.secretsScan?.allowPaths ?? [];
  const filePath = resolve(cwd, ".gauntlet/allow-secrets-paths");
  let fromFile: string[] = [];
  if (existsSync(filePath)) {
    fromFile = readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
  }
  return new Set(
    [...fromConfig, ...fromFile].map((rel) => rel.split(sep).join("/").replace(/^\.\//, "")),
  );
}

function isWaived(rel: string, rule: string, allow: Set<string>): boolean {
  if (NEVER_WAIVE.has(rule)) {
    return false;
  }
  return allow.has(rel);
}

function pathFindings(rel: string, git: boolean): SecretFinding[] {
  if (!git && (isForbiddenEnvPath(rel) || isPrivateKeyFilename(rel))) {
    return [];
  }
  if (isForbiddenEnvPath(rel)) {
    return [
      {
        id: "secrets-scan",
        severity: "fail",
        path: rel,
        rule: "forbidden-path",
        message: `Forbidden credential file ${rel} is tracked, staged, or untracked-not-ignored`,
      },
    ];
  }
  if (isPrivateKeyFilename(rel)) {
    return [
      {
        id: "secrets-scan",
        severity: "fail",
        path: rel,
        rule: "private-key-file",
        message: `Private key filename ${rel} is tracked, staged, or untracked-not-ignored`,
      },
    ];
  }
  return [];
}

function readText(cwd: string, rel: string): string | undefined {
  const full = resolve(cwd, rel);
  if (!existsSync(full)) {
    return undefined;
  }
  try {
    const st = statSync(full);
    if (!st.isFile() || st.size > MAX_BYTES) {
      return undefined;
    }
    const buf = readFileSync(full);
    if (buf.includes(0)) {
      return undefined;
    }
    return buf.toString("utf8");
  } catch {
    return undefined;
  }
}

function dedupe(findings: SecretFinding[]): SecretFinding[] {
  const seen = new Set<string>();
  const out: SecretFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.rule}|${finding.path}|${finding.line ?? 0}|${finding.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(finding);
  }
  return out;
}

export function runSecretsScan(cwd = process.cwd()): {
  ok: boolean;
  findings: SecretFinding[];
} {
  const config = loadConfig(cwd) as ConfigWithSecrets;
  const allow = loadAllowPaths(cwd, config);
  const { rels, git } = collectScanRels(cwd);
  const findings: SecretFinding[] = [];

  for (const rel of rels.sort((a, b) => a.localeCompare(b))) {
    for (const finding of pathFindings(rel, git)) {
      findings.push(finding);
    }
    if (isForbiddenEnvPath(rel) && git) {
      continue;
    }
    const text = readText(cwd, rel);
    if (text === undefined) {
      continue;
    }
    for (const finding of scanContent(text, rel)) {
      if (isWaived(rel, finding.rule, allow)) {
        continue;
      }
      findings.push(finding);
    }
  }

  const unique = dedupe(findings);
  const ok = unique.every((finding) => finding.severity !== "fail");
  if (ok) {
    unique.push({
      id: "secrets-scan",
      severity: "info",
      path: ".",
      rule: "clean",
      message: git
        ? "secrets-scan: no high-confidence secrets or PII dumps in tracked/staged/untracked-not-ignored files."
        : "secrets-scan: git unavailable; scanned the working tree (local .env / key filenames skipped).",
    });
  }
  writeReport(cwd, ok, unique);
  return { ok, findings: unique };
}

function writeReport(cwd: string, ok: boolean, findings: SecretFinding[]): void {
  writeFileSync(
    resolve(cwd, "secrets-scan-report.json"),
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
  const result = runSecretsScan();
  console.info(`secrets-scan — ${result.findings.length} finding(s)`);
  for (const finding of result.findings) {
    const mark = finding.severity === "fail" ? "x" : finding.severity === "warn" ? "!" : "i";
    const log = finding.severity === "fail" ? console.error : console.info;
    log(`  ${mark} [${finding.id}/${finding.severity}/${finding.rule}] ${finding.message}`);
  }
  if (!result.ok) {
    console.error("secrets-scan failed. Stop and ask a human. Do not add allowlist entries.");
    process.exitCode = 1;
    return;
  }
  console.info("secrets-scan passed.");
}

if (isDirectRun()) {
  main();
}
