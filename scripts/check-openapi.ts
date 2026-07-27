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

function loadOpenApi(): OpenApiDoc {
  const path = resolve("openapi/openapi.yaml");
  const raw = readFileSync(path, "utf8");
  return yaml.load(raw) as OpenApiDoc;
}

/** Deep-clone schema and inline OpenAPI component $refs. */
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

function startServer(): Promise<{ stop: () => Promise<void>; baseUrl: string }> {
  const port = 3456;
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
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

    const onData = async (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text.includes("listening") && !settled) {
        settled = true;
        clearTimeout(timeout);
        await new Promise((r) => setTimeout(r, 200));
        resolveStart({
          baseUrl,
          stop: async () => {
            if (!child.killed) {
              child.kill("SIGTERM");
            }
          },
        });
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
  const doc = loadOpenApi();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const AjvCtor = (Ajv as any).default ?? Ajv;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const addFormatsFn = (addFormats as any).default ?? addFormats;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  addFormatsFn(ajv);

  const server = await startServer();
  const failures: string[] = [];

  const check = (
    label: string,
    status: number,
    expectedStatus: number,
    body: unknown,
    schema: JsonSchema,
  ) => {
    const validate = ajv.compile(schema);
    if (status !== expectedStatus || !validate(body)) {
      failures.push(
        `${label} failed: status=${status} expected=${expectedStatus} errors=${JSON.stringify(validate.errors)} body=${JSON.stringify(body)}`,
      );
    } else {
      console.info(`✓ ${label}`);
    }
  };

  try {
    {
      const res = await fetch(`${server.baseUrl}/health`);
      check(
        "GET /health",
        res.status,
        200,
        await res.json(),
        responseSchema(doc, "/health", "get", "200"),
      );
    }

    {
      const res = await fetch(`${server.baseUrl}/api/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Contract todo" }),
      });
      const body = await res.json();
      check(
        "POST /api/todos 201",
        res.status,
        201,
        body,
        responseSchema(doc, "/api/todos", "post", "201"),
      );

      const listRes = await fetch(`${server.baseUrl}/api/todos`);
      check(
        "GET /api/todos",
        listRes.status,
        200,
        await listRes.json(),
        responseSchema(doc, "/api/todos", "get", "200"),
      );

      const id = (body as { id: string }).id;
      const completeRes = await fetch(`${server.baseUrl}/api/todos/${id}/complete`, {
        method: "POST",
      });
      check(
        "POST /api/todos/{id}/complete",
        completeRes.status,
        200,
        await completeRes.json(),
        responseSchema(doc, "/api/todos/{id}/complete", "post", "200"),
      );
    }

    {
      const res = await fetch(`${server.baseUrl}/api/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "   " }),
      });
      check(
        "POST /api/todos 400",
        res.status,
        400,
        await res.json(),
        responseSchema(doc, "/api/todos", "post", "400"),
      );
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
