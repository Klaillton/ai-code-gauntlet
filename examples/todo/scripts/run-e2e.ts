import { spawn } from "node:child_process";
import process from "node:process";

const port = Number(process.env.PORT ?? 3000);
const baseUrl = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function waitForHealth(url: string, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server not healthy at ${url}/health`);
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      GAUNTLET_E2E: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  let code = 1;
  try {
    await waitForHealth(baseUrl);
    code = await run("npx", ["cucumber-js"], {
      ...process.env,
      BASE_URL: baseUrl,
      GAUNTLET_E2E: "1",
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--import", "tsx"].filter(Boolean).join(" "),
    });
  } finally {
    if (!server.killed) {
      server.kill("SIGTERM");
    }
  }
  // Exit after finally so the e2e server is not left bound on PORT (breaks the next app).
  process.exit(code);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
