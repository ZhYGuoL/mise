import path from "node:path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { GENERATED_DIR, isMock } from "./fixtures";
import { agent } from "./routes/agent";
import { city } from "./routes/city";
import { generate } from "./routes/generate";
import { importRoute } from "./routes/import";
import { optimize } from "./routes/optimize";
import { residents } from "./routes/residents";
import { simulate } from "./routes/simulate";

const app = new Hono();

app.use(logger());

app.get("/api/health", (c) => c.json({ ok: true, mock: isMock() }));
app.route("/api/agent", agent);
app.route("/api/agent", optimize);
app.route("/api/generate", generate);
app.route("/api/city", city);
app.route("/api/simulate", simulate);
app.route("/api/residents", residents);
app.route("/api/import", importRoute);

/** Generated images: data/generated/<conceptId>/<file> at /generated/<conceptId>/<file>. */
app.get("/generated/*", async (c) => {
  const file = path.resolve(GENERATED_DIR, decodeURIComponent(c.req.path.slice("/generated/".length)));
  if (!file.startsWith(GENERATED_DIR + path.sep)) return c.notFound();
  const f = Bun.file(file);
  return (await f.exists()) ? new Response(f) : c.notFound();
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

const port = Number(process.env.PORT ?? 8787);
console.log(`mise server on http://localhost:${port}${isMock() ? " (MOCK=1)" : ""}`);

export default {
  port,
  fetch: app.fetch,
  // Agent streams can sit quiet while the model thinks. Bun's default idle timeout is 10 s.
  idleTimeout: 120,
};
