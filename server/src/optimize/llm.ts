/**
 * Small JSON completion with the cheap fast model (MODEL_FAST). Used by the optimize loop and interviews.
 * The team key has a hard dollar limit, so this never falls back to MODEL_CHAT.
 */
import { isMock } from "../fixtures";

export const fastModel = () => {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.MODEL_FAST;
  return key && model && !isMock() ? { key, model } : null;
};

let spentUsd = 0;

/** Strip ```json fences and any text around the first {...} block. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the model reply");
  return JSON.parse(text.slice(start, end + 1));
}

export async function completeJson(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  tag: string;
}): Promise<unknown> {
  const cfg = fastModel();
  if (!cfg) throw new Error("MODEL_FAST is not set");
  const base = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const t0 = performance.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json", "x-title": "Mise" },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 1200,
      // Haiku 5.5 reasons by default, and the reasoning counts against max_tokens. Off: 3x faster, no cut-off replies.
      reasoning: { enabled: false },
      usage: { include: true },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null; reasoning?: string | null }; finish_reason?: string }[];
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (body.error) throw new Error(`OpenRouter: ${body.error.message ?? "error"}`);
  const cost = body.usage?.cost ?? 0;
  spentUsd += cost;
  console.log(
    `[${opts.tag}] ${cfg.model} ${Math.round(performance.now() - t0)} ms, ${body.usage?.prompt_tokens ?? "?"} in / ${body.usage?.completion_tokens ?? "?"} out, $${cost.toFixed(5)} (session $${spentUsd.toFixed(4)})`,
  );
  const text = body.choices?.[0]?.message?.content ?? "";
  try {
    return extractJson(text);
  } catch (err) {
    const c = body.choices?.[0];
    console.warn(
      `[${opts.tag}] could not parse the reply (finish ${c?.finish_reason}, reasoning ${c?.message?.reasoning?.length ?? 0} chars): ${text.slice(0, 240).replace(/\n/g, " ")}`,
    );
    throw err;
  }
}
