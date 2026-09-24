import { describe, expect, it } from "vitest";
import type { ContractCase, OpenApiOperation } from "../../scripts/inventory.js";
import {
  contractCaseRouteKey,
  evaluateContractCasesInventory,
  normalizeCasePath,
} from "../../scripts/spec-sync.js";

function op(
  partial: Partial<OpenApiOperation> & Pick<OpenApiOperation, "method" | "path">,
): OpenApiOperation {
  const normalizedPath = partial.normalizedPath ?? partial.path;
  return {
    operationId: partial.operationId,
    method: partial.method,
    path: partial.path,
    normalizedPath,
  };
}

function caseEntry(
  partial: Partial<ContractCase> & Pick<ContractCase, "method" | "path">,
): ContractCase {
  return {
    label: partial.label,
    method: partial.method,
    path: partial.path,
    schemaPath: partial.schemaPath,
    schemaMethod: partial.schemaMethod,
    expectedStatus: partial.expectedStatus,
  };
}

const health = op({ method: "get", path: "/health", operationId: "getHealth" });
const list = op({ method: "get", path: "/api/todos", operationId: "listTodos" });

describe("D13 contract.cases inventory", () => {
  it("skipsWhenOpenApiAbsent", () => {
    const findings = evaluateContractCasesInventory({
      operations: [health],
      cases: [],
      openapiPresent: false,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.message).toMatch(/OpenAPI absent/);
  });

  it("skipsWhenInventoryDisabled", () => {
    const findings = evaluateContractCasesInventory({
      operations: [health],
      cases: [],
      openapiPresent: true,
      disabled: true,
    });
    expect(findings[0]?.severity).toBe("info");
    expect(findings[0]?.message).toMatch(/disabled/);
  });

  it("failsWhenOpHasZeroCases", () => {
    const findings = evaluateContractCasesInventory({
      operations: [health, list],
      cases: [
        caseEntry({
          method: "GET",
          path: "/health",
          schemaPath: "/health",
          schemaMethod: "get",
        }),
      ],
      openapiPresent: true,
    });
    const fails = findings.filter((f) => f.severity === "fail");
    expect(fails).toHaveLength(1);
    expect(fails[0]?.message).toMatch(/listTodos/);
    expect(fails[0]?.message).toMatch(/zero contract\.cases/);
  });

  it("passesWhenEveryOpHasAtLeastOneCase", () => {
    const findings = evaluateContractCasesInventory({
      operations: [health, list],
      cases: [
        caseEntry({
          method: "GET",
          path: "/health",
          schemaPath: "/health",
          schemaMethod: "get",
        }),
        caseEntry({
          method: "GET",
          path: "/api/todos",
          schemaPath: "/api/todos",
          schemaMethod: "get",
        }),
      ],
      openapiPresent: true,
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
    expect(findings.some((f) => f.message.includes("each have"))).toBe(true);
  });

  it("matchesCaseViaRuntimePathTemplate", () => {
    const complete = op({
      method: "post",
      path: "/api/todos/{id}/complete",
      normalizedPath: "/api/todos/{id}/complete",
      operationId: "completeTodo",
    });
    const findings = evaluateContractCasesInventory({
      operations: [complete],
      cases: [
        caseEntry({
          method: "POST",
          path: "/api/todos/{{todoId}}/complete",
        }),
      ],
      openapiPresent: true,
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
  });

  it("failsInvalidCaseNotInOpenApi", () => {
    const findings = evaluateContractCasesInventory({
      operations: [health],
      cases: [
        caseEntry({
          label: "ghost",
          method: "GET",
          path: "/nope",
          schemaPath: "/nope",
          schemaMethod: "get",
        }),
      ],
      openapiPresent: true,
    });
    const fails = findings.filter((f) => f.severity === "fail");
    expect(fails.some((f) => f.message.includes("invalid case"))).toBe(true);
    expect(fails.some((f) => f.message.includes("getHealth"))).toBe(true);
  });

  it("allowlistCoversOpWithoutCaseWhenNotExpired", () => {
    const findings = evaluateContractCasesInventory({
      operations: [health, list],
      cases: [
        caseEntry({
          method: "GET",
          path: "/health",
          schemaPath: "/health",
          schemaMethod: "get",
        }),
      ],
      caseAllowlist: [
        {
          operationId: "listTodos",
          reason: "WIP contract case",
          owner: "klaillton",
          expires: "2099-01-01",
        },
      ],
      openapiPresent: true,
      today: "2026-09-24",
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
  });

  it("failsWhenAllowlistExpired", () => {
    const findings = evaluateContractCasesInventory({
      operations: [list],
      cases: [],
      caseAllowlist: [
        {
          operationId: "listTodos",
          reason: "stale",
          owner: "klaillton",
          expires: "2020-01-01",
        },
      ],
      openapiPresent: true,
      today: "2026-09-24",
    });
    const fails = findings.filter((f) => f.severity === "fail");
    expect(fails).toHaveLength(1);
    expect(fails[0]?.message).toMatch(/expired on 2020-01-01/);
  });

  it("failsAllowlistMissingExpires", () => {
    const findings = evaluateContractCasesInventory({
      operations: [list],
      cases: [],
      caseAllowlist: [
        {
          operationId: "listTodos",
          reason: "no expiry",
          owner: "klaillton",
        },
      ],
      openapiPresent: true,
    });
    expect(findings.some((f) => f.message.includes("missing required fields: expires"))).toBe(true);
  });

  it("failsAllowlistWithoutOpIdentity", () => {
    const findings = evaluateContractCasesInventory({
      operations: [list],
      cases: [],
      caseAllowlist: [
        {
          reason: "vague",
          owner: "klaillton",
          expires: "2099-01-01",
        },
      ],
      openapiPresent: true,
    });
    expect(findings.some((f) => f.message.includes("needs operationId"))).toBe(true);
  });

  it("allowlistMatchesByMethodPath", () => {
    const findings = evaluateContractCasesInventory({
      operations: [list],
      cases: [],
      caseAllowlist: [
        {
          method: "GET",
          path: "/api/todos",
          reason: "by route",
          owner: "klaillton",
          expires: "2099-06-02",
        },
      ],
      openapiPresent: true,
      today: "2026-09-24",
    });
    expect(findings.every((f) => f.severity !== "fail")).toBe(true);
  });

  it("normalizeCasePathConvertsMustacheTemplates", () => {
    expect(normalizeCasePath("/api/todos/{{todoId}}/complete")).toBe(
      "/api/todos/{todoId}/complete",
    );
    expect(contractCaseRouteKey({ method: "post", path: "/api/todos/{{id}}/complete" })).toBe(
      "POST /api/todos/{}/complete",
    );
  });
});
