/**
 * Lane H. Match what the owner typed to one city restaurant: a name ("noodle head", "Fujiya"),
 * a name with a place word ("Pamela's Squirrel Hill"), or a Google Maps link.
 * No good match is an error with suggestions. This never invents a restaurant.
 */
import type { Place } from "./places";

export type Match = { ok: true; place: Place } | { ok: false; error: string; suggestions: Place[] };

/** A name match at or above this score is the restaurant. */
const ACCEPT = 0.78;
/** Two places closer than this in name score are a tie, so place words decide. */
const TIE = 0.02;
/** A Maps pin farther than this from the matched place is another branch, outside the city. */
const MAX_PIN_M = 400;

const STOP = new Set(["the", "restaurant", "restaurants", "pittsburgh", "pgh", "pa", "in", "at", "on", "near", "of"]);

export function tokens(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`.]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t));
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

const stem = (t: string) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);
/** Same word, allowing a plural or possessive s, and one typo in a long word. */
const sameWord = (a: string, b: string) => stem(a) === stem(b) || (Math.min(a.length, b.length) >= 5 && lev(a, b) <= 1);

/** How well the query tokens name this one name, 0 to 1. Extra query words (a street, a neighborhood) cost a little. */
function nameScore(q: string[], name: string[]): number {
  if (!q.length || !name.length) return 0;
  const qc = q.join("");
  const nc = name.join("");
  if (qc === nc) return 1;
  let s = 1 - lev(qc, nc) / Math.max(qc.length, nc.length);
  // Typing the start of the name: "noodleh", "fujiya", "primanti" for "Primanti Bros".
  for (const prefix of new Set([qc, stem(qc)])) {
    if (prefix.length >= 3 && nc.startsWith(prefix)) s = Math.max(s, 0.8 + (0.2 * prefix.length) / nc.length);
  }
  const covered = name.filter((t) => q.some((u) => sameWord(u, t))).length / name.length;
  const extra = q.some((u) => !name.some((t) => sameWord(u, t)));
  return Math.max(s, covered * (extra ? 0.92 : 0.98));
}

const namesOf = (p: Place) => [p.restaurant.name, p.googleName, ...p.facts.aliases].filter((n): n is string => !!n);

function placeWords(p: Place): string[] {
  return tokens(`${p.facts.street ?? ""} ${p.facts.neighborhood ?? ""}`);
}

type Scored = { place: Place; score: number; where: number };

/** Street and neighborhood words of every city place: "forbes", "squirrel", "hill", "avenue". */
const locationWords = new WeakMap<Place[], Set<string>>();
function cityWords(places: Place[]): Set<string> {
  let set = locationWords.get(places);
  if (!set) {
    set = new Set(places.flatMap(placeWords).filter((w) => w.length >= 3 && !/^\d/.test(w)));
    locationWords.set(places, set);
  }
  return set;
}

function score(query: string, places: Place[]): Scored[] {
  const q = tokens(query);
  const city = cityWords(places);
  return places
    .map((place) => {
      const best = Math.max(
        ...namesOf(place).map((n) => {
          const name = tokens(n);
          // Place words ("Pamela's Squirrel Hill") pick a branch below. They do not count against the name.
          const forName = q.filter((u) => name.some((t) => sameWord(u, t)) || !city.has(u));
          return nameScore(forName.length ? forName : q, name);
        }),
      );
      const words = placeWords(place);
      const where = q.filter((u) => u.length >= 3 && words.some((w) => sameWord(u, w))).length;
      return { place, score: best, where };
    })
    .sort((a, b) => b.score - a.score || b.where - a.where || (b.place.restaurant.reviews ?? 0) - (a.place.restaurant.reviews ?? 0));
}

export function matchName(query: string, places: Place[]): Match {
  const ranked = score(query, places);
  const top = ranked[0];
  if (!top || top.score < ACCEPT) {
    const suggestions = ranked.filter((r) => r.score >= 0.5).slice(0, 3).map((r) => r.place);
    return { ok: false, error: `No restaurant called "${query.trim()}" in the simulated city.`, suggestions };
  }
  // A chain with two branches in the city: the place words in the query pick one, or the owner picks.
  const tied = ranked.filter((r) => top.score - r.score <= TIE);
  if (tied.length > 1) {
    const where = Math.max(...tied.map((r) => r.where));
    const picks = tied.filter((r) => r.where === where);
    if (picks.length > 1) {
      return {
        ok: false,
        error: `${picks.length} places match "${query.trim()}". Pick one.`,
        suggestions: picks.slice(0, 5).map((r) => r.place),
      };
    }
    return { ok: true, place: picks[0]!.place };
  }
  return { ok: true, place: top.place };
}

/* ───────────── Google Maps links ───────────── */

export const isUrl = (s: string) => /^\s*(https?:\/\/|www\.|maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps)/i.test(s);

function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** Short links (maps.app.goo.gl/...) redirect to the full Maps URL. Follow at most 4 hops. */
async function expand(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!/^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl|g\.co)\//i.test(current)) return current;
    const res = await fetch(current.startsWith("http") ? current : `https://${current}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" },
    });
    const next = res.headers.get("location");
    if (!next) return current;
    current = new URL(next, current).toString();
  }
  return current;
}

