import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "src");
const dests = [
  join(here, "../../examples/todo/scripts"),
  join(here, "../../templates/ts-node-web/scripts"),
];

const files = readdirSync(srcDir).filter((name) => name.endsWith(".ts"));
for (const dest of dests) {
  mkdirSync(dest, { recursive: true });
  for (const name of files) {
    cpSync(join(srcDir, name), join(dest, name));
  }
}
console.info(`synced ${files.length} gate script(s) -> examples/todo + templates/ts-node-web`);
