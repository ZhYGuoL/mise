/**
 * Lane H. Every city restaurant joined with the facts the import needs:
 * the city Restaurant (lane D), the raw Google scrape (maps link, Google name, category),
 * and the OpenStreetMap facts in places.json (website, opening hours, address, neighborhood).
 */
import path from "node:path";
import type { ImportPlace, Restaurant } from "@mise/shared";
import { loadCity } from "../city/load";
import { ROOT } from "../fixtures";
import facts from "./places.json";

/** OpenStreetMap facts for one place. build-places.ts writes them to places.json. */
export type PlaceFacts = {
  osmId: string;
  website: string | null;
  openingHours: string | null;
  /** "242 South Highland Avenue" */
  street: string | null;
  postcode: string | null;
  neighborhood: string | null;
  /** alt_name, short_name, official_name, brand: other names people type */
  aliases: string[];
};

type GoogleRow = { osm_id: string; place_id: string; g_name: string; maps_url: string | null; category: string | null };

export type Place = {
  restaurant: Restaurant;
  osmId: string;
  googleName: string | null;
  mapsUrl: string | null;
  facts: PlaceFacts;
};

let cache: Promise<Place[]> | null = null;

export function loadPlaces(): Promise<Place[]> {
  cache ??= (async () => {
    const { restaurants } = await loadCity();
    const file = path.join(ROOT, "data/raw/restaurants_popular_times.json");
    const google = ((await Bun.file(file).json()) as { restaurants: GoogleRow[] }).restaurants;
    const byPlaceId = new Map(google.map((g) => [g.place_id, g]));
    const factsByOsm = new Map((facts as PlaceFacts[]).map((f) => [f.osmId, f]));

    // A place with Google data has the Google place id. Every other place keeps its OSM id.
    return restaurants.map((restaurant): Place => {
      const g = byPlaceId.get(restaurant.placeId);
      const osmId = g?.osm_id ?? restaurant.placeId;
      const f = factsByOsm.get(osmId) ?? {
        osmId, website: null, openingHours: null, street: null, postcode: null, neighborhood: null, aliases: [],
      };
      return { restaurant, osmId, googleName: g?.g_name ?? null, mapsUrl: g?.maps_url ?? null, facts: f };
    });
  })();
  return cache;
}

export const toImportPlace = (p: Place): ImportPlace => ({
  placeId: p.restaurant.placeId,
  name: p.restaurant.name,
  street: p.facts.street,
  neighborhood: p.facts.neighborhood,
  cuisine: p.restaurant.cuisine,
  rating: p.restaurant.rating,
  reviews: p.restaurant.reviews,
  aliases: p.facts.aliases.length ? p.facts.aliases : undefined,
});
