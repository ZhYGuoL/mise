/**
 * The choice model: every number the simulator uses lives here.
 * Utilities are in logit units. A resident picks a place with probability proportional to exp(utility).
 */
import type { Day, Resident, Restaurant, Scenario, Segment } from "@mise/shared";
import { DIET_SUPPORT, normalizeCuisine, TIER_PRICE, type Cuisine } from "../city/cuisine";
import { unit } from "../city/rng";

/* ───────── geography ───────── */

/** Delivery radius. Places farther than this do not show up in the app for that resident. */
export const RADIUS_KM = 3;

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Door-to-door delivery minutes: prep and pickup, then the ride. */
export const deliveryMinutes = (km: number) => 18 + 5 * km;

/* ───────── money ───────── */

/** What delivery apps around Oakland charge today. Fees above this hurt, fees below it help. */
export const TYPICAL_DELIVERY_FEE = 2.99;
export const TYPICAL_SERVICE_PCT = 14;
/** People hate a dollar of fees more than a dollar of food. */
export const FEE_AVERSION = 1.2;
/** A dollar under budget is worth less than a dollar over budget costs. */
export const SAVINGS_FACTOR = 0.35;

/** All-in cost per person at typical fees. */
export const typicalCost = (menuPrice: number) =>
  menuPrice + TYPICAL_DELIVERY_FEE + (menuPrice * TYPICAL_SERVICE_PCT) / 100;

/** weights.price is negative per $ over budget. Under budget gives a smaller bonus. */
export function priceTerm(wPrice: number, cost: number, budget: number): number {
  const over = cost - budget;
  return over > 0 ? wPrice * over : wPrice * SAVINGS_FACTOR * over;
}

/**
 * Fees above or below what the market charges, for the concept only.
 * Same budget curve as the price, so a fee only hurts much when it pushes the meal over budget.
 */
export function feeTerm(wPrice: number, budget: number, deliveryFee: number, servicePct: number, menuPrice: number): number {
  const actual = menuPrice + deliveryFee + (menuPrice * servicePct) / 100;
  return FEE_AVERSION * (priceTerm(wPrice, actual, budget) - priceTerm(wPrice, typicalCost(menuPrice), budget));
}

/** Before 11 AM people want breakfast. Anything else is a hard sell. */
export const MORNING_PENALTY = -1.2;
export const isMorning = (hour: number) => hour >= 5 && hour < 11;

/* ───────── taste and reputation ───────── */

/** Taste for a place with several cuisine tokens: mostly the best match, a little the rest. */
export function tasteFor(weights: Record<string, number>, cuisines: readonly string[]): number {
  if (cuisines.length === 0) return 0;
  let best = -Infinity;
  let sum = 0;
  for (const c of cuisines) {
    const w = weights[c] ?? 0;
    best = Math.max(best, w);
    sum += w;
  }
  return 0.7 * best + (0.3 * sum) / cuisines.length;
}

/** Places without Google data are smaller and less known. */
export const UNKNOWN_RATING = 3.9;
export const UNKNOWN_REVIEWS = 60;

export function ratingTerm(wRating: number, rating: number | null): number {
  return wRating * ((rating ?? UNKNOWN_RATING) - 4.0);
}

/** Well-known places get picked more: log of review count, capped. */
export function popularityTerm(reviews: number | null): number {
  const r = Math.max(5, reviews ?? UNKNOWN_REVIEWS);
  return 0.3 * Math.max(-1.5, Math.min(1.5, Math.log(r / 400)));
}

/** Nobody has heard of the concept yet. Curious people (novelty > 0) mind less. */
export const NEW_PLACE_PENALTY = -0.35;
/** A launch deal ("20% off your first order") gets people to try a new place. */
export const DISCOVERY_BONUS = 0.35;

/** Diet: only one or two mains you can eat feels thin. */
export function dietVarietyTerm(compatibleMains: number): number {
  if (compatibleMains >= 3) return 0;
  if (compatibleMains === 2) return -0.3;
  if (compatibleMains === 1) return -0.75;
  return -Infinity;
}

/** The "cook at home or skip" option is worth this much below a full app of choices. */
export const OUTSIDE_GAP = 2.0;

/** Logit scale. Larger = people pick their best option more often. */
export const SCALE = 1.25;

/* ───────── competitor static utility ───────── */

export type PlaceModel = {
  cuisines: Cuisine[];
  menuPrice: number;
  rating: number | null;
  reviews: number | null;
  diet: { vegetarian: boolean; vegan: boolean; halal: boolean; gluten_free: boolean };
};

/** We do not have competitor menus. Each place gets fixed diet options, drawn from its cuisine's odds. */
function placeDiet(r: Restaurant, cuisines: Cuisine[]): PlaceModel["diet"] {
  const odds = (d: keyof PlaceModel["diet"]) => Math.max(0, ...cuisines.map((c) => DIET_SUPPORT[c][d]));
  const has = (d: keyof PlaceModel["diet"]) => unit(r.placeId, "diet", d) < odds(d);
  const vegan = has("vegan");
  return { vegan, vegetarian: vegan || has("vegetarian"), halal: has("halal"), gluten_free: has("gluten_free") };
}

export function placeModel(r: Restaurant): PlaceModel {
  const cuisines = r.cuisine.map((c) => normalizeCuisine(c)).filter((c): c is Cuisine => c !== null);
  return {
    cuisines,
    menuPrice: TIER_PRICE[r.priceTier ?? 2] ?? 16,
    rating: r.rating,
    reviews: r.reviews,
    diet: placeDiet(r, cuisines),
  };
}

