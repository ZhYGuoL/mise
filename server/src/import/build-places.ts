/**
 * Lane H. Build server/src/import/places.json: the OpenStreetMap facts the import needs for each
 * of the 192 city restaurants (website, opening hours, street address, neighborhood, other names).
 * The import reads this file, so a live demo never waits on Overpass or Nominatim.
 *
 * Run: bun server/src/import/build-places.ts
 */
import path from "node:path";
import { ROOT } from "../fixtures";
import type { PlaceFacts } from "./places";

type OsmPlace = { osm_id: string; name: string };
type Element = { type: "node" | "way"; id: number; tags?: Record<string, string> };
type NominatimHit = { osm_type: string; osm_id: number; address?: Record<string, string> };

const UA = { "user-agent": "Mise/0.1 (hackathon demo)" };
const osm = ((await Bun.file(path.join(ROOT, "data/raw/all_restaurants_osm.json")).json()) as { restaurants: OsmPlace[] }).restaurants;

const ids = (type: string) => osm.filter((p) => p.osm_id.startsWith(`${type}/`)).map((p) => p.osm_id.slice(type.length + 1));
const query = `[out:json][timeout:60];(node(id:${ids("node").join(",")});way(id:${ids("way").join(",")}););out tags;`;
const overpass = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { ...UA, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ data: query }),
});
if (!overpass.ok) throw new Error(`Overpass ${overpass.status}: ${await overpass.text()}`);
const tags = new Map(((await overpass.json()) as { elements: Element[] }).elements.map((e) => [`${e.type}/${e.id}`, e.tags ?? {}]));

// Nominatim lookup takes 50 OSM ids per call. Its usage policy asks for at most one call per second.
const address = new Map<string, Record<string, string>>();
const codes = osm.map((p) => `${p.osm_id.startsWith("node/") ? "N" : "W"}${p.osm_id.split("/")[1]}`);
for (let i = 0; i < codes.length; i += 50) {
  const url = `https://nominatim.openstreetmap.org/lookup?format=jsonv2&addressdetails=1&osm_ids=${codes.slice(i, i + 50).join(",")}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Nominatim ${res.status}: ${await res.text()}`);
  for (const hit of (await res.json()) as NominatimHit[]) address.set(`${hit.osm_type}/${hit.osm_id}`, hit.address ?? {});
  await Bun.sleep(1100);
}

const places: PlaceFacts[] = osm.map((p) => {
  const t = tags.get(p.osm_id) ?? {};
  const a = address.get(p.osm_id) ?? {};
  const number = t["addr:housenumber"] ?? a.house_number;
  const road = t["addr:street"] ?? a.road;
  const aliases = [t.alt_name, t.short_name, t.official_name, t.brand]
    .flatMap((s) => (s ? s.split(";") : []))
    .map((s) => s.trim())
    .filter((s, i, all) => s && s !== p.name && all.indexOf(s) === i);
  return {
    osmId: p.osm_id,
    website: t.website ?? t["contact:website"] ?? null,
    openingHours: t.opening_hours ?? null,
    street: road ? (number ? `${number} ${road}` : road) : null,
    postcode: t["addr:postcode"] ?? a.postcode ?? null,
    neighborhood: a.neighbourhood ?? a.suburb ?? a.quarter ?? null,
    aliases,
  };
});

const out = path.join(import.meta.dir, "places.json");
await Bun.write(out, JSON.stringify(places, null, 1) + "\n");
const count = (f: (p: PlaceFacts) => unknown) => places.filter(f).length;
console.log(
  `places: ${places.length}, website ${count((p) => p.website)}, hours ${count((p) => p.openingHours)}, street ${count((p) => p.street)}, neighborhood ${count((p) => p.neighborhood)}`,
);
