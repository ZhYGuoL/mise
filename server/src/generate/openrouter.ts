/** One image from OpenRouter's chat completions endpoint, with `modalities: ["image", "text"]`. */

export type AspectRatio = "1:1" | "4:3";

export type ImageResult = { bytes: Uint8Array; mime: string; costUsd: number | null };

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export class ImageError extends Error {}

export async function generateImage(opts: {
  model: string;
  prompt: string;
  aspectRatio: AspectRatio;
  timeoutMs: number;
}): Promise<ImageResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new ImageError("OPENROUTER_API_KEY is not set");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "x-title": "Mise",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content: opts.prompt }],
      modalities: ["image", "text"],
      image_config: { aspect_ratio: opts.aspectRatio },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
  if (!res.ok) throw new ImageError(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = (await res.json()) as {
    error?: { message?: string };
    usage?: { cost?: number };
    choices?: { message?: { content?: string; images?: { image_url?: { url?: string } }[] } }[];
  };
  if (json.error) throw new ImageError(`OpenRouter error: ${json.error.message ?? "unknown"}`);
  const message = json.choices?.[0]?.message;
  const url = message?.images?.[0]?.image_url?.url;
  if (!url) throw new ImageError(`no image in response: ${(message?.content ?? "").slice(0, 200)}`);

  const { bytes, mime } = await decode(url, opts.timeoutMs);
  return { bytes, mime, costUsd: json.usage?.cost ?? null };
}

async function decode(url: string, timeoutMs: number): Promise<{ bytes: Uint8Array; mime: string }> {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (m) return { mime: m[1], bytes: Uint8Array.from(Buffer.from(m[2], "base64")) };
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new ImageError(`image download ${res.status}`);
  return { mime: res.headers.get("content-type") ?? "image/png", bytes: new Uint8Array(await res.arrayBuffer()) };
}
