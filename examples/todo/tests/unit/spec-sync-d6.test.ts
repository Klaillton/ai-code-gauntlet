import { describe, expect, it } from "vitest";
import type { AllowlistEntry } from "../../scripts/inventory.js";
import {
  baseExempt,
  evaluateApiRouteDelta,
  isUnderScopedDir,
  parseFeatureOperationIds,
  parseOpenApiRouteKeys,
  parseRouteKeys,
} from "../../scripts/spec-sync.js";

const severity = "fail" as const;

const harnessAllow: AllowlistEntry = {
  kind: "test-harness",
  method: "POST",
  path: "/api/test/reset",
  reason: "E2E harness",
  exemptFrom: ["openapi", "gherkin"],
  owner: "klaillton",
  expires: "2099-01-01",
};

const expiredAllow: AllowlistEntry = {
  ...harnessAllow,
  expires: "2020-01-01",
};

describe("D6 scope", () => {
  it("doesNotCountTemplateApiWhenExamplePrefix", () => {
    expect(
      isUnderScopedDir("templates/ts-node-web/src/api/app.ts", "examples/todo", "src/api"),
    ).toBe(false);
  });

  it("countsExampleApiUnderPrefix", () => {
    expect(isUnderScopedDir("examples/todo/src/api/app.ts", "examples/todo", "src/api")).toBe(
      true,
    );
  });

  it("docsGeneratedNeverLooksLikeApiScope", () => {
    expect(
      isUnderScopedDir("examples/todo/docs/generated/api.md", "examples/todo", "src/api"),
    ).toBe(false);
  });
});

