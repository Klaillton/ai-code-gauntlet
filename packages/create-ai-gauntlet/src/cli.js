import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PKG_ROOT, "../..");

function printHelp() {
  console.log(`create-ai-gauntlet — greenfield create + brownfield adopt

Usage:
  create-ai-gauntlet create <dir> [--sample todo]
  create-ai-gauntlet adopt [dir] [--gates static,unit,contract,e2e]
  create-ai-gauntlet help

Examples:
  npx create-ai-gauntlet create my-app
  npx create-ai-gauntlet create my-app --sample todo
  npx create-ai-gauntlet adopt .
  npx create-ai-gauntlet adopt . --gates static,unit
`);
}

function templatePath(sample) {
  if (sample === "todo") {
    return join(REPO_ROOT, "examples", "todo");
  }
  return join(REPO_ROOT, "templates", "ts-node-web");
}

function copyDir(src, dest, { skip = [] } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (skip.includes(entry)) continue;
    const from = join(src, entry);
    const to = join(dest, entry);
    const st = statSync(from);
    if (st.isDirectory()) {
      copyDir(from, to, { skip });
    } else {
      cpSync(from, to);
    }
  }
}

function createProject(dir, { sample } = {}) {
  const target = resolve(process.cwd(), dir);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(`Target directory is not empty: ${target}`);
  }
  const src = templatePath(sample);
  if (!existsSync(src)) {
    throw new Error(`Template not found: ${src}`);
  }
  mkdirSync(target, { recursive: true });
  copyDir(src, target, {
    skip: ["node_modules", "coverage", "dist", "playwright-report", "test-results", ".git"],
  });

  // Rename package for non-sample skeleton
  if (sample !== "todo") {
    const pkgPath = join(target, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkg.name = dir.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "my-gauntlet-app";
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    }
    const cfgPath = join(target, "gauntlet.config.json");
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      cfg.name = pkgNameFromDir(dir);
      writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
    }
  }

  console.log(`\n✅ Created ${target}`);
  console.log(`
Next:
  cd ${dir}
  npm install
  npm run prepare:browsers
  npm run verify
  npm run dev
`);
}

function pkgNameFromDir(dir) {
  return dir.replace(/\\/g, "/").split("/").filter(Boolean).pop() || "my-gauntlet-app";
}

function defaultGates(list) {
  if (!list) {
    return ["format", "lint", "typecheck", "unit"];
  }
  return list.split(",").map((s) => s.trim()).filter(Boolean);
}

function gateEnabled(id, enabledIds) {
  const aliases = {
    format: "format",
    lint: "lint",
    typecheck: "typecheck",
    static: ["format", "lint", "typecheck"],
    unit: "unit",
    contract: "contract",
    e2e: "e2e",
  };
  const expanded = new Set();
  for (const e of enabledIds) {
    const mapped = aliases[e] ?? e;
    if (Array.isArray(mapped)) mapped.forEach((x) => expanded.add(x));
    else expanded.add(mapped);
  }
  return expanded.has(id);
}

