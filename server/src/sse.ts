import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { AgentEvent } from "@mise/shared";

/** Stream AgentEvents as SSE. Each event is validated before it goes out. */
export function streamAgentEvents(c: Context, run: (send: (e: AgentEvent) => Promise<void>) => Promise<void>) {
  return streamSSE(c, async (stream) => {
    const send = (e: AgentEvent) => stream.writeSSE({ data: JSON.stringify(AgentEvent.parse(e)) });
    try {
      await run(send);
    } catch (err) {
      await send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Replay a fixture event list with a short pause between events, so the UI sees a real stream. */
export async function replayEvents(events: AgentEvent[], send: (e: AgentEvent) => Promise<void>, gapMs = 250) {
  for (const e of events) {
    await send(e);
    await Bun.sleep(gapMs);
  }
}
