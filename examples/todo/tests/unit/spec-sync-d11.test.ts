import { describe, expect, it } from "vitest";
import type { FeatureScenario } from "../../scripts/inventory.js";
import {
  evaluateEdgeInventory,
  isExclusiveEdgeScenario,
  scenarioHasEdgeMarker,
  scenarioLevelOpIds,
} from "../../scripts/spec-sync.js";

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
    // Scenarios without @op stay outside D11 by design.
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

  it("multiOpEdgeScenarioCoversNoneAndFailsExplicitly", () => {
    const multi = scenario({
      name: "Shared rejection theater",
      operationIds: ["createTodo", "completeTodo"],
      scenarioTags: ["@op:createTodo", "@op:completeTodo", "@unhappy"],
    });
    expect(scenarioLevelOpIds(multi)).toEqual(["createTodo", "completeTodo"]);
    expect(isExclusiveEdgeScenario(multi)).toBe(false);

    const findings = evaluateEdgeInventory([
      scenario({
        name: "Create ok",
        operationIds: ["createTodo"],
        scenarioTags: ["@op:createTodo", "@happy"],
      }),
      scenario({
        name: "Complete ok",
        operationIds: ["completeTodo"],
        scenarioTags: ["@op:completeTodo", "@happy"],
      }),
      multi,
    ]);

    const multiFinding = findings.find((f) => f.message.includes("multiple @op"));
    expect(multiFinding).toBeDefined();
    expect(multiFinding?.message).toContain("Shared rejection theater");
    expect(multiFinding?.message).toContain("@op:createTodo");
    expect(multiFinding?.message).toContain("@op:completeTodo");
    expect(multiFinding?.message).toContain("cover none");

    // Neither op receives edge credit from the multi-op scenario.
    expect(findings.some((f) => f.message.includes('operationId "createTodo"'))).toBe(true);
    expect(findings.some((f) => f.message.includes('operationId "completeTodo"'))).toBe(true);
  });

  it("edgeWithoutScenarioLevelOpFailsAndCoversNothing", () => {
    // Feature-level @op does not satisfy the exclusive single-@op rule.
    const edgeNoScenarioOp: FeatureScenario = {
      featureFile: "features/x.feature",
      name: "Edge without scenario op",
      tags: ["@op:getHealth", "@edge"],
      scenarioTags: ["@edge"],
      operationIds: ["getHealth"],
      steps: ["When I request the service health"],
    };
    expect(isExclusiveEdgeScenario(edgeNoScenarioOp)).toBe(false);
    const findings = evaluateEdgeInventory([
      scenario({
        name: "Health ok",
        operationIds: ["getHealth"],
        scenarioTags: ["@op:getHealth", "@happy"],
      }),
      edgeNoScenarioOp,
    ]);
    expect(findings.some((f) => f.message.includes("found 0"))).toBe(true);
    expect(findings.some((f) => f.message.includes('operationId "getHealth"'))).toBe(true);
  });
});
