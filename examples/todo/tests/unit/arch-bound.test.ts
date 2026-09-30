import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  collectImportSpecifiers,
  isForbiddenModule,
  isInfraRel,
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

  it("shouldFailForbiddenModuleSubpaths", () => {
    expect(isForbiddenModule("node:fs/promises")).toBe(true);
    expect(isForbiddenModule("fs/promises")).toBe(true);
    expect(isForbiddenModule("node:http/promises")).toBe(true);
    expect(isForbiddenModule("child_process/promises")).toBe(true);

    const nodeFs = scanDomainFile(
      `import { readFile } from "node:fs/promises";\n`,
      "src/domain/todo.ts",
      process.cwd(),
    );
    expect(nodeFs.some((finding) => finding.severity === "fail")).toBe(true);

    const fsPromises = scanDomainFile(
      `import { readFile } from "fs/promises";\n`,
      "src/domain/todo.ts",
      process.cwd(),
    );
    expect(fsPromises.some((finding) => finding.severity === "fail")).toBe(true);
  });

  it("shouldAllowNearMissPackagesLikeFsExtra", () => {
    expect(isForbiddenModule("fs-extra")).toBe(false);
    expect(isForbiddenModule("fs-extra/esm")).toBe(false);
    expect(isForbiddenModule("graceful-fs")).toBe(false);
    expect(isForbiddenModule("node:fs-extra")).toBe(false);

    const findings = scanDomainFile(
      `import fs from "fs-extra";\nimport x from "fs-extra/esm";\n`,
      "src/domain/todo.ts",
      process.cwd(),
    );
    expect(findings).toEqual([]);
  });

  it("shouldFailDirectoryStyleRelativeInfraImports", () => {
    expect(isInfraRel("src/api")).toBe(true);
    expect(isInfraRel("src/api/")).toBe(true);
    expect(isInfraRel("src/api/index")).toBe(true);
    expect(isInfraRel("src/web")).toBe(true);
    expect(isInfraRel("src/server")).toBe(true);
    expect(isInfraRel("src/domain")).toBe(false);
    expect(isInfraRel("src/domain/todo")).toBe(false);

    const dirApi = scanDomainFile(
      `import * as api from "../api";\n`,
      "src/domain/todo.ts",
      process.cwd(),
    );
    expect(dirApi.some((finding) => finding.severity === "fail")).toBe(true);
    expect(dirApi.some((finding) => finding.message.includes("src/api"))).toBe(true);

    const dirApiSlash = scanDomainFile(
      `import * as api from "../api/";\n`,
      "src/domain/todo.ts",
      process.cwd(),
    );
    expect(dirApiSlash.some((finding) => finding.severity === "fail")).toBe(true);

    const dirApiIndex = scanDomainFile(
      `import * as api from "../api/index";\n`,
      "src/domain/todo.ts",
      process.cwd(),
    );
    expect(dirApiIndex.some((finding) => finding.severity === "fail")).toBe(true);
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
