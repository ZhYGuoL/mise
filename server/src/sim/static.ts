/**
 * Everything about the city that does not depend on the concept, computed once.
 * Distances and utilities for 10,000 residents x 192 restaurants.
 */
import { loadCity, type City } from "../city/load";
import {
  OUTSIDE_GAP, RADIUS_KM, SCALE, affinityFor, daypartOf, dietOk, distanceKm, placeModel, placeTerms, sumTerms,
  type PlaceModel,
} from "./model";

export type StaticCity = City & {
  places: PlaceModel[];
  nR: number;
  nP: number;
  /** distance km, [r * nP + p] */
  km: Float32Array;
  /** utility without the habit bonus; -Infinity if out of range or no diet option */
  base: Float32Array;
  /** favorite restaurant indices, [r * 3 + k], -1 if none */
  fav: Int16Array;
  /** time-of-day utility per place and daypart, [p * 5 + daypart] */
  aff: Float32Array;
  /** exp(SCALE * aff) per hour of day, [hour][p]. Multiplies exp below. */
  affMult: Float64Array[];
  /** exp(SCALE * utility) with habit, cached per habit multiplier key */
  expCache: Map<string, { exp: Float64Array; outside: Float64Array }>;
};

let ready: Promise<StaticCity> | null = null;

export function loadStatic(): Promise<StaticCity> {
  ready ??= (async () => {
    const t0 = performance.now();
    const city = await loadCity();
    const places = city.restaurants.map(placeModel);
    const nR = city.residents.length;
    const nP = places.length;
    const index = new Map(city.restaurants.map((r, i) => [r.placeId, i]));
    const km = new Float32Array(nR * nP);
    const base = new Float32Array(nR * nP);
    const fav = new Int16Array(nR * 3).fill(-1);
    for (let r = 0; r < nR; r++) {
      const res = city.residents[r]!;
      res.favorites.slice(0, 3).forEach((id, k) => (fav[r * 3 + k] = index.get(id) ?? -1));
      for (let p = 0; p < nP; p++) {
        const place = city.restaurants[p]!;
        const d = distanceKm(res.home.lat, res.home.lon, place.lat, place.lon);
        km[r * nP + p] = d;
        base[r * nP + p] = d > RADIUS_KM || !dietOk(res, places[p]!.diet) ? -Infinity : sumTerms(placeTerms(res, places[p]!, d, false));
      }
    }
    const aff = new Float32Array(nP * 5);
    places.forEach((pl, p) => affinityFor(pl.cuisines).forEach((a, k) => (aff[p * 5 + k] = a)));
    const affMult = Array.from({ length: 24 }, (_, h) => Float64Array.from(places, (_, p) => Math.exp(SCALE * aff[p * 5 + daypartOf(h)]!)));
    console.log(`[sim] city ready: ${nR} residents x ${nP} restaurants in ${Math.round(performance.now() - t0)} ms`);
    return { ...city, places, nR, nP, km, base, fav, aff, affMult, expCache: new Map() };
  })();
  return ready;
}

/**
 * exp(SCALE * utility) per resident and place, with habit scaled per segment (move-in week has no habits yet),
 * and the outside option ("cook, skip, or eat on campus") per resident.
 */
export function expUtilities(s: StaticCity, habitBySegment: Record<string, number>) {
  const key = JSON.stringify(habitBySegment);
  const hit = s.expCache.get(key);
  if (hit) return hit;
  const exp = new Float64Array(s.nR * s.nP);
  const outside = new Float64Array(s.nR);
  for (let r = 0; r < s.nR; r++) {
    const res = s.residents[r]!;
    const habit = res.weights.habit * (habitBySegment[res.segment] ?? 1);
    let total = 0;
    for (let p = 0; p < s.nP; p++) {
      const u = s.base[r * s.nP + p]!;
      if (u === -Infinity) continue;
      const isFav = s.fav[r * 3] === p || s.fav[r * 3 + 1] === p || s.fav[r * 3 + 2] === p;
      const e = Math.exp(SCALE * (u + (isFav ? habit : 0)));
      exp[r * s.nP + p] = e;
      total += e;
    }
    outside[r] = total * Math.exp(-SCALE * OUTSIDE_GAP);
  }
  const out = { exp, outside };
  s.expCache.set(key, out);
  return out;
}
