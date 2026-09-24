import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateSddPresence,
  runSddPresence,
  validateSddPresenceDoc,
} from "../../scripts/sdd-presence.js";

const temps: string[] = [];

afterEach(() => {
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

const validDoc = `# Security

## Requirements

- Authenticate mutating APIs
`;

describe("validateSddPresenceDoc", () => {
  it("acceptsHeadingPlusRequirement", () => {
    const v = validateSddPresenceDoc(validDoc);
    expect(v.ok).toBe(true);
    expect(v.hasHeading).toBe(true);
    expect(v.hasRequirement).toBe(true);
  });

  it("acceptsLoremTodoOnlyResidual", () => {
    const v = validateSddPresenceDoc(`# Observability

- TODO: fill real SLOs later
- lorem ipsum dolor sit amet
`);
    expect(v.ok).toBe(true);
  });

  it("failsEmpty", () => {
    const v = validateSddPresenceDoc("   \n");
    expect(v.ok).toBe(false);
    expect(v.empty).toBe(true);
  });

  it("failsHeadingOnly", () => {
    const v = validateSddPresenceDoc("# Security\n\nSome prose without a list.\n");
    expect(v.ok).toBe(false);
    expect(v.hasHeading).toBe(true);
    expect(v.hasRequirement).toBe(false);
  });

  it("failsRequirementWithoutHeading", () => {
    const v = validateSddPresenceDoc("- Must auth\n");
    expect(v.ok).toBe(false);
    expect(v.hasHeading).toBe(false);
    expect(v.hasRequirement).toBe(true);
  });

  it("acceptsNumberedRequirement", () => {
    const v = validateSddPresenceDoc("# Security\n\n1. Use TLS everywhere\n");
    expect(v.ok).toBe(true);
  });
});

describe("evaluateSddPresence", () => {
  it("skipsWhenSddFalse", () => {
    const findings = evaluateSddPresence({
      sddActive: false,
      securityRel: "docs/sdd/Security.md",
      observabilityRel: "docs/sdd/Observability.md",
      securityContent: undefined,
      observabilityContent: undefined,
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
    expect(findings[0]?.message.toLowerCase()).toContain("skipped");
  });

  it("failsWhenMissing", () => {
    const findings = evaluateSddPresence({
      sddActive: true,
      securityRel: "docs/sdd/Security.md",
      observabilityRel: "docs/sdd/Observability.md",
      securityContent: undefined,
      observabilityContent: validDoc.replace("Security", "Observability"),
    });
    expect(findings.some((f) => f.severity === "fail" && f.message.includes("Security"))).toBe(
      true,
    );
  });

  it("passesWhenBothPresent", () => {
    const findings = evaluateSddPresence({
      sddActive: true,
      securityRel: "docs/sdd/Security.md",
      observabilityRel: "docs/sdd/Observability.md",
      securityContent: validDoc,
      observabilityContent: validDoc.replace("Security", "Observability"),
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
  });
});

describe("runSddPresence", () => {
  it("passesOnTodoExample", () => {
    const result = runSddPresence(process.cwd());
    expect(result.ok).toBe(true);
  });

  it("skipsWhenConfigSddFalse", () => {
    const dir = scratch("sdd-false-");
    writeFileSync(
      join(dir, "gauntlet.config.json"),
      JSON.stringify({ name: "x", sdd: false, gates: [], allowlist: [] }),
    );
    const result = runSddPresence(dir);
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.message.toLowerCase().includes("skipped"))).toBe(true);
  });

  it("honorsConfigPaths", () => {
    const dir = scratch("sdd-paths-");
    mkdirSync(join(dir, "custom"), { recursive: true });
    writeFileSync(join(dir, "custom/sec.md"), "# Security\n\n- req\n");
    writeFileSync(join(dir, "custom/obs.md"), "# Observability\n\n- req\n");
    writeFileSync(
      join(dir, "gauntlet.config.json"),
      JSON.stringify({
        name: "x",
        sdd: { securityPath: "custom/sec.md", observabilityPath: "custom/obs.md" },
        gates: [],
        allowlist: [],
      }),
    );
    const result = runSddPresence(dir);
    expect(result.ok).toBe(true);
  });

  it("failsWhenDocsMissingOnDisk", () => {
    const dir = scratch("sdd-missing-");
    writeFileSync(
      join(dir, "gauntlet.config.json"),
      JSON.stringify({ name: "x", gates: [], allowlist: [] }),
    );
    const result = runSddPresence(dir);
    expect(result.ok).toBe(false);
  });
});
