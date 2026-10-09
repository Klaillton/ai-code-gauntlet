import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";
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
  create-ai-gauntlet adopt [dir] [--gates static,unit,contract,e2e] [--stack npm|maven] [--kit-ref <sha>]
  create-ai-gauntlet help

Examples:
  npx create-ai-gauntlet create my-app
  npx create-ai-gauntlet create my-app --sample todo
  npx create-ai-gauntlet adopt .
  npx create-ai-gauntlet adopt . --gates static,unit
  npx create-ai-gauntlet adopt . --stack maven

Notes:
  adopt writes a fail-closed gauntlet.config.json matching templates/ts-node-web
  (full gate list; never enabled:false). --gates only guides scaffolding + ADOPT-STATUS.
  --stack maven (ADD-POLY S1 walking skeleton): no package.json, no scripts/ copied;
  the pinned kit runner runs compile + surefire + freshness (see ADOPT-STATUS.md).
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
      writeFileSync(full, raw.replace(/("name"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(pkgName)}`));
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
  return list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
  "spec-code",
  "adr-lint",
  "sdd-presence",
  "secrets-scan",
  "no-cheat",
  "spec-sync",
  "docs",
  "crap",
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
        protectedGlobs: [
          "features/**/*.feature",
          "openapi/openapi.yaml",
          "docs/holes-review/**/*.md",
        ],
        maxVerifyCycles: 5,
      },
    };
  }

  config.name = name;
  // ADD-POLY: fail-closed stack (template ships "npm"; older templates may not).
  if (!config.stack) {
    config = { name, stack: "npm", ...config };
  }
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
    "spec-code": { id: "spec-code", command: "npm", args: ["run", "spec-code"] },
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
      defaults["spec-code"],
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
    ensureGate(config.gates, defaults["spec-code"], "holes-review");
    ensureGate(config.gates, defaults["adr-lint"], "spec-code");
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
      protectedGlobs: [
        "features/**/*.feature",
        "openapi/openapi.yaml",
        "docs/holes-review/**/*.md",
      ],
      maxVerifyCycles: 5,
    };
  }
  if (!config.adrLint) {
    config.adrLint = { glob: "docs/adr/**/*.md" };
  }
  if (config.allowSpecCodeSkip === undefined) {
    config.allowSpecCodeSkip = false;
  }
  if (!config.specCode) {
    config.specCode = { implementationGlobs: ["src/**"] };
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
    "policy-base-report.json",
    "holes-review-report.json",
    "adr-lint-report.json",
    "sdd-presence-report.json",
    "spec-code-report.json",
    "mutation-report.json",
    "gherkin-mutation-report.json",
    "complexity-report.json",
    "arch-bound-report.json",
    "crap-report.json",
    "deps-lock-report.json",
    "secrets-scan-report.json",
    "maven-report.json",
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
        throw new Error(`adopt failed (D15): missing ${rel} and template has no copy to install`);
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

export const ADOPT_STACKS = ["npm", "maven"];

/**
 * ADD-POLY S1: maven walking skeleton. The consumer gets config + agent docs only; the kit
 * runner (pinned checkout) owns every command. No package.json, no scripts/ in the consumer.
 */
export const L0_GATE_IDS = [
  "protect-specs",
  "holes-review",
  "spec-code",
  "adr-lint",
  "sdd-presence",
  "secrets-scan",
  "spec-sync",
];

/** gauntlet-gates spec-code DEFAULT_SPEC_GLOBS (build files excluded on purpose). */
const SPEC_GLOBS = [
  "features/**/*.feature",
  "openapi/openapi.yaml",
  "openapi/**/*.yaml",
  "openapi/**/*.yml",
  "docs/holes-review/**/*.md",
];

/** Drops XML comments by scanning (no regex); an unclosed comment drops the rest. */
function stripXmlComments(xml) {
  let out = "";
  let from = 0;
  for (;;) {
    const open = xml.indexOf("<!--", from);
    if (open === -1) return out + xml.slice(from);
    out += xml.slice(from, open);
    const close = xml.indexOf("-->", open + 4);
    if (close === -1) return out;
    from = close + 3;
  }
}

/** Reactor module dirs from pom.xml <modules> (recursive), relative to the root. */
export function mavenModuleDirs(root, dir = "") {
  const pom = join(root, dir, "pom.xml");
  if (!existsSync(pom)) return [];
  const xml = stripXmlComments(readFileSync(pom, "utf8"));
  const out = [];
  for (const match of xml.matchAll(/<module>([^<]*)<\/module>/g)) {
    const child = [dir, (match[1] ?? "").trim()].filter(Boolean).join("/");
    out.push(child, ...mavenModuleDirs(root, child));
  }
  return out;
}

/** Absolute git from PATH (a bare "git" is a PATH lookup at exec time, Sonar S4036). */
function gitBinary() {
  const name = process.platform === "win32" ? "git.exe" : "git";
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, name))) return join(dir, name);
  }
  return name;
}

/** Kit commit the consumer pins: --kit-ref, else this kit checkout's HEAD. 40-hex or FAIL. */
function resolveKitRef(explicit) {
  let ref = explicit;
  if (!ref) {
    try {
      ref = execFileSync(gitBinary(), ["rev-parse", "HEAD"], {
        cwd: kitRoot(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      ref = "";
    }
  }
  if (!/^[0-9a-f]{40}$/.test(ref)) {
    throw new Error(
      "adopt --stack maven: cannot pin the kit (pass --kit-ref <40-hex commit SHA>; fail closed)",
    );
  }
  return ref;
}

/** Base-run policy-base workflow for the consumer (same hardening as the kit's own). */
function writePolicyWorkflow(target, kitRef) {
  const to = join(target, ".github", "workflows", "policy-base.yml");
  if (existsSync(to)) {
    console.log("! keep existing .github/workflows/policy-base.yml (compare with the kit's)");
    return;
  }
  const template = readFileSync(join(__dirname, "maven-policy-base.yml"), "utf8");
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, template.replace("__KIT_SHA__", kitRef));
  console.log(`+ .github/workflows/policy-base.yml (pinned kit ${kitRef})`);
}

function adoptMaven(target, { kitRef: explicitRef } = {}) {
  if (!existsSync(join(target, "pom.xml"))) {
    throw new Error(`adopt --stack maven: ${join(target, "pom.xml")} not found (fail closed)`);
  }
  if (existsSync(join(target, "package.json"))) {
    throw new Error(
      "adopt --stack maven: package.json is also present; S1 supports one stack per tree (fail closed)",
    );
  }
  const kitRef = resolveKitRef(explicitRef);
  const skeleton = templatePath(null);
  for (const [rel, from] of [
    [".agent", join(skeleton, ".agent")],
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
  if (existsSync(skillsFrom)) {
    copyDir(skillsFrom, join(target, ".agent", "skills"), { skip: [] });
    console.log("+ .agent/skills/ (canonical)");
  }
  ensureSddPresenceDocs(target, skeleton);
  mergeGitignore(target, skeleton);

  const modules = mavenModuleDirs(target);
  const rootPom = stripXmlComments(readFileSync(join(target, "pom.xml"), "utf8"));
  const rootIsAggregator = /<packaging>\s*pom\s*<\/packaging>/.test(
    rootPom.replace(/<parent>[^]*?<\/parent>/g, ""),
  );
  const implementationGlobs = [
    ...(rootIsAggregator ? [] : ["src/main/**"]),
    ...modules.map((dir) => `${dir}/src/main/**`),
  ];
  const configPath = join(target, "gauntlet.config.json");
  const config = {
    name: pkgNameFromDir(target),
    stack: "maven",
    strictness: "strict",
    allowSpecEdit: false,
    allowDepsEdit: false,
    // L0 core (ids only; the pinned runner owns every command). Missing one = FAIL.
    gates: L0_GATE_IDS.map((id) => ({ id })),
    agent: {
      // Maven build files are NOT listed: policy-base protects them (policy-change-approved
      // only); listing them here would also demand specs-approved. l0-config enforces both.
      protectedGlobs: [
        "features/**/*.feature",
        "openapi/openapi.yaml",
        "docs/holes-review/**/*.md",
      ],
    },
    allowHolesReviewSkip: false,
    holesReview: { implementationGlobs, artifactGlob: "docs/holes-review/**/*.md" },
    adrLint: { glob: "docs/adr/**/*.md" },
    allowSpecCodeSkip: false,
    // specGlobs pinned so a pom/.mvn touch never counts as the spec half of spec-code.
    specCode: { implementationGlobs, specGlobs: SPEC_GLOBS },
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log("+ gauntlet.config.json (stack: maven, L0 gate ids, runner-owned commands)");

  writePolicyWorkflow(target, kitRef);

  writeFileSync(
    join(target, "ADOPT-STATUS.md"),
    `# Gauntlet adopt status (stack: maven, ADD-POLY S1)

Generated by \`create-ai-gauntlet adopt --stack maven\`. Pinned kit: \`${kitRef}\`.

## How it runs
No package.json and no scripts/ in this repo. The kit is a pinned runner:

\`\`\`bash
git clone https://github.com/Klaillton/ai-code-gauntlet kit && git -C kit checkout ${kitRef}
npm ci --prefix kit/packages/gauntlet-gates --ignore-scripts
node kit/packages/gauntlet-gates/run.mjs --root .
\`\`\`

Needs JDK 21, Maven (\`mvn\` on PATH) and git with \`origin/main\` fetched.

## What S1 checks (fail closed)
- policy-base (built-in): gauntlet.config.json policy comes from the base branch. The
  authoritative copy is \`.github/workflows/policy-base.yml\` (base-run, pinned kit).
- stack: \`stack\` must be \`maven\` and pom.xml must be the only build file.
- l0-config: every L0 gate id must be in \`gates[]\` (${L0_GATE_IDS.join(", ")}).
- L0 gates, run from the pinned kit: protect-specs, holes-review, spec-code, adr-lint,
  sdd-presence, secrets-scan, spec-sync \`--l0\` (D11 Gherkin edge inventory + D13 OpenAPI vs
  contract.cases; both skip when features/ or openapi/ are absent).
- pom guard: skips, filters, report/output redirects and pom-owned thresholds are FAIL.
- Build files are protected as whole files by policy-base (\`**/pom.xml\`, \`.mvn/**\`,
  \`mvnw\`, \`mvnw.cmd\`): any change needs \`policy-change-approved\` only. In S2 the semantic
  pom diff splits dependency changes (\`deps-approved\`) from policy changes.
- l0-config also FAILs when a reactor module's \`src/main/**\` is not covered by
  \`holesReview\`/\`specCode\` implementationGlobs: adding a module means adding its glob
  (a policy change).
- One reactor run in a tmp copy outside the workspace: \`process-test-classes\` + the pinned
  surefire coordinate, with a core-chosen \`-Dmaven.repo.local\`.
- Every jar module needs a surefire report; total tests == 0 is FAIL; reports must match the
  compiled test classes of the same module; failed, errored or skipped tests are FAIL.

## Not yet (S2-S4)
JaCoCo coverage, no-cheat Java, semantic pom diff, PIT, CRAP, ArchUnit,
Cucumber/Testcontainers, openapi-diff, Gradle. gitleaks history scan is not in the runner.

## Checklist
- [ ] Commit gauntlet.config.json and .github/workflows/policy-base.yml on main first
- [ ] Make \`policy-base (base-run, PR)\` a required status check
- [ ] Review AGENTS.md
- [ ] Confirm \`docs/sdd/Security.md\` and \`docs/sdd/Observability.md\` (D15)
- [ ] CI verify: copy the \`maven-skeleton\` job idea from the kit's .github/workflows/verify.yml
`,
  );
  console.log("+ ADOPT-STATUS.md");
  console.log(`\n✅ Adopted gauntlet (stack: maven, S1 skeleton) into ${target}`);
}

