/**
 * Build data/city/restaurants.json and data/city/residents.json from data/raw/.
 * Run: bun server/src/city/build.ts
 */
import path from "node:path";
import { Resident, Restaurant } from "@mise/shared";
import { z } from "zod";
import { ROOT } from "../fixtures";
import { buildRestaurants } from "./restaurants";
import { generateResidents } from "./residents";

const started = performance.now();
const restaurants = z.array(Restaurant).parse(await buildRestaurants(path.join(ROOT, "data/raw")));
const residents = z.array(Resident).parse(generateResidents({ restaurants }));

const out = path.join(ROOT, "data/city");
await Bun.write(path.join(out, "restaurants.json"), JSON.stringify(restaurants, null, 1));
await Bun.write(path.join(out, "residents.json"), JSON.stringify(residents));

const bySeg: Record<string, number> = {};
for (const r of residents) bySeg[r.segment] = (bySeg[r.segment] ?? 0) + 1;
console.log(`restaurants: ${restaurants.length} (${restaurants.filter((r) => r.rating !== null).length} with Google data)`);
console.log(`residents: ${residents.length}`, bySeg);
console.log(`built in ${Math.round(performance.now() - started)} ms`);