function adoptProject(dir, { gates } = {}) {
  const target = resolve(process.cwd(), dir || ".");
  if (!existsSync(target)) {
    throw new Error(`Directory not found: ${target}`);
  }

  const enabled = defaultGates(gates);
  const skeleton = templatePath(null);
  const skip = ["node_modules", "coverage", "dist", "src", "tests", "features", "e2e", "openapi", "package-lock.json"];

  // Always copy charter + skills + scripts
  for (const rel of [".agent", "scripts", "AGENTS.md"]) {
    const from = join(skeleton, rel);
    const to = join(target, rel);
    if (!existsSync(from)) continue;
    if (statSync(from).isDirectory()) {
      copyDir(from, to, { skip: [] });
    } else if (!existsSync(to)) {
      cpSync(from, to);
    } else {
      console.log(`keep existing ${rel}`);
    }
  }

  // Config files if missing
  for (const rel of [
    "eslint.config.js",
    "tsconfig.json",
    "vitest.config.ts",
    "cucumber.cjs",
    ".prettierrc",
    ".prettierignore",
  ]) {
    const from = join(skeleton, rel);
    const to = join(target, rel);
    if (existsSync(from) && !existsSync(to)) {
      cpSync(from, to);
      console.log(`+ ${rel}`);
    }
  }

  // Minimal features/e2e/openapi if missing and gates request them
  if (gateEnabled("e2e", enabled) || gateEnabled("contract", enabled)) {
    if (!existsSync(join(target, "features"))) {
      mkdirSync(join(target, "features"), { recursive: true });
      cpSync(join(skeleton, "features/health.feature"), join(target, "features/health.feature"));
      console.log("+ features/health.feature");
    }
    if (!existsSync(join(target, "e2e"))) {
      copyDir(join(skeleton, "e2e"), join(target, "e2e"));
      console.log("+ e2e/");
    }
    if (!existsSync(join(target, "openapi")) && gateEnabled("contract", enabled)) {
      copyDir(join(skeleton, "openapi"), join(target, "openapi"));
      console.log("+ openapi/");
    }
  }

  const config = {
    name: pkgNameFromDir(target),
    gates: [
      { id: "format", command: "npm", args: ["run", "format"], enabled: gateEnabled("format", enabled) },
      { id: "lint", command: "npm", args: ["run", "lint"], enabled: gateEnabled("lint", enabled) },
      { id: "typecheck", command: "npm", args: ["run", "typecheck"], enabled: gateEnabled("typecheck", enabled) },
      { id: "unit", command: "npm", args: ["run", "test:unit:coverage"], enabled: gateEnabled("unit", enabled) },
      { id: "contract", command: "npm", args: ["run", "test:contract"], enabled: gateEnabled("contract", enabled) },
      { id: "e2e", command: "npm", args: ["run", "test:e2e"], enabled: gateEnabled("e2e", enabled) },
    ],
    contract: {
      openapiPath: "openapi/openapi.yaml",
      serverEntry: "src/server.ts",
      port: 3456,
      cases: [
        {
          label: "GET /health",
          method: "GET",
          path: "/health",
          expectedStatus: 200,
          schemaPath: "/health",
          schemaMethod: "get",
          schemaStatus: "200",
        },
      ],
    },
    agent: {
      protectedGlobs: ["features/**/*.feature", "openapi/openapi.yaml"],
      maxVerifyCycles: 5,
    },
  };
  writeFileSync(join(target, "gauntlet.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  console.log("+ gauntlet.config.json");

  // Merge package.json scripts carefully
  const pkgPath = join(target, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.scripts = pkg.scripts || {};
    const desired = {
      format: "prettier --check .",
      "format:fix": "prettier --write .",
      lint: "eslint .",
      typecheck: "tsc --noEmit",
      "test:unit": pkg.scripts["test:unit"] || "vitest run",
      "test:unit:coverage": pkg.scripts["test:unit:coverage"] || "vitest run --coverage",
      "test:contract": "tsx scripts/check-openapi.ts",
      "test:e2e": "tsx scripts/run-e2e.ts",
      verify: "tsx scripts/verify.ts",
      "agent:loop": "tsx scripts/agent-loop.ts",
      "prepare:browsers": "playwright install chromium",
    };
    for (const [k, v] of Object.entries(desired)) {
      if (!pkg.scripts[k]) {
        pkg.scripts[k] = v;
        console.log(`+ package.json scripts.${k}`);
      }
    }
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  } else {
    console.log("! no package.json — copy scripts manually from templates/ts-node-web");
  }

  writeFileSync(
    join(target, "ADOPT-STATUS.md"),
    `# Gauntlet adopt status

Generated by create-ai-gauntlet adopt.

## Enabled gates
${enabled.map((g) => `- ${g}`).join("\n")}

## Checklist
- [ ] Review AGENTS.md (merge with existing rules if any)
- [ ] Align package.json scripts with real commands
- [ ] Expand openapi/features for your domain
- [ ] Run \`npm run verify\` and fix until green
- [ ] Enable more gates in gauntlet.config.json when ready
- [ ] Add CI workflow from kit (.github/workflows/verify.yml)

See kit docs: docs/ADOPT.md
`,
  );
  console.log("+ ADOPT-STATUS.md");
  console.log(`\n✅ Adopted gauntlet into ${target}`);
  console.log("Review ADOPT-STATUS.md, install missing deps, then npm run verify.");
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }

  if (cmd === "create") {
    const dir = rest.find((a) => !a.startsWith("--"));
    if (!dir) throw new Error("create requires <dir>");
    const sample = rest.includes("--sample")
      ? rest[rest.indexOf("--sample") + 1] || "todo"
      : rest.includes("--sample=todo")
        ? "todo"
        : null;
    const sampleFlag = rest.find((a) => a.startsWith("--sample"));
    let sampleName = null;
    if (sampleFlag === "--sample") {
      sampleName = rest[rest.indexOf("--sample") + 1] || "todo";
    } else if (sampleFlag?.startsWith("--sample=")) {
      sampleName = sampleFlag.split("=")[1];
    }
    createProject(dir, { sample: sampleName });
    return;
  }

  if (cmd === "adopt") {
    const dir = rest.find((a) => !a.startsWith("--")) || ".";
    const gatesIdx = rest.indexOf("--gates");
    const gates =
      gatesIdx >= 0
        ? rest[gatesIdx + 1]
        : rest.find((a) => a.startsWith("--gates="))?.split("=")[1];
    adoptProject(dir, { gates });
    return;
  }

  // Shorthand: create-ai-gauntlet my-app
  if (!cmd.startsWith("-")) {
    createProject(cmd, { sample: null });
    return;
  }

  printHelp();
  throw new Error(`Unknown command: ${cmd}`);
}
