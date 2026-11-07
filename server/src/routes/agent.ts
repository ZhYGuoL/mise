import { Hono } from "hono";
import { AgentChatRequest, AgentEvent } from "@mise/shared";
import { z } from "zod";
import { fixture } from "../fixtures";
import { replayEvents, streamAgentEvents } from "../sse";
import { body } from "../validate";

/** Lane A owns this file. Scaffold: replays the scripted session from the fixture. */
export const agent = new Hono();

agent.post("/chat", async (c) => {
  await body(c, AgentChatRequest);
  const events = await fixture("agent-events", z.array(AgentEvent));
  return streamAgentEvents(c, (send) => replayEvents(events, send));
});
