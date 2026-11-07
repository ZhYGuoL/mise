import { Hono } from "hono";
import { AgentEvent, AgentOptimizeRequest } from "@mise/shared";
import { z } from "zod";
import { fixture } from "../fixtures";
import { replayEvents, streamAgentEvents } from "../sse";
import { body } from "../validate";

/** Wave 2 owns this file. Scaffold: replays the edit and prediction steps of the fixture session. */
export const optimize = new Hono();

const ROUND_TYPES = new Set(["thinking", "edits", "simulating", "prediction", "done"]);

optimize.post("/optimize", async (c) => {
  await body(c, AgentOptimizeRequest);
  const events = await fixture("agent-events", z.array(AgentEvent));
  return streamAgentEvents(c, (send) => replayEvents(events.filter((e) => ROUND_TYPES.has(e.type)), send));
});
