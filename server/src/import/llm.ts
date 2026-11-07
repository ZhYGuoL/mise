/**
 * Lane H. One JSON completion with MODEL_FAST. Returns the cost, so the import can log what it spent.
 * The team key has a hard dollar limit, so this never falls back to MODEL_CHAT.
 */
import { isMock } from "../fixtures";

export const fastModel = () => {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.MODEL_FAST;
  return key && model && !isMock() ? { key, model } : null;
};

export type JsonReply = { json: unknown; costUsd: number; ms: number };

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the model reply");
  return JSON.parse(text.slice(start, end + 1));
}

export async function completeJson(opts: { system: string; user: string; maxTokens: number; tag: string }): Promise<JsonReply> {
  const cfg = fastModel();
  if (!cfg) throw new Error("MODEL_FAST is not set");
  const base = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const t0 = performance.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(25_000),
    headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json", "x-title": "Mise" },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: 0.3,
      max_tokens: opts.maxTokens,
      // Reasoning counts against max_tokens and triples the time. These are copy and draft jobs.
      reasoning: { enabled: false },
      usage: { include: true },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (body.error) throw new Error(`OpenRouter: ${body.error.message ?? "error"}`);
  const ms = Math.round(performance.now() - t0);
  const costUsd = body.usage?.cost ?? 0;
  console.log(
    `[import] ${opts.tag}: ${cfg.model} ${ms} ms, ${body.usage?.prompt_tokens ?? "?"} in / ${body.usage?.completion_tokens ?? "?"} out, $${costUsd.toFixed(5)}`,
  );
  return { json: extractJson(body.choices?.[0]?.message?.content ?? ""), costUsd, ms };
}