describe("D6 route delta", () => {
  it("passesWhenDeletingAllowlistedHarnessWithoutSpec", () => {
    const baseApp = `app.get("/health", h)\napp.post("/api/test/reset", r)\n`;
    const headApp = `app.get("/health", h)\n`;
    const findings = evaluateApiRouteDelta({
      baseRoutes: parseRouteKeys(baseApp),
      headRoutes: parseRouteKeys(headApp),
      baseOpenApi: new Map([["GET /health", "getHealth"]]),
      headOpenApi: new Map([["GET /health", "getHealth"]]),
      baseFeatureOps: new Set(["getHealth"]),
      headFeatureOps: new Set(["getHealth"]),
      baseAllowlist: [harnessAllow],
      severity,
    });
    expect(findings).toEqual([]);
  });

  it("failsWhenNewPublicRouteMissingOpenApi", () => {
    const baseApp = `app.get("/health", h)\n`;
    const headApp = `app.get("/health", h)\napp.post("/api/todos", c)\n`;
    const findings = evaluateApiRouteDelta({
      baseRoutes: parseRouteKeys(baseApp),
      headRoutes: parseRouteKeys(headApp),
      baseOpenApi: new Map([["GET /health", "getHealth"]]),
      headOpenApi: new Map([["GET /health", "getHealth"]]),
      baseFeatureOps: new Set(["getHealth"]),
      headFeatureOps: new Set(["getHealth"]),
      baseAllowlist: [],
      severity,
    });
    expect(findings.some((f) => f.message.includes("POST /api/todos"))).toBe(true);
  });

  it("failsWhenDeletingOpenApiRouteWithoutRemovingYaml", () => {
    const baseApp = `app.get("/health", h)\napp.post("/api/todos", c)\n`;
    const headApp = `app.get("/health", h)\n`;
    const findings = evaluateApiRouteDelta({
      baseRoutes: parseRouteKeys(baseApp),
      headRoutes: parseRouteKeys(headApp),
      baseOpenApi: new Map([
        ["GET /health", "getHealth"],
        ["POST /api/todos", "createTodo"],
      ]),
      headOpenApi: new Map([
        ["GET /health", "getHealth"],
        ["POST /api/todos", "createTodo"],
      ]),
      baseFeatureOps: new Set(["getHealth", "createTodo"]),
      headFeatureOps: new Set(["getHealth", "createTodo"]),
      baseAllowlist: [],
      severity,
    });
    expect(findings.some((f) => f.message.includes("still present in OpenAPI"))).toBe(true);
    expect(findings.some((f) => f.message.includes("@op:createTodo"))).toBe(true);
  });

  it("passesWhenDeletingOpenApiRouteAndRemovingYamlAndOp", () => {
    const baseApp = `app.get("/health", h)\napp.post("/api/todos", c)\n`;
    const headApp = `app.get("/health", h)\n`;
    const findings = evaluateApiRouteDelta({
      baseRoutes: parseRouteKeys(baseApp),
      headRoutes: parseRouteKeys(headApp),
      baseOpenApi: new Map([
        ["GET /health", "getHealth"],
        ["POST /api/todos", "createTodo"],
      ]),
      headOpenApi: new Map([["GET /health", "getHealth"]]),
      baseFeatureOps: new Set(["getHealth", "createTodo"]),
      headFeatureOps: new Set(["getHealth"]),
      baseAllowlist: [],
      severity,
    });
    expect(findings).toEqual([]);
  });

  it("passesOnCommentOnlyAppChange", () => {
    const baseApp = `app.get("/health", h)\n`;
    const headApp = `// ping\napp.get("/health", h)\n`;
    const findings = evaluateApiRouteDelta({
      baseRoutes: parseRouteKeys(baseApp),
      headRoutes: parseRouteKeys(headApp),
      baseOpenApi: new Map([["GET /health", "getHealth"]]),
      headOpenApi: new Map([["GET /health", "getHealth"]]),
      baseFeatureOps: new Set(["getHealth"]),
      headFeatureOps: new Set(["getHealth"]),
      baseAllowlist: [],
      severity,
    });
    expect(findings).toEqual([]);
  });

  it("failsWhenExpiredAllowlistAndNewRoute", () => {
    const baseApp = `app.get("/health", h)\n`;
    const headApp = `app.get("/health", h)\napp.post("/api/test/reset", r)\n`;
    const findings = evaluateApiRouteDelta({
      baseRoutes: parseRouteKeys(baseApp),
      headRoutes: parseRouteKeys(headApp),
      baseOpenApi: new Map([["GET /health", "getHealth"]]),
      headOpenApi: new Map([["GET /health", "getHealth"]]),
      baseFeatureOps: new Set(["getHealth"]),
      headFeatureOps: new Set(["getHealth"]),
      baseAllowlist: [expiredAllow],
      severity,
      today: "2026-09-10",
    });
    expect(findings.some((f) => f.message.includes("POST /api/test/reset"))).toBe(true);
  });

  it("docsGeneratedAloneDoesNotSatisfyDelta", () => {
    // Pure delta ignores docs; a new public route still fails even if docs changed elsewhere.
    const findings = evaluateApiRouteDelta({
      baseRoutes: parseRouteKeys(`app.get("/health", h)\n`),
      headRoutes: parseRouteKeys(`app.get("/health", h)\napp.get("/api/x", x)\n`),
      baseOpenApi: new Map([["GET /health", "getHealth"]]),
      headOpenApi: new Map([["GET /health", "getHealth"]]),
      baseFeatureOps: new Set(["getHealth"]),
      headFeatureOps: new Set(["getHealth"]),
      baseAllowlist: [],
      severity,
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => !f.message.toLowerCase().includes("docs"))).toBe(true);
  });
});

describe("D6 parsers", () => {
  it("parseOpenApiAndFeatures", () => {
    const yamlText = `
paths:
  /health:
    get:
      operationId: getHealth
`;
    expect(parseOpenApiRouteKeys(yamlText).get("GET /health")).toBe("getHealth");
    expect(parseFeatureOperationIds("@op:getHealth\nScenario: hi")).toEqual(new Set(["getHealth"]));
  });

  it("baseExemptRespectsExpiry", () => {
    expect(baseExempt([harnessAllow], "POST", "/api/test/reset", "openapi", "2026-09-10")).toBe(
      true,
    );
    expect(baseExempt([expiredAllow], "POST", "/api/test/reset", "openapi", "2026-09-10")).toBe(
      false,
    );
  });
});
