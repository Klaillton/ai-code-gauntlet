import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import yaml from "js-yaml";

type JsonSchema = Record<string, unknown>;

type OpenApiDoc = {
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<
          string,
          {
            content?: Record<string, { schema?: JsonSchema }>;
          }
        >;
      }
    >
  >;
  components?: {
    schemas?: Record<string, JsonSchema>;
  };
};

type ContractCase = {
  label: string;
  method: string;
  path: string;
  body?: unknown;
  expectedStatus: number;
  schemaPath: string;
  schemaMethod: string;
  schemaStatus: string;
  save?: { as: string; from: string };
};

type GauntletConfig = {
  contract?: {
    openapiPath?: string;
    serverEntry?: string;
    port?: number;
    cases?: ContractCase[];
  };
};

function loadConfig(): GauntletConfig {
  return JSON.parse(readFileSync(resolve("gauntlet.config.json"), "utf8")) as GauntletConfig;
}

function loadOpenApi(openapiPath: string): OpenApiDoc {
  const raw = readFileSync(resolve(openapiPath), "utf8");
  return yaml.load(raw) as OpenApiDoc;
}

function inlineRefs(doc: OpenApiDoc, schema: unknown, seen = new Set<string>()): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => inlineRefs(doc, item, seen));
  }
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const record = schema as JsonSchema;
  if (typeof record.$ref === "string") {
    const ref = record.$ref;
    const prefix = "#/components/schemas/";
    if (!ref.startsWith(prefix)) {
      throw new Error(`Unsupported $ref: ${ref}`);
    }
    if (seen.has(ref)) {
      return {};
    }
    const name = ref.slice(prefix.length);
    const target = doc.components?.schemas?.[name];
    if (!target) {
      throw new Error(`Missing schema component: ${name}`);
    }
    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    return inlineRefs(doc, target, nextSeen);
  }

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = inlineRefs(doc, value, seen);
  }
  return out;
}

function responseSchema(
  doc: OpenApiDoc,
  pathKey: string,
  method: string,
  status: string,
): JsonSchema {
  const schema =
    doc.paths[pathKey]?.[method]?.responses?.[status]?.content?.["application/json"]?.schema;
  if (!schema) {
    throw new Error(`Missing schema for ${method.toUpperCase()} ${pathKey} ${status}`);
  }
  return inlineRefs(doc, schema) as JsonSchema;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      throw new Error(`Missing template var: ${key}`);
    }
    return value;
  });
}

function startServer(
  serverEntry: string,
  port: number,
): Promise<{ stop: () => Promise<void>; baseUrl: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", serverEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      GAUNTLET_E2E: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  return new Promise((resolveStart, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error("Server did not become ready in time"));
      }
    }, 15_000);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text.includes("listening") && !settled) {
        settled = true;
        clearTimeout(timeout);
        setTimeout(() => {
          resolveStart({
            baseUrl,
            stop: async () => {
              if (!child.killed) {
                child.kill("SIGTERM");
              }
            },
          });
        }, 200);
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Server exited early with code ${code}`));
      }
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const contract = config.contract;
  if (!contract?.cases?.length) {
    throw new Error("gauntlet.config.json: contract.cases is required");
  }

  const openapiPath = contract.openapiPath ?? "openapi/openapi.yaml";
  const serverEntry = contract.serverEntry ?? "src/server.ts";
  const port = contract.port ?? 3456;
  const doc = loadOpenApi(openapiPath);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AjvCtor = (Ajv as any).default ?? Ajv;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addFormatsFn = (addFormats as any).default ?? addFormats;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  addFormatsFn(ajv);

  const server = await startServer(serverEntry, port);
  const failures: string[] = [];
  const vars: Record<string, string> = {};

  try {
    for (const testCase of contract.cases) {
      const path = interpolate(testCase.path, vars);
      const init: RequestInit = { method: testCase.method };
      if (testCase.body !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(testCase.body);
      }
      const res = await fetch(`${server.baseUrl}${path}`, init);
      const body = await res.json();
      const schema = responseSchema(
        doc,
        testCase.schemaPath,
        testCase.schemaMethod,
        testCase.schemaStatus,
      );
      const validate = ajv.compile(schema);
      if (res.status !== testCase.expectedStatus || !validate(body)) {
        failures.push(
          `${testCase.label} failed: status=${res.status} expected=${testCase.expectedStatus} errors=${JSON.stringify(validate.errors)} body=${JSON.stringify(body)}`,
        );
      } else {
        console.info(`✓ ${testCase.label}`);
        if (testCase.save && body && typeof body === "object") {
          const value = (body as Record<string, unknown>)[testCase.save.from];
          if (typeof value === "string") {
            vars[testCase.save.as] = value;
          }
        }
      }
    }
  } finally {
    await server.stop();
  }

  if (failures.length > 0) {
    console.error("OpenAPI contract checks failed:");
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.info("All OpenAPI contract checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
