import { describe, expect, it } from "vitest";
import { resolveEmptyMutationSurface } from "../../scripts/mutation.js";

describe("CHANGE-2 resolveEmptyMutationSurface", () => {
  it("proceedsWhenMutantsExist", () => {
    expect(
      resolveEmptyMutationSurface({
        mutantCount: 3,
        differentialSkip: false,
      }),
    ).toEqual({ outcome: "proceed" });
  });

  it("failsEmptyWithoutSkipNeverHundred", () => {
    const r = resolveEmptyMutationSurface({
      mutantCount: 0,
      differentialSkip: false,
      label: "mutation",
    });
    expect(r.outcome).toBe("fail");
    if (r.outcome === "fail") {
      expect(r.finding.toLowerCase()).toContain("empty mutation surface");
      expect(r.finding).toMatch(/never 100%/i);
      expect(r.finding).not.toMatch(/treating score as 100/i);
    }
  });

  it("softSkipsDifferentialEmpty", () => {
    const r = resolveEmptyMutationSurface({
      mutantCount: 0,
      differentialSkip: true,
      label: "mutation",
    });
    expect(r.outcome).toBe("skip");
    if (r.outcome === "skip") {
      expect(r.finding.toLowerCase()).toContain("empty mutation surface");
      expect(r.finding).toContain("not 100%");
    }
  });

  it("honorsCommittedSkipReasonWithExpires", () => {
    const r = resolveEmptyMutationSurface({
      mutantCount: 0,
      differentialSkip: false,
      skipReason: "skeleton domain until first feature",
      expires: "2099-01-01",
      today: "2026-09-24",
      label: "gherkin-mutation",
    });
    expect(r.outcome).toBe("skip");
  });

  it("rejectsSkipReasonWithoutExpires", () => {
    const r = resolveEmptyMutationSurface({
      mutantCount: 0,
      differentialSkip: false,
      skipReason: "wip",
      today: "2026-09-24",
    });
    expect(r.outcome).toBe("fail");
    if (r.outcome === "fail") {
      expect(r.finding).toContain("expires");
    }
  });

  it("rejectsExpiredSkipReason", () => {
    const r = resolveEmptyMutationSurface({
      mutantCount: 0,
      differentialSkip: false,
      skipReason: "old",
      expires: "2020-01-01",
      today: "2026-09-24",
    });
    expect(r.outcome).toBe("fail");
    if (r.outcome === "fail") {
      expect(r.finding.toLowerCase()).toContain("expired");
    }
  });
});
