import { spawn } from "node:child_process";
import process from "node:process";

type Step = {
  name: string;
  command: string;
  args: string[];
};

const steps: Step[] = [
  { name: "format", command: "npm", args: ["run", "format"] },
  { name: "lint", command: "npm", args: ["run", "lint"] },
  { name: "typecheck", command: "npm", args: ["run", "typecheck"] },
  { name: "unit+coverage", command: "npm", args: ["run", "test:unit:coverage"] },
  { name: "openapi-contract", command: "npm", args: ["run", "test:contract"] },
  { name: "e2e-cucumber-playwright", command: "npm", args: ["run", "test:e2e"] },
];

function runStep(step: Step): Promise<number> {
  return new Promise((resolve) => {
    console.info(`\n═══ GATE: ${step.name} ═══`);
    const child = spawn(step.command, step.args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  console.info("AI Code Gauntlet — verify pipeline");
  for (const step of steps) {
    const code = await runStep(step);
    if (code !== 0) {
      console.error(`\n✖ Gate failed: ${step.name} (exit ${code})`);
      process.exit(code);
    }
    console.info(`✓ Gate passed: ${step.name}`);
  }
  console.info("\n✅ All gates passed. Code is eligible for human exploratory check.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
