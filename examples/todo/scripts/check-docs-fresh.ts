import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { runSpecSync } from "./spec-sync.js";
import { GENERATED_DOC_FILES, renderGeneratedDocs } from "./generate-docs.js";

export function checkDocsFresh(cwd = process.cwd()): { ok: boolean; mismatches: string[] } {
  const result = runSpecSync(cwd);
  const expected = renderGeneratedDocs(result.inventory, result.findings);
  const dir = resolve(cwd, "docs/generated");
  const mismatches: string[] = [];
  for (const name of GENERATED_DOC_FILES) {
    const path = join(dir, name);
    const wanted = expected[name] ?? "";
    const committed = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (committed !== wanted) {
      mismatches.push(name + " needs npm run docs:generate");
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === resolve(entry);
}

function main(): void {
  const outcome = checkDocsFresh();
  if (outcome.ok) {
    console.info("D7 generated docs are fresh.");
    return;
  }
  console.error("D7 generated docs are not fresh:");
  console.error(outcome.mismatches.join("\n"));
  console.error("Regenerate with: npm run docs:generate");
  process.exitCode = 1;
}

if (isDirectRun()) {
  main();
}
