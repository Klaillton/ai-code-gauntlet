import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateSpecCode,
  isProtectedSpecPath,
  runSpecCode,
  specCodeAllowed,
} from "../../scripts/spec-code.js";

const temps: string[] = [];

afterEach(() => {
  delete process.env.SPEC_SYNC_APPROVED;
  delete process.env.GITHUB_EVENT_PATH;
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

describe("isProtectedSpecPath", () => {
  it("matchesDefaultGlobs", () => {
    expect(isProtectedSpecPath("features/health.feature", ["features/**/*.feature"])).toBe(true);
    expect(isProtectedSpecPath("openapi/openapi.yaml", ["openapi/openapi.yaml"])).toBe(true);
    expect(isProtectedSpecPath("docs/holes-review/x.md", ["docs/holes-review/**/*.md"])).toBe(true);
    expect(isProtectedSpecPath("src/domain/x.ts", ["features/**/*.feature"])).toBe(false);
  });
});

describe("evaluateSpecCode", () => {
  it("skipsDocsOnly", () => {
    const findings = evaluateSpecCode({
      appRelChanged: ["README.md", "docs/PREMISES.md"],
      grant: { allowed: false, reason: "none" },
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
    expect(findings[0]?.message.toLowerCase()).toContain("not required");
  });

  it("skipsSpecOnly", () => {
    const findings = evaluateSpecCode({
      appRelChanged: ["features/health.feature"],
      grant: { allowed: false, reason: "none" },
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
  });

  it("passesWhenSrcAndFeaturePaired", () => {
    const findings = evaluateSpecCode({
      appRelChanged: ["src/domain/health.ts", "features/health.feature"],
      grant: { allowed: false, reason: "none" },
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
  });

  it("failsSrcWithoutSpec", () => {
    const findings = evaluateSpecCode({
      appRelChanged: ["src/domain/health.ts"],
      grant: { allowed: false, reason: "none" },
    });
    expect(findings.some((f) => f.severity === "fail" && f.id === "CHANGE-3")).toBe(true);
  });

  it("passesWithGrant", () => {
    const findings = evaluateSpecCode({
      appRelChanged: ["src/api/app.ts"],
      grant: { allowed: true, reason: "SPEC_SYNC_APPROVED=1" },
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
  });
});

describe("specCodeAllowed", () => {
  it("honorsEnvGrant", () => {
    process.env.SPEC_SYNC_APPROVED = "1";
    expect(specCodeAllowed("/tmp", false).allowed).toBe(true);
  });

  it("honorsConfigSkip", () => {
    expect(specCodeAllowed("/tmp", true).allowed).toBe(true);
  });
});

describe("runSpecCode", () => {
  it("failsClosedWithoutGit", () => {
    const dir = scratch("spec-code-nogit-");
    writeFileSync(
      join(dir, "gauntlet.config.json"),
      JSON.stringify({ name: "x", gates: [], allowlist: [] }),
    );
    const result = runSpecCode(dir);
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message.toLowerCase()).toContain("git required");
  });
});
