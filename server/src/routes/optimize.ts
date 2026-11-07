import { Hono } from "hono";
import { AgentEvent, AgentOptimizeRequest } from "@mise/shared";
import { z } from "zod";
import { fixture, isMock } from "../fixtures";
import { runOptimize } from "../optimize/loop";
import { replayEvents, streamAgentEvents } from "../sse";
import { body } from "../validate";

/** Wave 2. POST /api/agent/optimize {concept, goal} -> SSE AgentEvent stream, one round at a time. */
export const optimize = new Hono();

const ROUND_TYPES = new Set(["thinking", "edits", "simulating", "prediction", "done"]);

optimize.post("/optimize", async (c) => {
  const req = await body(c, AgentOptimizeRequest);
  if (isMock()) {
    const events = await fixture("agent-events", z.array(AgentEvent));
    return streamAgentEvents(c, (send) => replayEvents(events.filter((e) => ROUND_TYPES.has(e.type)), send));
  }
  const signal = c.req.raw.signal;
  return streamAgentEvents(c, (send) => runOptimize(req, send, signal));
});
