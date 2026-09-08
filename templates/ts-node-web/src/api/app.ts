import { Hono } from "hono";
import { createHealthStatus } from "../domain/health.js";
import { renderHomePage } from "../web/home-page.js";

export function createApp(): Hono {
  const app = new Hono();

  app.get("/", (c) => c.html(renderHomePage()));

  app.get("/health", (c) => c.json(createHealthStatus()));

  return app;
}
