import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { planGherkinMutants } from "../../scripts/gherkin-mutation.js";
import { selectMutationFiles } from "../../scripts/mutation.js";

describe("planGherkinMutants", () => {
  it("shouldMutateThenQuotesAndStatusCodesFirst", () => {
    const source = [
      `Feature: x`,
      `  Scenario: y`,
      `    When I add a todo titled "Alpha"`,
      `    Then the API responds with status 400`,
      `    And the health status is "ok"`,
    ].join("\n");
    const planned = planGherkinMutants(source, 10);
    expect(planned.some((m) => m.operator === "gherkin:status" && m.replacement === "401")).toBe(
      true,
    );
    expect(planned.some((m) => m.replacement === `"okX"`)).toBe(true);
    expect(planned.some((m) => m.replacement === `"AlphaX"`)).toBe(true);
  });

  it("shouldTurnBlankQuotedExampleIntoX", () => {
    const source = `    Then I create a todo via the API with title "   "\n`;
    const planned = planGherkinMutants(source, 5);
    expect(planned.some((m) => m.replacement === `"x"`)).toBe(true);
  });

  it("shouldCapMutantCount", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `    Then foo is "${i}"`);
    const planned = planGherkinMutants(lines.join("\n"), 3);
    expect(planned).toHaveLength(3);
  });
});

describe("selectMutationFiles", () => {
  const cwd = process.cwd();
  const a = resolve(cwd, "src/domain/a.ts");
  const b = resolve(cwd, "src/domain/b.ts");

  it("shouldUseFullSetOnMainPushOrEmptyDiff", () => {
    expect(selectMutationFiles([a, b], cwd, [], false, true)).toEqual([a, b]);
    expect(selectMutationFiles([a, b], cwd, [], true, false)).toEqual([a, b]);
  });

  it("shouldSkipWhenPrTouchesNothingInInclude", () => {
    expect(selectMutationFiles([a], cwd, [], true, true)).toEqual([]);
  });

  it("shouldKeepOnlyIncludeHitsOnAPr", () => {
    expect(selectMutationFiles([a, b], cwd, ["src/domain/a.ts"], true, true)).toEqual([a]);
  });
});
