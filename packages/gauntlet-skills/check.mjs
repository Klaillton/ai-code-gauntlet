import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dests = [
  ["examples/todo/.agent/skills", join(here, "../../examples/todo/.agent/skills")],
  ["templates/ts-node-web/.agent/skills", join(here, "../../templates/ts-node-web/.agent/skills")],
];

function normalize(buf) {
  return buf.toString("utf8").replace(/\r\n/g, "\n");
}

const files = readdirSync(here)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .sort();
let drift = 0;
for (const name of files) {
  const canonical = normalize(readFileSync(join(here, name)));
  for (const [label, dest] of dests) {
    let copy;
    try {
      copy = normalize(readFileSync(join(dest, name)));
    } catch {
      console.error(`x missing ${label}/${name}`);
      drift += 1;
      continue;
    }
    if (copy !== canonical) {
      console.error(`x drift ${label}/${name} (run: npm run skills:sync)`);
      drift += 1;
    }
  }
}

if (drift > 0) {
  console.error(`skills-check failed: ${drift} file(s) out of sync with packages/gauntlet-skills`);
  process.exitCode = 1;
} else {
  console.info(`skills-check passed: ${files.length} skill(s) match examples + template`);
}
