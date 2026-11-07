import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { AgentChatRequest, AgentEvent } from "@mise/shared";
import { z } from "zod";
import { runChat } from "../agent/run";
import { fixture, isMock } from "../fixtures";
import { replayEvents } from "../sse";
import { body } from "../validate";

/** Lane A. POST /api/agent/chat streams AgentEvents over SSE. */
export const agent = new Hono();

agent.post("/chat", async (c) => {
  const req = await body(c, AgentChatRequest);
  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    // Every event is validated before it goes out. A closed stream drops late events.
    const send = async (e: AgentEvent) => {
      if (abort.signal.aborted) return;
      await stream.writeSSE({ data: JSON.stringify(AgentEvent.parse(e)) });
    };
    if (isMock()) {
      const events = await fixture("agent-events", z.array(AgentEvent));
      await replayEvents(events, send);
      return;
    }
    await runChat(req, send, abort.signal);
  });
});
