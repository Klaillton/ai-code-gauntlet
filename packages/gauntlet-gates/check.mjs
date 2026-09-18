import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "src");
const dests = [
  ["examples/todo/scripts", join(here, "../../examples/todo/scripts")],
  ["templates/ts-node-web/scripts", join(here, "../../templates/ts-node-web/scripts")],
];

function normalize(buf) {
  return buf.toString("utf8").replace(/\r\n/g, "\n");
}

const files = readdirSync(srcDir).filter((name) => name.endsWith(".ts")).sort();
let drift = 0;
for (const name of files) {
  const canonical = normalize(readFileSync(join(srcDir, name)));
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
      console.error(`x drift ${label}/${name} (run: npm run gates:sync)`);
      drift += 1;
    }
  }
}

if (drift > 0) {
  console.error(`gates-check failed: ${drift} file(s) out of sync with packages/gauntlet-gates/src`);
  process.exitCode = 1;
} else {
  console.info(`gates-check passed: ${files.length} script(s) match examples + template`);
}