/** ADD-POLY: validate --stack and dispatch; npm keeps the original adopt path. */
function adoptStack(dir, { gates, stack, kitRef }) {
  if (!ADOPT_STACKS.includes(stack)) {
    throw new Error(
      `adopt --stack ${stack}: not supported (S1: ${ADOPT_STACKS.join(", ")}; gradle comes later)`,
    );
  }
  if (stack !== "maven") {
    adoptProject(dir, { gates });
    return;
  }
  const target = resolve(process.cwd(), dir || ".");
  if (!existsSync(target)) {
    throw new Error(`Directory not found: ${target}`);
  }
  adoptMaven(target, { kitRef });
}

/** `adopt [dir] [--gates a,b] [--stack npm|maven]` */
function parseAdoptArgs(rest) {
  const valued = new Set(["--gates", "--stack", "--kit-ref"]);
  const dir = rest.find((a, i) => !a.startsWith("--") && !valued.has(rest[i - 1])) || ".";
  const flag = (name) => {
    const idx = rest.indexOf(`--${name}`);
    if (idx >= 0) return rest[idx + 1] ?? "";
    return rest.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  };
  const stack = flag("stack") ?? "npm";
  if (!stack) throw new Error("--stack requires a value (npm | maven)");
  return { dir, gates: flag("gates"), stack, kitRef: flag("kit-ref") };
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
      "spec-code": "tsx scripts/spec-code.ts",
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
- [ ] CHANGE-3: implementation PRs must also touch Gherkin/OpenAPI/holes-review (or \`SPEC_SYNC_APPROVED\` / label \`spec-sync-approved\`)
- [ ] Expand openapi/features for your domain
- [ ] Run \`npm run docs:generate\` then \`npm run verify\` until green
- [ ] Use human grants for protected edits (see docs/ADOPT.md): \`specs-approved\`, \`deps-approved\`, \`ALLOW_SPEC_EDIT\`, \`ALLOW_DEPS_EDIT\`
- [ ] Add CI workflow from kit (.github/workflows/verify.yml)
- [ ] CHANGE-4: add the base-run enforcer from kit (.github/workflows/policy-base.yml, pull_request_target) and make it a required status check (protects config policy, scripts/**, test/tsconfig/eslint configs, .github/**)

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
    const args = parseAdoptArgs(rest);
    adoptStack(args.dir, args);
    return;
  }

  if (!cmd.startsWith("-")) {
    createProject(cmd, { sample: null });
    return;
  }

  printHelp();
  throw new Error(`Unknown command: ${cmd}`);
}
