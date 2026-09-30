import process from "node:process";
import { describe, expect, it } from "vitest";
import { readConfiguredMax, resolveMaxIterations } from "../../scripts/agent-loop.js";

describe("agent-loop max iterations", () => {
  it("shouldUseConfigMaxWhenEnvUnset", () => {
    expect(resolveMaxIterations({}, 7)).toBe(7);
    expect(resolveMaxIterations({}, undefined)).toBe(5);
  });

  it("shouldPreferValidMaxIterationsEnv", () => {
    expect(resolveMaxIterations({ MAX_ITERATIONS: "3" }, 7)).toBe(3);
  });

  it("shouldRejectInvalidMaxIterations", () => {
    for (const value of ["0", "abc", "", "1.5", "-1"]) {
      expect(() => resolveMaxIterations({ MAX_ITERATIONS: value }, 7)).toThrow(
        /Invalid MAX_ITERATIONS/,
      );
    }
  });

  it("shouldReadIntegerMaxVerifyCyclesFromConfig", () => {
    expect(readConfiguredMax(process.cwd())).toBe(5);
  });
});
