import { Hono } from "hono";
import {
  GenerateDishRequest,
  GenerateDishResponse,
  GenerateLogoRequest,
  GenerateLogoResponse,
  GenerateMenuCardRequest,
  GenerateMenuCardResponse,
} from "@mise/shared";
import { generateDish, generateLogo } from "../generate";
import { body } from "../validate";

/** Lane B. Generation never fails the request: a failed image is { url: null, status: "failed" } and the UI shows its fallback card. */
export const generate = new Hono();

generate.post("/dish", async (c) => {
  const { concept, itemId, regenerate } = await body(c, GenerateDishRequest);
  const r = await generateDish(concept, itemId, { regenerate });
  return c.json(GenerateDishResponse.parse({ imageUrl: r.url, status: r.status, ms: r.ms, error: r.error }));
});

generate.post("/logo", async (c) => {
  const { concept, regenerate } = await body(c, GenerateLogoRequest);
  const r = await generateLogo(concept, { regenerate });
  return c.json(GenerateLogoResponse.parse({ logoUrl: r.url, status: r.status, ms: r.ms, error: r.error }));
});

/** Optional in the contract. Not built: the web renders the menu card from the concept itself. */
generate.post("/menu-card", async (c) => {
  await body(c, GenerateMenuCardRequest);
  return c.json(GenerateMenuCardResponse.parse({ imageUrl: null }));
});
