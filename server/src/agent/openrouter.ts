/** Minimal OpenRouter chat client: streaming text plus tool calls. Model ids come from env. */

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ToolChoice = "auto" | "none" | { type: "function"; function: { name: string } };

export const modelConfig = () => {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.MODEL_CHAT;
  return key && model ? { key, model } : null;
};

export async function complete(opts: {
  messages: Message[];
  tools?: ToolDef[];
  toolChoice?: ToolChoice;
  signal?: AbortSignal;
  /** streamed assistant text */
  onText?: (delta: string) => void | Promise<void>;
  /** the first chunk of a tool call, so the UI can show what the model is doing */
  onToolStart?: (name: string) => void | Promise<void>;
  /** the tool arguments streamed so far, so the UI can show progress inside a long call */
  onToolArgs?: (name: string, partial: string) => void | Promise<void>;
}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const cfg = modelConfig();
  if (!cfg) throw new Error("OPENROUTER_API_KEY or MODEL_CHAT is not set");

  const base = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    // A stalled model must not freeze the demo. 60 s covers the longest create_concept call.
    signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    headers: {
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      "x-title": "Mise",
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: opts.messages,
      tools: opts.tools?.length ? opts.tools : undefined,
      tool_choice: opts.tools?.length ? (opts.toolChoice ?? "auto") : undefined,
      parallel_tool_calls: false,
      temperature: 0.6,
      max_tokens: 6000,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);

  let content = "";
  const calls: { id: string; name: string; args: string }[] = [];
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue; // ": OPENROUTER PROCESSING" keep-alives
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk: {
        error?: { message?: string };
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new Error(`OpenRouter: ${chunk.error.message ?? "stream error"}`);
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        await opts.onText?.(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) {
          const first = !slot.name;
          slot.name += tc.function.name;
          if (first) await opts.onToolStart?.(slot.name);
        }
        if (tc.function?.arguments) {
          slot.args += tc.function.arguments;
          await opts.onToolArgs?.(slot.name, slot.args);
        }
      }
    }
  }

  const toolCalls = calls
    .filter(Boolean)
    .map((c, i) => ({
      id: c.id || `call_${i}`,
      type: "function" as const,
      function: { name: c.name, arguments: c.args || "{}" },
    }));
  return { content, toolCalls };
}
