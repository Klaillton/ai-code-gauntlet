import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dests = [
  join(here, "../../examples/todo/.agent/skills"),
  join(here, "../../templates/ts-node-web/.agent/skills"),
];

const files = readdirSync(here).filter((name) => name.endsWith(".md") && name !== "README.md");
for (const dest of dests) {
  mkdirSync(dest, { recursive: true });
  for (const name of files) {
    cpSync(join(here, name), join(dest, name));
  }
}
console.info(`synced ${files.length} skill(s) -> examples/todo + templates/ts-node-web`);
