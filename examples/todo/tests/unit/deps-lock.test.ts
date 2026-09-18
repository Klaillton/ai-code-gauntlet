import { describe, expect, it } from "vitest";
import { isProtectedDepPath } from "../../scripts/deps-lock.js";

describe("isProtectedDepPath", () => {
  it("shouldProtectRootExamplesTemplatesAndPackagesManifests", () => {
    expect(isProtectedDepPath("package.json")).toBe(true);
    expect(isProtectedDepPath("examples/todo/package.json")).toBe(true);
    expect(isProtectedDepPath("templates/ts-node-web/package-lock.json")).toBe(true);
    expect(isProtectedDepPath("packages/gauntlet-gates/package.json")).toBe(true);
    expect(isProtectedDepPath("packages/create-ai-gauntlet/package.json")).toBe(true);
  });

  it("shouldIgnoreNestedAndNonManifestPaths", () => {
    expect(isProtectedDepPath("src/package.json")).toBe(false);
    expect(isProtectedDepPath("examples/todo/src/foo.ts")).toBe(false);
    expect(isProtectedDepPath("packages/gauntlet-gates/src/deps-lock.ts")).toBe(false);
  });
});
