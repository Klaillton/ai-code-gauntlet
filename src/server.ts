import { serve } from "@hono/node-server";
import { createApp } from "./api/app.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.info(`ai-code-gauntlet listening on http://localhost:${info.port}`);
});
