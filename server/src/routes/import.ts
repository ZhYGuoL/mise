import { Hono } from "hono";
import { ImportError, ImportPlace, ImportRequest } from "@mise/shared";
import { z } from "zod";
import { ImportFailure, importRestaurant } from "../import";
import { loadPlaces, toImportPlace } from "../import/places";
import { body } from "../validate";

/** Lane H. Start from an existing restaurant. */
export const importRoute = new Hono();

/** For autocomplete: every city restaurant with its street and neighborhood, most reviewed first. */
importRoute.get("/places", async (c) => {
  const places = (await loadPlaces()).map(toImportPlace).sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
  return c.json(z.array(ImportPlace).parse(places));
});

importRoute.post("/", async (c) => {
  const req = await body(c, ImportRequest);
  try {
    return c.json(await importRestaurant(req));
  } catch (err) {
    if (!(err instanceof ImportFailure)) throw err;
    console.warn(`[import] "${req.query}": ${err.message}`);
    return c.json(ImportError.parse({ error: err.message, suggestions: err.suggestions.map(toImportPlace) }), err.status);
  }
});
