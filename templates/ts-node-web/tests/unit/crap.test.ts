import { describe, expect, it } from "vitest";
import { coverageRatioForRel, crapScore } from "../../scripts/crap.js";

describe("crapScore", () => {
  it("shouldEqualComplexityWhenFullyCovered", () => {
    expect(crapScore(1, 1)).toBe(1);
    expect(crapScore(8, 1)).toBe(8);
    expect(crapScore(9, 1)).toBe(9);
  });

  it("shouldRiseWhenCoverageDrops", () => {
    expect(crapScore(3, 0)).toBe(12);
    expect(crapScore(2, 0.8)).toBeCloseTo(2.032, 3);
  });

  it("shouldClampCoverageToUnitInterval", () => {
    expect(crapScore(2, 1.5)).toBe(2);
    expect(crapScore(2, -1)).toBe(6);
  });
});

describe("coverageRatioForRel", () => {
  it("shouldMatchSummaryKeysByPathSuffix", () => {
    const summary = {
      total: { lines: { pct: 50 } },
      "/workspace/app/src/domain/todo.ts": { lines: { pct: 100 } },
    };
    expect(coverageRatioForRel(summary, "src/domain/todo.ts")).toBe(1);
    expect(coverageRatioForRel(summary, "src/domain/missing.ts")).toBeUndefined();
  });
});
