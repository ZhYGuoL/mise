import { type Concept, GenerateDishResponse, GenerateLogoResponse, Prediction, type Scenario } from "@mise/shared";
import { fixture } from "../fixtures";

/**
 * The agent calls the other lanes through their HTTP routes, so it does not depend on how they work inside.
 * When a route fails, it falls back to the fixture, so the demo keeps going.
 */
const self = () => `http://127.0.0.1:${process.env.PORT ?? 8787}`;

async function post(path: string, body: unknown, signal?: AbortSignal) {
  const res = await fetch(self() + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function simulate(concept: Concept, scenario: Scenario, signal?: AbortSignal): Promise<Prediction> {
  try {
    return Prediction.parse(await post("/api/simulate", { concept, scenario }, signal));
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn("[agent] /api/simulate failed, using the fixture:", err instanceof Error ? err.message : err);
    const p = await fixture("prediction", Prediction);
    return { ...p, conceptId: concept.id, conceptVersion: concept.version, scenario };
  }
}

/** "logo" or a menu item id. Returns null when generation is off or fails, so the UI keeps its fallback card. */
export async function generate(concept: Concept, target: string, signal?: AbortSignal): Promise<string | null> {
  try {
    if (target === "logo") {
      return GenerateLogoResponse.parse(await post("/api/generate/logo", { concept }, signal)).logoUrl;
    }
    return GenerateDishResponse.parse(await post("/api/generate/dish", { concept, itemId: target }, signal)).imageUrl;
  } catch (err) {
    if (!signal?.aborted) console.warn(`[agent] generate ${target} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
