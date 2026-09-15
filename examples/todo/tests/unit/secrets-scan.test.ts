import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  isForbiddenEnvPath,
  isPlaceholderValue,
  isPrivateKeyFilename,
  isPiiSurface,
  isSkippedRel,
  isValidCnpj,
  isValidCpf,
  runSecretsScan,
  scanContent,
} from "../../scripts/secrets-scan.js";

function awsKey(): string {
  return "AKIA" + "IOSFODNN7EXAMPLE";
}

function githubPat(): string {
  return "ghp_" + "A".repeat(36);
}

function stripeLive(): string {
  return "sk_live_" + "4".repeat(24);
}

function stripeTest(): string {
  return "sk_test_" + "4".repeat(24);
}

function pemBlock(): string {
  return "-----BEGIN " + "RSA PRIVATE KEY-----";
}

function googleKey(): string {
  return "AIza" + "a".repeat(35);
}

function envSecretLine(): string {
  return ["API_KEY", "=", "s3cretValueHere", "\n"].join("");
}

function quotedSecretAssign(): string {
  return ["const api_", 'key = "', "s3cretValueHere", '";'].join("");
}

function validCpfDigits(): string {
  const base = "390533447";
  for (let i = 0; i < 100; i += 1) {
    const digits = base + String(i).padStart(2, "0");
    if (isValidCpf(digits)) {
      return digits;
    }
  }
  throw new Error("could not build a valid CPF");
}

