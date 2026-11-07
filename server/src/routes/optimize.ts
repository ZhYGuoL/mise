import { Hono } from "hono";
import { AgentOptimizeRequest } from "@mise/shared";
import { runOptimize } from "../optimize/loop";
import { streamAgentEvents } from "../sse";
import { body } from "../validate";

/**
 * Wave 2. POST /api/agent/optimize {concept, goal} -> SSE AgentEvent stream, one round at a time.
 * The loop needs no key: with MOCK=1 or no MODEL_FAST, rules propose instead of the model, and the simulator is local.
 */
export const optimize = new Hono();

optimize.post("/optimize", async (c) => {
  const req = await body(c, AgentOptimizeRequest);
  const signal = c.req.raw.signal;
  return streamAgentEvents(c, (send) => runOptimize(req, send, signal));
});
