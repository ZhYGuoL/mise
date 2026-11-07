import { Hono } from "hono";
import {
  GenerateDishRequest,
  GenerateDishResponse,
  GenerateLogoRequest,
  GenerateLogoResponse,
  GenerateMenuCardRequest,
  GenerateMenuCardResponse,
} from "@mise/shared";
import { body } from "../validate";

/** Lane B owns this file. Scaffold: nothing is generated, so every URL is null and the UI shows its fallback card. */
export const generate = new Hono();

generate.post("/dish", async (c) => {
  await body(c, GenerateDishRequest);
  return c.json(GenerateDishResponse.parse({ imageUrl: null }));
});

generate.post("/logo", async (c) => {
  await body(c, GenerateLogoRequest);
  return c.json(GenerateLogoResponse.parse({ logoUrl: null }));
});

generate.post("/menu-card", async (c) => {
  await body(c, GenerateMenuCardRequest);
  return c.json(GenerateMenuCardResponse.parse({ imageUrl: null }));
});
