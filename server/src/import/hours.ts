/**
 * Lane H. Opening hours for an imported restaurant, from the best source it has:
 *   1. Google popular times (scraped Nov 7): open from the first busy hour to the end of the last one.
 *   2. The OpenStreetMap opening_hours tag, for the common "Mo-Fr 11:00-22:00; Sa 12:00-23:00" forms.
 *   3. Cuisine defaults, the same rules the city uses for places without Google data.
 */
import type { Concept, Day, Restaurant } from "@mise/shared";
import { normalizeCuisine } from "../city/cuisine";

export type Hours = Concept["hours"];
export type HoursSource = "google" | "osm" | "default";

const DAYS: Day[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const OSM_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Minutes since midnight to "HH:MM". 1440 and past wrap to the next day. */
const hm = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** [start, end) in minutes, end may pass 1440. Open 24 hours is 06:00 to 06:00, which both the sim and the chart read as all day. */
function span(start: number, end: number) {
  return end - start >= 1440 ? { open: "06:00", close: "06:00" } : { open: hm(start), close: hm(end) };
}

/* ───────────── 1. Google popular times ───────────── */

function fromPopularTimes(r: Restaurant, osm: Hours | null): Hours | null {
  if (!r.popularTimes) return null;
  const out = {} as Hours;
  let open = 0;
  for (const day of DAYS) {
    const busy = Object.entries(r.popularTimes[day] ?? {})
      .filter(([, v]) => v > 0)
      .map(([h]) => Number(h))
      .sort((a, b) => a - b);
    if (!busy.length) {
      out[day] = null;
      continue;
    }
    open++;
    const start = busy[0]! * 60;
    let end = (busy.at(-1)! + 1) * 60;
    // The scrape stops at 23:00. Busy at 23:00 means open to midnight at least: OSM may know the real close.
    const tag = osm?.[day];
    if (end === 1440 && tag) {
      const close = Number(tag.close.slice(0, 2)) * 60 + Number(tag.close.slice(3));
      if (close > 0 && close <= 6 * 60) end = 1440 + close;
    }
    out[day] = span(start, end);
  }
  return open ? out : null;
}

/* ───────────── 2. OpenStreetMap opening_hours ───────────── */

function daySet(spec: string): number[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map((s) => OSM_DAYS.indexOf(s.trim()));
    if (a === undefined || a < 0) return null;
    if (b === undefined) {
      out.add(a);
      continue;
    }
    if (b < 0) return null;
    for (let d = a; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === b) break;
    }
  }
  return [...out];
}

/** Parses the common forms. Anything it does not understand, or hours that make no sense, returns null. */
export function parseOsmHours(tag: string): Hours | null {
  const text = tag.split("||")[0]!.replace(/open\s+"[^"]*"/gi, "").replace(/"[^"]*"/g, "");
  // Rules end at ";", or at "," after a time or "off" when a day name follows: "Mo-Sa 11:00-20:30, Su 11:00-18:00".
  const rules = text
    .split(/;|(?<=\d|off|closed),(?=\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const days: ({ start: number; end: number } | null | undefined)[] = Array(7).fill(undefined);

  for (const rule of rules) {
    const m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)+)?(.*)$/.exec(rule);
    if (!m) return null;
    const rest = m[2]!.trim();
    // Holidays and dates ("PH off", "Dec 24-25 off") are exceptions to the weekly hours. Skip them.
    if (/\b(PH|SH|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(rest)) continue;
    const which = m[1] ? daySet(m[1].replace(/,\s*$/, "")) : [0, 1, 2, 3, 4, 5, 6];
    if (!which) return null;

    if (/^(off|closed)$/i.test(rest)) {
      for (const d of which) days[d] = null;
      continue;
    }
    let ranges = [...rest.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)].map((r) => {
      const start = Number(r[1]) * 60 + Number(r[2]);
      let end = Number(r[3]) * 60 + Number(r[4]);
      if (end <= start) end += 1440;
      return { start, end };
    });
    if (!ranges.length) return null;
    // "11:00-10:00" reads as 23 hours open: a typo for 22:00. Do not trust the tag. "07:00-04:00" is a real late place.
    if (ranges.some((r) => r.end - r.start > 22 * 60 && !(r.start === 0 && r.end === 1440))) return null;
    // "00:00-01:00,10:00-24:00" starts with the tail of last night. It belongs to the day before.
    if (ranges.length > 1) ranges = ranges.filter((r) => !(r.start < 5 * 60 && r.end <= 6 * 60));
    const merged = { start: Math.min(...ranges.map((r) => r.start)), end: Math.max(...ranges.map((r) => r.end)) };
    for (const d of which) days[d] = merged;
  }

  if (days.every((d) => d === undefined)) return null;
  const out = {} as Hours;
  DAYS.forEach((day, i) => {
    const d = days[i];
    // In OSM, a day that no rule names is closed.
    out[day] = d ? span(d.start, d.end) : null;
  });
  return out;
}

/* ───────────── 3. cuisine defaults ───────────── */

/** Same rules as defaultHours() in server/src/city/load.ts (lane D), so the import agrees with the city. */
function defaultSpan(r: Restaurant, day: Day): [number, number] | null {
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

function fromDefaults(r: Restaurant): Hours {
  const out = {} as Hours;
  for (const day of DAYS) {
    const s = defaultSpan(r, day);
    out[day] = s ? span(s[0] * 60, s[1] * 60) : null;
  }
  return out;
}

export function hoursFor(r: Restaurant, osmTag: string | null): { hours: Hours; source: HoursSource } {
  const osm = osmTag ? parseOsmHours(osmTag) : null;
  const google = fromPopularTimes(r, osm);
  if (google) return { hours: google, source: "google" };
  if (osm) return { hours: osm, source: "osm" };
  return { hours: fromDefaults(r), source: "default" };
}
