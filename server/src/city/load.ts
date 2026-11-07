/**
 * Load the city once: restaurants, residents, and when each restaurant is open.
 * If data/city/*.json is missing, build it in memory from data/raw/ (same seed, same result).
 */
import path from "node:path";
import { Resident, Restaurant, type Day } from "@mise/shared";
import { z } from "zod";
import { ROOT } from "../fixtures";
import { normalizeCuisine } from "./cuisine";
import { buildRestaurants } from "./restaurants";
import { generateResidents } from "./residents";

export const DAYS: Day[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CITY_DIR = path.join(ROOT, "data/city");

export type City = {
  restaurants: Restaurant[];
  residents: Resident[];
  /** open[dayIndex][hour] = indices of restaurants open that hour */
  openAt: number[][][];
};

/** Hours for places without Google popular times: [open, close) per day, close may pass 24. */
function defaultHours(r: Restaurant, day: Day): [number, number] | null {
  const c = normalizeCuisine(r.cuisine[0] ?? "") ?? "american";
  const lateDay = day === "Friday" || day === "Saturday";
  if (c === "breakfast") return day === "Sunday" ? [8, 15] : [7, 15];
  if (c === "cafe") return [7, 20];
  if (c === "dessert") return [12, 22];
  if (c === "pizza") return lateDay ? [11, 26] : [11, 24];
  if ((r.priceTier ?? 2) >= 3) return day === "Monday" ? null : [17, 22];
  if (r.priceTier === 1) return lateDay ? [10, 24] : [10, 23];
  return lateDay ? [11, 23] : [11, 22];
}

function openTable(restaurants: Restaurant[]): number[][][] {
  const table = DAYS.map(() => Array.from({ length: 24 }, () => [] as number[]));
  restaurants.forEach((r, i) => {
    DAYS.forEach((day, d) => {
      if (r.popularTimes) {
        const hours = r.popularTimes[day] ?? {};
        for (let h = 0; h < 24; h++) if ((hours[String(h)] ?? 0) > 0) table[d]![h]!.push(i);
        return;
      }
      const span = defaultHours(r, day);
      if (!span) return;
      for (let h = span[0]; h < span[1]; h++) {
        if (h < 24) table[d]![h]!.push(i);
        else table[(d + 1) % 7]![h - 24]!.push(i); // past midnight lands on the next day
      }
    });
  });
  return table;
}

async function readOrBuild<T>(file: string, schema: z.ZodType<T>, build: () => Promise<T>): Promise<T> {
  const f = Bun.file(path.join(CITY_DIR, file));
  if (await f.exists()) return schema.parse(await f.json());
  console.warn(`[city] ${file} missing, building in memory. Run: bun server/src/city/build.ts`);
  return build();
}

let city: Promise<City> | null = null;

export function loadCity(): Promise<City> {
  city ??= (async () => {
    const restaurants = await readOrBuild("restaurants.json", z.array(Restaurant), () => buildRestaurants(path.join(ROOT, "data/raw")));
    const residents = await readOrBuild("residents.json", z.array(Resident), async () => generateResidents({ restaurants }));
    return { restaurants, residents, openAt: openTable(restaurants) };
  })();
  return city;
}