function formatCpf(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function writeTree(dir: string, files: Record<string, string>): void {
  writeFileSync(
    join(dir, "gauntlet.config.json"),
    `${JSON.stringify(
      {
        name: "secrets-fixture",
        gates: [{ id: "secrets-scan", command: "npm", args: ["run", "secrets-scan"] }],
      },
      null,
      2,
    )}\n`,
  );
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

function initGit(dir: string): void {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "dev@example.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "fixture"], { cwd: dir, stdio: "ignore" });
}

function fixtureDir(): string {
  const root = process.env.TEMP ?? process.env.TMP ?? process.env.TMPDIR ?? ".";
  const dir = join(root, `secrets-scan-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("path classifiers", () => {
  it("shouldTreatDotEnvAsForbiddenAndKeepExamples", () => {
    expect(isForbiddenEnvPath(".env")).toBe(true);
    expect(isForbiddenEnvPath(".env.local")).toBe(true);
    expect(isForbiddenEnvPath("config.env")).toBe(true);
    expect(isForbiddenEnvPath(".env.example")).toBe(false);
    expect(isForbiddenEnvPath("foo.env.example")).toBe(false);
    expect(isForbiddenEnvPath(".env.sample")).toBe(false);
  });

  it("shouldTreatPrivateKeyFilenamesWithoutPub", () => {
    expect(isPrivateKeyFilename("id_rsa")).toBe(true);
    expect(isPrivateKeyFilename("id_ed25519")).toBe(true);
    expect(isPrivateKeyFilename("id_rsa.pub")).toBe(false);
  });

  it("shouldSkipNoiseAndKeepSource", () => {
    expect(isSkippedRel("node_modules/pkg/index.js")).toBe(true);
    expect(isSkippedRel("package-lock.json")).toBe(true);
    expect(isSkippedRel("secrets-scan-report.json")).toBe(true);
    expect(isSkippedRel("src/server.ts")).toBe(false);
  });

  it("shouldLimitPiiToFixtureSurfaces", () => {
    expect(isPiiSurface("features/todos.feature")).toBe(true);
    expect(isPiiSurface("e2e/steps/todos.steps.ts")).toBe(true);
    expect(isPiiSurface("src/domain/todo.ts")).toBe(false);
    expect(isPiiSurface("tests/unit/secrets-scan.test.ts")).toBe(false);
  });
});

describe("scanContent", () => {
  it("shouldFailOnAwsAccessKeyAndPrivateKeyAndLiveStripe", () => {
    const aws = scanContent(`const k = "${awsKey()}";`, "src/a.ts");
    expect(aws.some((finding) => finding.rule === "aws-access-key")).toBe(true);

    const pem = scanContent(`${pemBlock()}\nMIIEowIBAAK`, "src/key.ts");
    expect(pem.some((finding) => finding.rule === "private-key")).toBe(true);

    const live = scanContent(`key=${stripeLive()}`, "src/pay.ts");
    expect(live.some((finding) => finding.rule === "stripe-live")).toBe(true);
  });

  it("shouldPassStripeTestKeysAndPlaceholderAssignments", () => {
    expect(scanContent(`key=${stripeTest()}`, "src/pay.ts")).toEqual([]);
    expect(scanContent(`apiKey: "your-api-key-here"`, "src/config.ts")).toEqual([]);
    expect(scanContent(`api_key = process.env.API_KEY`, "src/config.ts")).toEqual([]);
    expect(scanContent(`token: "\${TOKEN}"`, "src/config.ts")).toEqual([]);
    expect(scanContent(`API_KEY=your-key-here\n`, ".env.example")).toEqual([]);
  });

  it("shouldFailHardcodedQuotedSecretAndDetectGithubPat", () => {
    const hardcoded = scanContent(quotedSecretAssign(), "src/a.ts");
    expect(hardcoded.some((finding) => finding.rule === "hardcoded-secret")).toBe(true);

    const pat = scanContent(`auth=${githubPat()}`, "src/a.ts");
    expect(pat.some((finding) => finding.rule === "github-pat")).toBe(true);

    const google = scanContent(googleKey(), "src/a.ts");
    expect(google.some((finding) => finding.rule === "google-api-key")).toBe(true);
  });

  it("shouldFailPiiBundleAndValidCpfOnFeatureSurfaceOnly", () => {
    const cpf = formatCpf(validCpfDigits());
    const dump = [
      `Feature: leak`,
      `  Scenario: dump`,
      `    Given CPF ${cpf}`,
      `    And phone (11) 98765-4321`,
      `    And email joao.silva@gmail.com`,
    ].join("\n");
    const hits = scanContent(dump, "features/leak.feature");
    expect(hits.some((finding) => finding.rule === "pii-bundle")).toBe(true);
    expect(hits.some((finding) => finding.rule === "pii-cpf")).toBe(true);

    const inSrc = scanContent(dump, "src/domain/todo.ts");
    expect(inSrc.some((finding) => finding.rule.startsWith("pii-"))).toBe(false);
  });

  it("shouldIgnoreSyntheticExampleComEmailInPiiBundle", () => {
    const dump = [
      "Feature: synthetic",
      "  Scenario: ok",
      `    Given CPF ${formatCpf(validCpfDigits())}`,
      "    And phone +15550100",
      "    And email alice@example.com",
    ].join("\n");
    const hits = scanContent(dump, "features/ok.feature");
    expect(hits.some((finding) => finding.rule === "pii-bundle")).toBe(false);
  });

  it("shouldNotEchoSecretMaterialInMessages", () => {
    const hits = scanContent(`k=${awsKey()}`, "src/a.ts");
    for (const finding of hits) {
      expect(finding.message.includes(awsKey())).toBe(false);
    }
  });
});

describe("placeholders and documents", () => {
  it("shouldRecognizePlaceholderValues", () => {
    expect(isPlaceholderValue("your-key-here")).toBe(true);
    expect(isPlaceholderValue("REDACTED")).toBe(true);
    expect(isPlaceholderValue("${API_KEY}")).toBe(true);
    expect(isPlaceholderValue("s3cretValueHere")).toBe(false);
  });

  it("shouldValidateCpfAndRejectRepeatedDigits", () => {
    expect(isValidCpf(validCpfDigits())).toBe(true);
    expect(isValidCpf("00000000000")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });
});

describe("runSecretsScan", () => {
  it("shouldFailTrackedDotEnvAndPassGitignoredLocalEnv", () => {
    const ignored = fixtureDir();
    writeTree(ignored, {
      ".gitignore": ".env\n",
      ".env": envSecretLine(),
      "src/ok.ts": "export const x = 1;\n",
    });
    initGit(ignored);
    const local = runSecretsScan(ignored);
    expect(local.ok).toBe(true);

    const forced = fixtureDir();
    writeTree(forced, {
      ".gitignore": ".env\n",
      ".env": envSecretLine(),
      "src/ok.ts": "export const x = 1;\n",
    });
    initGit(forced);
    execFileSync("git", ["add", "-f", ".env"], { cwd: forced, stdio: "ignore" });
    const tracked = runSecretsScan(forced);
    expect(tracked.ok).toBe(false);
    expect(tracked.findings.some((finding) => finding.rule === "forbidden-path")).toBe(true);
  });

  it("shouldFailUntrackedSourceSecretAndPassEnvExample", () => {
    const dir = fixtureDir();
    writeTree(dir, {
      ".env.example": "API_KEY=your-key-here\n",
      "src/leak.ts": `export const k = "${awsKey()}";\n`,
    });
    initGit(dir);
    const result = runSecretsScan(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.rule === "aws-access-key")).toBe(true);
    expect(result.findings.some((finding) => finding.path === ".env.example")).toBe(false);
  });

  it("shouldNotWaivePrivateKeyOrDotEnvViaAllowPaths", () => {
    const dir = fixtureDir();
    writeTree(dir, {
      ".env": envSecretLine(),
      "src/key.ts": `${pemBlock()}\n`,
      "gauntlet.config.json": `${JSON.stringify(
        {
          name: "secrets-fixture",
          gates: [{ id: "secrets-scan", command: "npm", args: ["run", "secrets-scan"] }],
          secretsScan: { allowPaths: [".env", "src/key.ts"] },
        },
        null,
        2,
      )}\n`,
    });
    initGit(dir);
    execFileSync("git", ["add", "-f", ".env", "src/key.ts", "gauntlet.config.json"], {
      cwd: dir,
      stdio: "ignore",
    });
    const result = runSecretsScan(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.rule === "forbidden-path")).toBe(true);
    expect(result.findings.some((finding) => finding.rule === "private-key")).toBe(true);
  });
});
