import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  collectImportSpecifiers,
  isForbiddenModule,
  scanDomainFile,
} from "../../scripts/arch-bound.js";
import { includeGitBranchDivergence } from "../../scripts/inventory.js";

describe("arch-bound", () => {
  it("shouldAllowSameLayerDomainImports", () => {
    const source = `import type { Todo } from "./todo.js";\n`;
    expect(scanDomainFile(source, "src/domain/todo-service.ts", process.cwd())).toEqual([]);
  });

  it("shouldFailWhenDomainImportsApiOrHono", () => {
    const api = scanDomainFile(
      `import { app } from "../api/app.js";\n`,
      "src/domain/todo.ts",
      process.cwd(),
    );
    expect(api.some((finding) => finding.severity === "fail")).toBe(true);

    const hono = scanDomainFile(
      `import { Hono } from "hono";\n`,
      "src/domain/todo.ts",
      process.cwd(),
    );
    expect(hono.some((finding) => finding.message.includes("hono"))).toBe(true);
  });

  it("shouldFailFsAndPlaywrightModules", () => {
    expect(isForbiddenModule("node:fs")).toBe(true);
    expect(isForbiddenModule("playwright")).toBe(true);
    expect(isForbiddenModule("node:crypto")).toBe(false);
    expect(collectImportSpecifiers(`export { x } from "../web/home-page.js";`)).toEqual([
      "../web/home-page.js",
    ]);
  });
});

describe("includeGitBranchDivergence", () => {
  it("shouldSkipOriginMainOnPushToMain", () => {
    expect(
      includeGitBranchDivergence({
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
      }),
    ).toBe(false);
  });

  it("shouldKeepDivergenceOnPullRequest", () => {
    expect(
      includeGitBranchDivergence({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF: "refs/heads/feat/secrets-scan",
      }),
    ).toBe(true);
  });
});
