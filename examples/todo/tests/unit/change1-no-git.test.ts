import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { depsEditAllowed, runDepsLock } from "../../scripts/deps-lock.js";
import { runCrap } from "../../scripts/crap.js";
import { runProtectSpecs, specEditAllowed } from "../../scripts/protect-specs.js";

const temps: string[] = [];

afterEach(() => {
  delete process.env.ALLOW_SPEC_EDIT;
  delete process.env.ALLOW_DEPS_EDIT;
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

function writeMinimalConfig(dir: string): void {
  writeFileSync(
    join(dir, "gauntlet.config.json"),
    JSON.stringify({
      name: "scratch",
      strictness: "strict",
      gates: [],
      allowlist: [],
    }),
  );
}

describe("CHANGE-1 no-git fail-closed", () => {
  it("protectSpecsFailsWhenNotAGitCheckout", () => {
    const dir = scratch("protect-nogit-");
    writeMinimalConfig(dir);
    const result = runProtectSpecs(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "fail")).toBe(true);
    expect(result.findings[0]?.message.toLowerCase()).toContain("git required for this gate");
  });

  it("depsLockFailsWhenNotAGitCheckout", () => {
    const dir = scratch("deps-nogit-");
    writeMinimalConfig(dir);
    const result = runDepsLock(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "fail")).toBe(true);
    expect(result.findings[0]?.message.toLowerCase()).toContain("git required for this gate");
  });

  it("crapFailsWhenNotAGitCheckout", () => {
    const dir = scratch("crap-nogit-");
    writeMinimalConfig(dir);
    mkdirSync(join(dir, "coverage"), { recursive: true });
    writeFileSync(
      join(dir, "coverage/coverage-summary.json"),
      JSON.stringify({ total: { lines: { pct: 100 } } }),
    );
    const result = runCrap(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.severity === "fail")).toBe(true);
    expect(
      result.findings.some((f) => f.message.toLowerCase().includes("git required for this gate")),
    ).toBe(true);
  });

  it("protectSpecsPassesInRealGitCheckoutWithoutSpecDiff", () => {
    // examples/todo is inside the kit git repo.
    const result = runProtectSpecs(process.cwd());
    expect(result.ok).toBe(true);
    expect(result.findings.every((f) => f.severity !== "fail")).toBe(true);
  });

  it("depsLockDoesNotFailClosedForMissingGitInRealCheckout", () => {
    // Branch may touch package.json (deps-approved). Assert CHANGE-1 positive path:
    // a real git checkout must not fail with "git required for this gate".
    const prev = process.env.ALLOW_DEPS_EDIT;
    process.env.ALLOW_DEPS_EDIT = "1";
    try {
      const result = runDepsLock(process.cwd());
      expect(
        result.findings.some((f) => f.message.toLowerCase().includes("git required for this gate")),
      ).toBe(false);
      expect(result.ok).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.ALLOW_DEPS_EDIT;
      } else {
        process.env.ALLOW_DEPS_EDIT = prev;
      }
    }
  });
});

describe("CHANGE-1 grants exclude working-tree allow files", () => {
  it("specEditAllowedIgnoresGauntletAllowFile", () => {
    const dir = scratch("protect-allowfile-");
    mkdirSync(join(dir, ".gauntlet"), { recursive: true });
    writeFileSync(join(dir, ".gauntlet/allow-spec-edit"), "agent theater\n");
    expect(specEditAllowed(dir, false).allowed).toBe(false);
    expect(specEditAllowed(dir, true).reason).toContain("allowSpecEdit");
    process.env.ALLOW_SPEC_EDIT = "1";
    expect(specEditAllowed(dir, false).allowed).toBe(true);
  });

  it("depsEditAllowedIgnoresGauntletAllowFile", () => {
    const dir = scratch("deps-allowfile-");
    mkdirSync(join(dir, ".gauntlet"), { recursive: true });
    writeFileSync(join(dir, ".gauntlet/allow-deps-edit"), "agent theater\n");
    expect(depsEditAllowed(dir, false).allowed).toBe(false);
    expect(depsEditAllowed(dir, true).reason).toContain("allowDepsEdit");
    process.env.ALLOW_DEPS_EDIT = "1";
    expect(depsEditAllowed(dir, false).allowed).toBe(true);
  });
});
