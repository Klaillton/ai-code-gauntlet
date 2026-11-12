import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintSkill } from "./lint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dests = [
  [
    "examples/todo/.agent/skills",
    join(here, "../../examples/todo/.agent/skills"),
  ],
  [
    "templates/ts-node-web/.agent/skills",
    join(here, "../../templates/ts-node-web/.agent/skills"),
  ],
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

// skills-lint: no canonical skill may instruct a gate bypass (see README.md for the rule).
let findings = 0;
for (const name of files) {
  for (const f of lintSkill(readFileSync(join(here, name), "utf8"))) {
    console.error(`x lint ${name}:${f.line} [${f.rule}] ${f.why}: ${f.text}`);
    findings += 1;
  }
}

// The linter's adversarial unit tests run with every skills:check (local verify and CI).
const selfTest = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=dot", join(here, "lint.test.mjs")],
  {
    encoding: "utf8",
  },
);
if (selfTest.status !== 0) {
  console.error(selfTest.stdout, selfTest.stderr);
  console.error(
    "x lint self-test failed (packages/gauntlet-skills/lint.test.mjs)",
  );
}

if (drift > 0 || findings > 0 || selfTest.status !== 0) {
  console.error(
    `skills-check failed: ${drift} file(s) out of sync, ${findings} lint finding(s), self-test ${selfTest.status === 0 ? "ok" : "red"}`,
  );
  process.exitCode = 1;
} else {
  console.info(
    `skills-check passed: ${files.length} skill(s) match examples + template, 0 lint findings, lint self-test green`,
  );
}