/** Can this resident eat here at all? */
export function dietOk(resident: Pick<Resident, "diet">, diet: PlaceModel["diet"]): boolean {
  for (const d of resident.diet) {
    if (d === "vegan" && !diet.vegan) return false;
    if (d === "vegetarian" && !diet.vegetarian) return false;
    if (d === "halal" && !diet.halal && !diet.vegetarian) return false;
    if (d === "gluten_free" && !diet.gluten_free) return false;
  }
  return true;
}

export type Terms = { taste: number; price: number; time: number; rating: number; popularity: number; habit: number };

/** Utility terms of a real restaurant for one resident, at a known distance. Scenario-free. */
export function placeTerms(res: Resident, place: PlaceModel, km: number, isFavorite: boolean): Terms {
  return {
    taste: tasteFor(res.weights.cuisine, place.cuisines),
    price: priceTerm(res.weights.price, typicalCost(place.menuPrice), res.budgetPerMeal),
    time: res.weights.time * deliveryMinutes(km),
    rating: ratingTerm(res.weights.rating, place.rating),
    popularity: popularityTerm(place.reviews),
    habit: isFavorite ? res.weights.habit : 0,
  };
}

export const sumTerms = (t: Terms) => t.taste + t.price + t.time + t.rating + t.popularity + t.habit;

/* ───────── when people order ───────── */

/** Relative weight of each hour 0-23, per segment, on a weekday. */
export const HOUR_CURVE: Record<Segment, number[]> = {
  //            0    1    2    3    4    5    6    7    8    9    10   11   12   13   14   15   16   17   18   19   20   21   22   23
  undergrad: [0.9, 0.6, 0.3, 0.1, .02, .01, .02, .05, 0.1, .15, 0.3, 0.6, 0.9, 0.8, 0.5, 0.4, 0.5, 0.8, 1.1, 1.2, 1.1, 1.1, 1.2, 1.1],
  grad_student: [0.4, 0.2, 0.1, .03, .01, .01, .02, .05, 0.1, .15, 0.3, 0.6, 1.0, 0.8, 0.4, 0.3, 0.4, 0.8, 1.2, 1.3, 1.1, 0.8, 0.6, 0.5],
  young_professional: [.15, .08, .04, .01, .01, .01, .03, .08, .12, .15, 0.3, 0.7, 1.0, 0.7, 0.3, 0.2, 0.3, 0.8, 1.3, 1.4, 1.1, 0.6, .35, .25],
  family: [.03, .01, .01, .01, .01, .01, .03, 0.1, .15, 0.2, 0.3, 0.5, 0.7, 0.5, 0.2, 0.2, 0.5, 1.3, 1.6, 1.2, 0.6, 0.2, 0.1, .05],
  other: [.12, .06, .03, .01, .01, .01, .04, 0.1, .15, 0.2, 0.3, 0.6, 0.9, 0.6, 0.3, 0.3, 0.5, 1.0, 1.3, 1.1, 0.7, 0.4, 0.3, 0.2],
};

/** Delivery volume by day of week. */
export const DAY_FACTOR: Record<Day, number> = {
  Sunday: 1.15, Monday: 0.85, Tuesday: 0.85, Wednesday: 0.9, Thursday: 0.95, Friday: 1.2, Saturday: 1.15,
};

/** Hour weights for one segment on one scenario day. */
export function hourWeights(segment: Segment, scenario: Scenario): number[] {
  const w = HOUR_CURVE[segment].slice();
  const weekend = scenario.day === "Saturday" || scenario.day === "Sunday";
  const student = segment === "undergrad" || segment === "grad_student";
  if (weekend) for (const h of [10, 11, 12, 13]) w[h]! *= 1.5;
  // Friday and Saturday nights out: late on Fri/Sat, and the small hours of Sat/Sun.
  if (scenario.day === "Friday" || scenario.day === "Saturday") for (const h of [22, 23]) w[h]! *= student ? 1.4 : 1.15;
  if (weekend) for (const h of [0, 1, 2]) w[h]! *= student ? 1.6 : 1.2;
  if (scenario.event === "exam_week" && student) for (const h of [21, 22, 23, 0, 1, 2]) w[h]! *= 1.6;
  if (scenario.event === "home_game") for (const h of [17, 18, 19, 20, 21, 22]) w[h]! *= 1.2;
  return w;
}

export const WEATHER = {
  clear: { orders: 1, extraMinutes: 0 },
  rain: { orders: 1.2, extraMinutes: 5 },
  snow: { orders: 1.35, extraMinutes: 12 },
} as const;

/** Event effects per segment: more orders, and for move-in, no habits yet and more curiosity. */
export function eventEffect(event: Scenario["event"], segment: Segment) {
  const none = { orders: 1, habit: 1, novelty: 0, extraMinutes: 0 };
  switch (event) {
    case "exam_week":
      return segment === "undergrad" ? { ...none, orders: 1.35 } : segment === "grad_student" ? { ...none, orders: 1.2 } : none;
    case "home_game":
      return {
        ...none,
        extraMinutes: 6,
        orders: segment === "undergrad" ? 1.15 : segment === "young_professional" || segment === "other" ? 1.1 : 1,
      };
    case "move_in":
      if (segment === "undergrad") return { ...none, orders: 1.6, habit: 0.3, novelty: 0.3 };
      if (segment === "family") return { ...none, orders: 1.1 };
      if (segment === "grad_student") return { ...none, orders: 1.15, habit: 0.7, novelty: 0.15 };
      return none;
    default:
      return none;
  }
}

/** How many people one order feeds. */
export function partySize(household: Resident["household"], u: number): number {
  switch (household) {
    case "family_with_kids":
      return u < 0.5 ? 3 : 4;
    case "partner":
      return u < 0.6 ? 2 : 1;
    case "roommates":
      return u < 0.3 ? 2 : 1;
    default:
      return 1;
  }
}
