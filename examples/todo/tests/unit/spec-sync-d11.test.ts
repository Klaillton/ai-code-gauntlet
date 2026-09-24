import { describe, expect, it } from "vitest";
import type { FeatureScenario } from "../../scripts/inventory.js";
import { evaluateEdgeInventory, scenarioHasEdgeMarker } from "../../scripts/spec-sync.js";

function scenario(
  partial: Partial<FeatureScenario> &
    Pick<FeatureScenario, "name" | "operationIds" | "scenarioTags">,
): FeatureScenario {
  return {
    featureFile: "features/sample.feature",
    tags: [...partial.scenarioTags, ...partial.operationIds.map((id) => `@op:${id}`)],
    steps: ["When something", "Then something"],
    ...partial,
  };
}

describe("D11 edge inventory", () => {
  it("failsWhenHappyOnlyOpHasNoEdgeMarker", () => {
    const findings = evaluateEdgeInventory([
      scenario({
        name: "Create succeeds",
        operationIds: ["createTodo"],
        scenarioTags: ["@op:createTodo", "@happy"],
      }),
    ]);
    expect(findings.some((f) => f.id === "D11" && f.severity === "fail")).toBe(true);
    expect(findings[0]?.message).toContain("createTodo");
    expect(findings[0]?.message).toContain("@unhappy");
  });

  it("passesWhenHappyPlusUnhappyForSameOp", () => {
    const findings = evaluateEdgeInventory([
      scenario({
        name: "Create succeeds",
        operationIds: ["createTodo"],
        scenarioTags: ["@op:createTodo", "@happy"],
      }),
      scenario({
        name: "Create rejects blank",
        operationIds: ["createTodo"],
        scenarioTags: ["@op:createTodo", "@unhappy"],
      }),
    ]);
    expect(findings.filter((f) => f.id === "D11")).toEqual([]);
  });

  it("passesWhenHappyPlusEdgeForSameOp", () => {
    const findings = evaluateEdgeInventory([
      scenario({
        name: "List items",
        operationIds: ["listTodos"],
        scenarioTags: ["@op:listTodos", "@happy"],
      }),
      scenario({
        name: "List empty",
        operationIds: ["listTodos"],
        scenarioTags: ["@op:listTodos", "@edge"],
      }),
    ]);
    expect(findings.filter((f) => f.id === "D11")).toEqual([]);
  });

  it("ignoresOpsWithNoGherkin", () => {
    // Missing Gherkin is D3's job — D11 only inventories ops that already have scenarios.
    const findings = evaluateEdgeInventory([
      scenario({
        name: "Health ok",
        operationIds: ["getHealth"],
        scenarioTags: ["@op:getHealth", "@happy"],
      }),
      scenario({
        name: "Health names service",
        operationIds: ["getHealth"],
        scenarioTags: ["@op:getHealth", "@edge"],
      }),
    ]);
    expect(findings.every((f) => !f.message.includes("missingOp"))).toBe(true);
    expect(findings.filter((f) => f.id === "D11")).toEqual([]);
  });

  it("doesNotCountFeatureLevelEdgeTags", () => {
    // Feature-level @edge lands in tags but not scenarioTags — must still fail.
    const happyOnly: FeatureScenario = {
      featureFile: "features/x.feature",
      name: "Only happy",
      tags: ["@edge", "@op:getHealth", "@happy"],
      scenarioTags: ["@op:getHealth", "@happy"],
      operationIds: ["getHealth"],
      steps: ["When I request the service health", 'Then the health status is "ok"'],
    };
    expect(scenarioHasEdgeMarker(happyOnly)).toBe(false);
    const findings = evaluateEdgeInventory([happyOnly]);
    expect(findings.some((f) => f.id === "D11" && f.message.includes("getHealth"))).toBe(true);
  });

  it("failsPerOpWhenOnlyOneOfTwoOpsHasEdge", () => {
    const findings = evaluateEdgeInventory([
      scenario({
        name: "Create ok",
        operationIds: ["createTodo"],
        scenarioTags: ["@op:createTodo", "@happy"],
      }),
      scenario({
        name: "Create bad",
        operationIds: ["createTodo"],
        scenarioTags: ["@op:createTodo", "@unhappy"],
      }),
      scenario({
        name: "Complete ok",
        operationIds: ["completeTodo"],
        scenarioTags: ["@op:completeTodo", "@happy"],
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("completeTodo");
    expect(findings[0]?.message).not.toContain("createTodo");
  });
});