export async function matchUrl(raw: string, places: Place[]): Promise<Match> {
  const fail = (error: string): Match => ({ ok: false, error, suggestions: [] });
  let url: string;
  try {
    url = decodeURIComponent(await expand(raw.trim()));
  } catch {
    return fail("Could not open that Maps link.");
  }

  // 1. The Google feature id, e.g. !1s0x8834f20cac7b0859:0xb9cb735428929d9, is the exact place id in our data.
  const fid = /0x[0-9a-f]+:0x[0-9a-f]+/i.exec(url)?.[0]?.toLowerCase();
  if (fid) {
    const hit = places.find((p) => p.restaurant.placeId.toLowerCase() === fid);
    if (hit) return { ok: true, place: hit };
  }
  // 2. ?cid=<decimal> is the second half of the feature id.
  const cid = /[?&]cid=(\d+)/.exec(url)?.[1];
  if (cid) {
    const hex = `:0x${BigInt(cid).toString(16)}`;
    const hit = places.find((p) => p.restaurant.placeId.toLowerCase().endsWith(hex));
    if (hit) return { ok: true, place: hit };
  }

  // 3. The name in /maps/place/<name>/ and the pin (!3d lat !4d lon), or the map center (@lat,lon).
  const name = /\/maps\/place\/([^/@?]+)/.exec(url)?.[1]?.replace(/\+/g, " ");
  const pinMatch = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(url) ?? /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url) ?? /[?&](?:q|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(url);
  const pin = pinMatch ? { lat: Number(pinMatch[1]), lon: Number(pinMatch[2]) } : null;

  const atPin = () => {
    if (!pin) return null;
    const nearest = places.map((place) => ({ place, m: metersBetween(pin, place.restaurant) })).sort((a, b) => a.m - b.m)[0];
    return nearest && nearest.m <= 40 ? nearest.place : null;
  };

  if (name) {
    const ranked = score(name, places).filter((r) => r.score >= ACCEPT);
    if (!ranked.length) {
      // Google may use another name for a place we have, so a pin right on it still counts.
      const hit = atPin();
      if (hit) return { ok: true, place: hit };
      const miss = matchName(name, places);
      return { ok: false, error: `"${name}" is not in the simulated city.`, suggestions: miss.ok ? [] : miss.suggestions };
    }
    if (!pin) return matchName(name, places);
    const nearest = ranked.map((r) => ({ ...r, m: metersBetween(pin, r.place.restaurant) })).sort((a, b) => a.m - b.m)[0]!;
    if (nearest.m > MAX_PIN_M) return fail(`That ${nearest.place.restaurant.name} is outside the simulated city.`);
    return { ok: true, place: nearest.place };
  }
  const hit = atPin();
  if (hit) return { ok: true, place: hit };
  return fail(pin ? "No city restaurant at that spot on the map." : "Could not read a restaurant from that link.");
}

export async function matchQuery(query: string, places: Place[], placeId?: string): Promise<Match> {
  if (placeId) {
    const hit = places.find((p) => p.restaurant.placeId === placeId);
    return hit ? { ok: true, place: hit } : { ok: false, error: "That restaurant is not in the simulated city.", suggestions: [] };
  }
  return isUrl(query) ? matchUrl(query, places) : matchName(query, places);
}
