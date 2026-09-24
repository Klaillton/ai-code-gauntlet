import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

/** Monorepo clone, or a packed CLI that still ships templates/ + packages/gauntlet-gates. */
export function findKitRoot(from = PKG_ROOT) {
  const candidates = [resolve(from, "../.."), resolve(from, ".."), from, join(from, "kit")];
  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, "templates", "ts-node-web")) &&
      existsSync(join(candidate, "packages", "gauntlet-gates", "src"))
    ) {
      return candidate;
    }
  }
  throw new Error(
    "AI Code Gauntlet kit root not found (need templates/ts-node-web and packages/gauntlet-gates). Run from the kit clone.",
  );
}

function kitRoot() {
  return findKitRoot();
}

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

Notes:
  adopt writes a fail-closed gauntlet.config.json matching templates/ts-node-web
  (full gate list; never enabled:false). --gates only guides scaffolding + ADOPT-STATUS.
`);
}

function templatePath(sample) {
  const root = kitRoot();
  if (sample === "todo") {
    return join(root, "examples", "todo");
  }
  return join(root, "templates", "ts-node-web");
}

function gatesSrc() {
  return join(kitRoot(), "packages", "gauntlet-gates", "src");
}

function skillsSrc() {
  const packaged = join(kitRoot(), "packages", "gauntlet-skills");
  if (existsSync(packaged)) {
    return packaged;
  }
  return join(templatePath(null), ".agent", "skills");
}

export const CREATE_SKIP = [
  "node_modules",
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
  ".git",
  ".cucumber-js",
];

function skipCreateEntry(name) {
  if (CREATE_SKIP.includes(name)) {
    return true;
  }
  return name.endsWith("-report.json");
}

function copyDir(src, dest, { skip = [] } = {}) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (skip.includes(entry) || skipCreateEntry(entry)) continue;
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
  copyDir(src, target, { skip: CREATE_SKIP });

  if (sample !== "todo") {
    const pkgName = pkgNameFromDir(dir);
    for (const rel of ["package.json", "gauntlet.config.json"]) {
      const full = join(target, rel);
      if (!existsSync(full)) {
        continue;
      }
      const raw = readFileSync(full, "utf8");
      writeFileSync(
        full,
        raw.replace(/("name"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(pkgName)}`),
      );
    }
    // Keep committed D7 docs honest after the name patch (no npm install yet).
    const gauntletMd = join(target, "docs/generated/gauntlet.md");
    if (existsSync(gauntletMd)) {
      const md = readFileSync(gauntletMd, "utf8");
      writeFileSync(gauntletMd, md.replace(/^- \*\*App:\*\* .*$/m, `- **App:** ${pkgName}`));
    }
  }

  console.log(`\n✅ Created ${target}`);
  console.log(`
Next:
  cd ${dir}
  git init && git add -A && git commit -m "chore: initial commit"
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

const HARDENING_GATE_IDS = [
  "complexity",
  "arch-bound",
  "protect-specs",
  "holes-review",
  "adr-lint",
  "sdd-presence",
  "secrets-scan",
  "no-cheat",
  "spec-sync",
  "docs",
];

function stripEnabledFlags(gates) {
  for (const gate of gates) {
    if (Object.prototype.hasOwnProperty.call(gate, "enabled")) {
      delete gate.enabled;
    }
  }
  return gates;
}

function ensureGate(gates, gate, afterId) {
  if (gates.some((g) => g.id === gate.id)) return gates;
  const idx = afterId ? gates.findIndex((g) => g.id === afterId) : -1;
  if (idx >= 0) {
    gates.splice(idx + 1, 0, gate);
  } else {
    gates.push(gate);
  }
  return gates;
}

/**
 * Prefer templates/ts-node-web gauntlet.config.json as source of truth.
 * Always ensure hardening gates; add deps-lock only when template ships the script.
 * Never write enabled:false (verify + D9 fail-closed).
 */
function buildAdoptConfig(name, skeleton) {
  const templateCfgPath = join(skeleton, "gauntlet.config.json");
  const hasDepsLock = existsSync(join(gatesSrc(), "deps-lock.ts"));

  let config;
  if (existsSync(templateCfgPath)) {
    config = JSON.parse(readFileSync(templateCfgPath, "utf8"));
  } else {
    config = {
      strictness: "lenient",
      allowSpecEdit: false,
      gates: [],
      allowlist: [],
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
        protectedGlobs: ["features/**/*.feature", "openapi/openapi.yaml", "docs/holes-review/**/*.md"],
        maxVerifyCycles: 5,
      },
    };
  }

  config.name = name;
  if (config.allowSpecEdit === undefined) config.allowSpecEdit = false;
  if (!config.strictness) config.strictness = "lenient";
  config.gates = Array.isArray(config.gates) ? [...config.gates] : [];

  const defaults = {
    format: { id: "format", command: "npm", args: ["run", "format"] },
    lint: { id: "lint", command: "npm", args: ["run", "lint"] },
    typecheck: { id: "typecheck", command: "npm", args: ["run", "typecheck"] },
    complexity: { id: "complexity", command: "npm", args: ["run", "complexity"] },
    "arch-bound": { id: "arch-bound", command: "npm", args: ["run", "arch-bound"] },
    "protect-specs": { id: "protect-specs", command: "npm", args: ["run", "protect-specs"] },
    "holes-review": { id: "holes-review", command: "npm", args: ["run", "holes-review"] },
    "adr-lint": { id: "adr-lint", command: "npm", args: ["run", "adr-lint"] },
    "sdd-presence": { id: "sdd-presence", command: "npm", args: ["run", "sdd-presence"] },
    "deps-lock": { id: "deps-lock", command: "npm", args: ["run", "deps-lock"] },
    "secrets-scan": { id: "secrets-scan", command: "npm", args: ["run", "secrets-scan"] },
    "no-cheat": { id: "no-cheat", command: "npm", args: ["run", "no-cheat"] },
    "spec-sync": { id: "spec-sync", command: "npm", args: ["run", "spec-sync"] },
    docs: { id: "docs", command: "npm", args: ["run", "docs:check"] },
    unit: { id: "unit", command: "npm", args: ["run", "test:unit:coverage"] },
    crap: { id: "crap", command: "npm", args: ["run", "crap"] },
    mutation: { id: "mutation", command: "npm", args: ["run", "test:mutation"] },
    contract: { id: "contract", command: "npm", args: ["run", "test:contract"] },
    e2e: { id: "e2e", command: "npm", args: ["run", "test:e2e"] },
    "gherkin-mutation": {
      id: "gherkin-mutation",
      command: "npm",
      args: ["run", "gherkin-mutation"],
    },
  };

  // If template had no/empty gates, seed the full current list
  if (config.gates.length === 0) {
    config.gates = [
      defaults.format,
      defaults.lint,
      defaults.typecheck,
      defaults.complexity,
      defaults["arch-bound"],
      defaults["protect-specs"],
      ...(hasDepsLock ? [defaults["deps-lock"]] : []),
      defaults["holes-review"],
      defaults["adr-lint"],
      defaults["sdd-presence"],
      defaults["secrets-scan"],
      defaults["no-cheat"],
      defaults["spec-sync"],
      defaults.docs,
      defaults.unit,
      defaults.crap,
      defaults.mutation,
      defaults.contract,
      defaults.e2e,
      defaults["gherkin-mutation"],
    ];
  } else {
    // Ensure baseline + hardening gates exist; preserve template order/extras
    ensureGate(config.gates, defaults.format);
    ensureGate(config.gates, defaults.lint, "format");
    ensureGate(config.gates, defaults.typecheck, "lint");
    ensureGate(config.gates, defaults.complexity, "typecheck");
    ensureGate(config.gates, defaults["arch-bound"], "complexity");
    ensureGate(config.gates, defaults["protect-specs"], "arch-bound");
    if (hasDepsLock) {
      ensureGate(config.gates, defaults["deps-lock"], "protect-specs");
      ensureGate(config.gates, defaults["holes-review"], "deps-lock");
    } else {
      config.gates = config.gates.filter((g) => g.id !== "deps-lock");
      ensureGate(config.gates, defaults["holes-review"], "protect-specs");
    }
    ensureGate(config.gates, defaults["adr-lint"], "holes-review");
    ensureGate(config.gates, defaults["sdd-presence"], "adr-lint");
    ensureGate(config.gates, defaults["secrets-scan"], "sdd-presence");
    ensureGate(config.gates, defaults["no-cheat"], "secrets-scan");
    ensureGate(config.gates, defaults["spec-sync"], "no-cheat");
    ensureGate(config.gates, defaults.docs, "spec-sync");
    ensureGate(config.gates, defaults.unit, "docs");
    ensureGate(config.gates, defaults.crap, "unit");
    ensureGate(config.gates, defaults.mutation, "crap");
    ensureGate(config.gates, defaults.contract, "mutation");
    ensureGate(config.gates, defaults.e2e, "contract");
    ensureGate(config.gates, defaults["gherkin-mutation"], "e2e");
  }

  if (hasDepsLock && config.allowDepsEdit === undefined) {
    config.allowDepsEdit = false;
  }

  stripEnabledFlags(config.gates);

  if (!config.agent) {
    config.agent = {
      protectedGlobs: ["features/**/*.feature", "openapi/openapi.yaml", "docs/holes-review/**/*.md"],
      maxVerifyCycles: 5,
    };
  }
  if (!config.adrLint) {
    config.adrLint = { glob: "docs/adr/**/*.md" };
  }
  if (!config.contract) {
    config.contract = {
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
    };
  }

  return { config, hasDepsLock };
}

function mergeGitignore(target, skeleton) {
  const from = join(skeleton, ".gitignore");
  const to = join(target, ".gitignore");
  const needed = [
    "gauntlet-report.json",
    "spec-sync-report.json",
    "no-cheat-report.json",
    "protect-specs-report.json",
    "holes-review-report.json",
    "adr-lint-report.json",
    "sdd-presence-report.json",
    "mutation-report.json",
    "gherkin-mutation-report.json",
    "complexity-report.json",
    "arch-bound-report.json",
    "crap-report.json",
    "deps-lock-report.json",
    "secrets-scan-report.json",
    ".gauntlet/allow-spec-edit",
    ".gauntlet/allow-deps-edit",
    ".gauntlet/allow-secrets-paths",
  ];
  if (!existsSync(to)) {
    if (existsSync(from)) {
      cpSync(from, to);
      console.log("+ .gitignore");
    } else {
      writeFileSync(to, `${needed.join("\n")}\n`);
      console.log("+ .gitignore");
      return;
    }
  }
  const existing = readFileSync(to, "utf8");
  const existingLines = new Set(existing.split(/\r?\n/));
  const lines = needed.filter((line) => !existingLines.has(line));
  if (lines.length) {
    const prefix = existing.length && !existing.endsWith("\n") ? "\n" : "";
    appendFileSync(to, `${prefix}${lines.join("\n")}\n`);
    console.log(`+ .gitignore entries (${lines.length})`);
  }
}


const SDD_PRESENCE_DOCS = ["docs/sdd/Security.md", "docs/sdd/Observability.md"];

function sddPresenceDocOk(markdown) {
  const text = String(markdown || "").replace(/^\uFEFF/, "");
  if (text.trim().length === 0) return false;
  const hasHeading = /^#{1,6}\s+\S/m.test(text);
  const hasRequirement = /^\s*(?:[-*+]|\d+\.)\s+\S/m.test(text);
  return hasHeading && hasRequirement;
}

/**
 * D15: adopt requires Security.md + Observability.md (same as greenfield)
 * unless the written config will set sdd:false (template never does).
 * Copies from skeleton when missing; fails adopt if still invalid.
 */
function ensureSddPresenceDocs(target, skeleton) {
  for (const rel of SDD_PRESENCE_DOCS) {
    const to = join(target, rel);
    const from = join(skeleton, rel);
    if (!existsSync(to)) {
      if (!existsSync(from)) {
        throw new Error(
          `adopt failed (D15): missing ${rel} and template has no copy to install`,
        );
      }
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
      console.log(`+ ${rel}`);
    }
  }
  for (const rel of SDD_PRESENCE_DOCS) {
    const full = join(target, rel);
    const body = readFileSync(full, "utf8");
    if (!sddPresenceDocOk(body)) {
      throw new Error(
        `adopt failed (D15): ${rel} must have a markdown heading and ≥1 requirement list item`,
      );
    }
  }
}

function adoptProject(dir, { gates } = {}) {
  const target = resolve(process.cwd(), dir || ".");
  if (!existsSync(target)) {
    throw new Error(`Directory not found: ${target}`);
  }

  const enabled = defaultGates(gates);
  const skeleton = templatePath(null);

  const scriptsFrom = existsSync(gatesSrc()) ? gatesSrc() : join(skeleton, "scripts");
  for (const [rel, from] of [
    [".agent", join(skeleton, ".agent")],
    ["scripts", scriptsFrom],
    ["AGENTS.md", join(skeleton, "AGENTS.md")],
  ]) {
    const to = join(target, rel);
    if (!existsSync(from)) continue;
    if (statSync(from).isDirectory()) {
      copyDir(from, to, { skip: [] });
      console.log(`+ ${rel}/`);
    } else if (!existsSync(to)) {
      cpSync(from, to);
      console.log(`+ ${rel}`);
    } else {
      console.log(`keep existing ${rel}`);
    }
  }

  const skillsFrom = skillsSrc();
  const skillsTo = join(target, ".agent", "skills");
  if (existsSync(skillsFrom)) {
    copyDir(skillsFrom, skillsTo, { skip: [] });
    console.log("+ .agent/skills/ (canonical)");
  }

  const docsGenFrom = join(skeleton, "docs");
  const docsGenTo = join(target, "docs");
  if (existsSync(docsGenFrom) && !existsSync(join(docsGenTo, "generated"))) {
    copyDir(docsGenFrom, docsGenTo, { skip: [] });
    console.log("+ docs/ (generated baseline)");
  }

  ensureSddPresenceDocs(target, skeleton);

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

  mergeGitignore(target, skeleton);

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

  const { config, hasDepsLock } = buildAdoptConfig(pkgNameFromDir(target), skeleton);
  writeFileSync(join(target, "gauntlet.config.json"), `${JSON.stringify(config, null, 2)}\n`);
  console.log("+ gauntlet.config.json (template-aligned, fail-closed)");
  if (hasDepsLock) {
    console.log("  (includes deps-lock — template ships scripts/deps-lock.ts)");
  } else {
    console.log("  (deps-lock omitted — template has no scripts/deps-lock.ts)");
  }

  const pkgPath = join(target, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.scripts = pkg.scripts || {};
    const desired = {
      format: "prettier --check .",
      "format:fix": "prettier --write .",
      lint: "eslint .",
      typecheck: "tsc --noEmit",
      complexity: "tsx scripts/complexity.ts",
      "arch-bound": "tsx scripts/arch-bound.ts",
      crap: "tsx scripts/crap.ts",
      "test:mutation": "tsx scripts/mutation.ts",
      "gherkin-mutation": "tsx scripts/gherkin-mutation.ts",
      "test:unit": pkg.scripts["test:unit"] || "vitest run",
      "test:unit:coverage": pkg.scripts["test:unit:coverage"] || "vitest run --coverage",
      "test:contract": "tsx scripts/check-openapi.ts",
      "test:e2e": "tsx scripts/run-e2e.ts",
      "spec-sync": "tsx scripts/spec-sync.ts",
      "no-cheat": "tsx scripts/no-cheat.ts",
      "protect-specs": "tsx scripts/protect-specs.ts",
      "holes-review": "tsx scripts/holes-review.ts",
      "adr-lint": "tsx scripts/adr-lint.ts",
      "sdd-presence": "tsx scripts/sdd-presence.ts",
      "secrets-scan": "tsx scripts/secrets-scan.ts",
      "docs:generate": "tsx scripts/generate-docs.ts",
      "docs:check": "tsx scripts/check-docs-fresh.ts",
      verify: "tsx scripts/verify.ts",
      "agent:loop": "tsx scripts/agent-loop.ts",
      "prepare:browsers": "playwright install chromium",
    };
    if (hasDepsLock || existsSync(join(target, "scripts", "deps-lock.ts"))) {
      desired["deps-lock"] = "tsx scripts/deps-lock.ts";
    }
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

  const hardeningList = HARDENING_GATE_IDS.concat(
    hasDepsLock || existsSync(join(target, "scripts", "deps-lock.ts")) ? ["deps-lock"] : [],
  );

  writeFileSync(
    join(target, "ADOPT-STATUS.md"),
    `# Gauntlet adopt status

Generated by create-ai-gauntlet adopt.

## Scaffold intent (--gates)
${enabled.map((g) => `- ${g}`).join("\n")}

## Config gates (fail-closed)
All gates in \`gauntlet.config.json\` run on \`npm run verify\`.
**Do not** set \`enabled: false\` — verify and no-cheat (D9) fail closed.

Hardening gates always wired: ${hardeningList.join(", ")}.

## Checklist
- [ ] Review AGENTS.md (merge with existing rules if any)
- [ ] Align package.json scripts with real commands
- [ ] Confirm \`docs/sdd/Security.md\` and \`docs/sdd/Observability.md\` (D15) — heading + ≥1 requirement each (or set \`sdd: false\`)
- [ ] Expand openapi/features for your domain
- [ ] Run \`npm run docs:generate\` then \`npm run verify\` until green
- [ ] Use human grants for protected edits (see docs/ADOPT.md): \`specs-approved\`, \`deps-approved\`, \`ALLOW_SPEC_EDIT\`, \`ALLOW_DEPS_EDIT\`
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

  if (!cmd.startsWith("-")) {
    createProject(cmd, { sample: null });
    return;
  }

  printHelp();
  throw new Error(`Unknown command: ${cmd}`);
}
