import { Hono } from "hono";
import { createHealthStatus } from "../domain/health.js";
import { renderHomePage } from "../web/home-page.js";

export function createApp(): Hono {
  const app = new Hono();

  app.get("/", (c) => c.html(renderHomePage()));

  app.get("/health", (c) => c.json(createHealthStatus()));

  /** Test-only reset endpoint used by E2E setup. Disabled unless GAUNTLET_E2E=1. */
  app.post("/api/test/reset", (c) => {
    if (process.env.GAUNTLET_E2E !== "1") {
      return c.json({ error: "Not available" }, 404);
    }
    return c.json({ reset: true });
  });

  return app;
}
