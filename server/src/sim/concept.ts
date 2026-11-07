/**
 * Turn a Concept into what the simulator needs per resident:
 * utility terms, per promo state, plus the menu the resident would order from.
 */
import type { Concept, Day, MenuItem, Resident, Scenario } from "@mise/shared";
import { normalizeCuisines } from "../city/cuisine";
import { hash, normal, rng } from "../city/rng";
import {
  DISCOVERY_BONUS, MORNING_PENALTY, NEW_PLACE_PENALTY, PROMO_BONUS, RADIUS_KM, SCALE, deliveryMinutes, dietVarietyTerm, distanceKm,
  eventEffect, feeTerm, isMorning, popularityTerm, priceTerm, ratingTerm, tasteFor, typicalCost,
} from "./model";

const DAYS: Day[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Is the concept open at this minute of this day? Handles closes past midnight. */
export function conceptOpen(concept: Concept, day: Day, minute: number): boolean {
  const d = DAYS.indexOf(day);
  const today = concept.hours[day];
  if (today) {
    const o = toMin(today.open), c = toMin(today.close);
    if (c > o ? minute >= o && minute < c : minute >= o) return true;
  }
  const yesterday = concept.hours[DAYS[(d + 6) % 7]!];
  if (yesterday) {
    const o = toMin(yesterday.open), c = toMin(yesterday.close);
    if (c <= o && minute < c) return true;
  }
  return false;
}

/* ───────── promos ───────── */

type PromoEffect = { pct: number; dollars: number; freeDelivery: boolean; discovery: boolean; items: Set<string> | null };

function promoEffect(p: Concept["promos"][number], menu: MenuItem[]): PromoEffect {
  const text = p.description.toLowerCase();
  const dollars = Number(text.match(/\$\s*(\d+(?:\.\d+)?)\s*off/)?.[1] ?? 0);
  const pct = p.discountPct ?? Number(text.match(/(\d+(?:\.\d+)?)\s*%\s*off/)?.[1] ?? 0);
  const ids = p.appliesTo?.length ? new Set(p.appliesTo.filter((id) => menu.some((m) => m.id === id))) : null;
  const discovery = /first order|new customer|grand opening|opening week|launch|try us/.test(text);
  return { pct, dollars: pct ? 0 : dollars, freeDelivery: /free delivery/.test(text), discovery, items: ids };
}

function promoActive(p: Concept["promos"][number], day: Day, minute: number): boolean {
  if (p.days?.length && !p.days.includes(day)) return false;
  if (!p.hours) return true;
  const s = toMin(p.hours[0]), e = toMin(p.hours[1]);
  return e > s ? minute >= s && minute < e : minute >= s || minute < e;
}

/** One pricing state of the concept: which promos are on, and whether it is late night. */
export type PriceState = {
  prices: number[]; // per menu item, after promos
  promoted: boolean[];
  deliveryFee: number;
  lateNight: boolean;
  morning: boolean;
  discovery: boolean;
};

/* ───────── per resident ───────── */

export type ConceptModel = {
  concept: Concept;
  cuisines: string[];
  menu: MenuItem[];
  /** indices into menu of the things people order as their meal */
  mains: number[];
  sides: number[];
  drinks: number[];
  /** priceState index for each hour of the scenario day */
  stateOfHour: number[];
  states: PriceState[];
  /** per resident */
  km: Float32Array;
  inRadius: Uint8Array;
  /** compatible main count; 0 = nothing they can eat */
  dietMains: Uint8Array;
  taste: Float32Array;
  time: Float32Array;
  newPlace: Float32Array;
  variety: Float32Array;
  /** [resident * nStates + state] */
  menuPart: Float32Array;
  pricePart: Float32Array;
  feePart: Float32Array;
  /** total concept utility (not scaled), with the hypothetical if blocked by diet */
  utility: Float32Array;
};

function dietOkItem(diet: Resident["diet"], item: MenuItem): boolean {
  for (const d of diet) {
    if (d === "vegan" && !item.tags.includes("vegan")) return false;
    if (d === "vegetarian" && !item.tags.includes("vegetarian") && !item.tags.includes("vegan")) return false;
    if (d === "halal" && !item.tags.some((t) => t === "halal" || t === "vegetarian" || t === "vegan")) return false;
    if (d === "gluten_free" && !item.tags.includes("gluten_free")) return false;
  }
  return true;
}

/** Fixed taste for one item, so editing a price does not reshuffle who likes what. */
function itemTaste(res: Resident, item: MenuItem, state: PriceState): number {
  const r = rng(hash(res.id, item.id));
  let u = 0.45 * normal(r);
  if (item.tags.includes("spicy")) u += res.household === "family_with_kids" ? -0.35 : 0.3 * normal(rng(hash(res.id, "spicy"))) + 0.05;
  if (item.tags.includes("late_night") && state.lateNight) u += 0.25;
  if (item.category === "combo" && res.household === "family_with_kids") u += 0.3;
  return u;
}

export type ItemChoice = { utilities: number[]; best: number };

/** Utility of each main for this resident in this state. */
export function itemUtilities(res: Resident, m: ConceptModel, state: PriceState, ignoreDiet = false): ItemChoice {
  const c = m.concept;
  const utilities: number[] = [];
  let best = -1;
  for (const i of m.mains) {
    const item = m.menu[i]!;
    if (!ignoreDiet && !dietOkItem(res.diet, item)) {
      utilities.push(-Infinity);
      continue;
    }
    const price = state.prices[i]!;
    const u =
      priceTerm(res.weights.price, typicalCost(price), res.budgetPerMeal) +
      feeTerm(res.weights.price, res.budgetPerMeal, state.deliveryFee, c.serviceFeePct, price) +
      (state.promoted[i] ? PROMO_BONUS : 0) +
      itemTaste(res, item, state);
    utilities.push(u);
    if (best < 0 || u > utilities[best]!) best = utilities.length - 1;
  }
  return { utilities, best };
}

export function buildConceptModel(concept: Concept, scenario: Scenario, residents: Resident[]): ConceptModel {
  const menu = concept.menu;
  let mains = menu.flatMap((m, i) => (m.category === "main" || m.category === "combo" ? [i] : []));
  if (mains.length === 0) mains = menu.map((_, i) => i);
  const sides = menu.flatMap((m, i) => (m.category === "side" || m.category === "dessert" ? [i] : []));
  const drinks = menu.flatMap((m, i) => (m.category === "drink" ? [i] : []));

  // Price states by hour of the scenario day (checked at half past).
  const effects = concept.promos.map((p) => promoEffect(p, menu));
  const states: PriceState[] = [];
  const keys: string[] = [];
  const stateOfHour: number[] = [];
  for (let h = 0; h < 24; h++) {
    const minute = h * 60 + 30;
    const on = concept.promos.map((p) => promoActive(p, scenario.day, minute));
    const lateNight = h >= 22 || h < 4;
    const morning = isMorning(h);
    const key = `${on.map(Number).join("")}|${lateNight}|${morning}`;
    let idx = keys.indexOf(key);
    if (idx < 0) {
      const prices = menu.map((m) => m.price);
      const promoted = menu.map(() => false);
      let deliveryFee = concept.deliveryFee;
      let discovery = false;
      effects.forEach((e, k) => {
        if (!on[k]) return;
        if (e.freeDelivery) deliveryFee = 0;
        if (e.discovery) discovery = true;
        menu.forEach((m, i) => {
          if (e.items && !e.items.has(m.id)) return;
          if (!e.pct && !e.dollars) return;
          prices[i] = Math.max(0, prices[i]! * (1 - e.pct / 100) - e.dollars);
          promoted[i] = true;
        });
      });
      states.push({ prices, promoted, deliveryFee, lateNight, morning, discovery });
      keys.push(key);
      idx = states.length - 1;
    }
    stateOfHour.push(idx);
  }

  const n = residents.length;
  const nS = states.length;
  const cuisines = normalizeCuisines(concept.cuisine);
  const existing = concept.existing ?? null;
  const servesBreakfast = cuisines.includes("breakfast") || cuisines.includes("cafe");
  const m: ConceptModel = {
    concept, cuisines, menu, mains, sides, drinks, stateOfHour, states,
    km: new Float32Array(n), inRadius: new Uint8Array(n), dietMains: new Uint8Array(n),
    taste: new Float32Array(n), time: new Float32Array(n), newPlace: new Float32Array(n), variety: new Float32Array(n),
    menuPart: new Float32Array(n * nS), pricePart: new Float32Array(n * nS), feePart: new Float32Array(n * nS),
    utility: new Float32Array(n * nS),
  };

  for (let r = 0; r < n; r++) {
    const res = residents[r]!;
    const km = distanceKm(res.home.lat, res.home.lon, concept.location.lat, concept.location.lon);
    const ev = eventEffect(scenario.event, res.segment);
    const compatible = mains.filter((i) => dietOkItem(res.diet, menu[i]!)).length;
    m.km[r] = km;
    m.inRadius[r] = km <= RADIUS_KM ? 1 : 0;
    m.dietMains[r] = Math.min(255, compatible);
    m.taste[r] = tasteFor(res.weights.cuisine, cuisines);
    m.time[r] = res.weights.time * deliveryMinutes(km);
    // A new place is unknown. A real place brings its rating, its review count, and its regulars.
    m.newPlace[r] = existing
      ? ratingTerm(res.weights.rating, existing.rating) +
        popularityTerm(existing.reviews) +
        (res.favorites.includes(existing.placeId) ? res.weights.habit * ev.habit : 0)
      : NEW_PLACE_PENALTY + res.weights.novelty + ev.novelty;
    // Blocked by diet: keep the hypothetical so we can tell who would have ordered.
    m.variety[r] = compatible === 0 || res.diet.length === 0 ? 0 : dietVarietyTerm(compatible);

    for (let s = 0; s < nS; s++) {
      const choice = itemUtilities(res, m, states[s]!, compatible === 0);
      // Menu value: log of the mean of exp, so a long menu is not free utility.
      let sum = 0, count = 0;
      for (const u of choice.utilities) if (u > -Infinity) { sum += Math.exp(SCALE * u); count++; }
      const menuPart = Math.log(sum / count) / SCALE;
      const bestPrice = states[s]!.prices[mains[choice.best]!]!;
      const k = r * nS + s;
      m.menuPart[k] = menuPart;
      m.pricePart[k] = priceTerm(res.weights.price, typicalCost(bestPrice), res.budgetPerMeal);
      m.feePart[k] = feeTerm(res.weights.price, res.budgetPerMeal, states[s]!.deliveryFee, concept.serviceFeePct, bestPrice);
      const morning = states[s]!.morning && !servesBreakfast ? MORNING_PENALTY : 0;
      const discovery = states[s]!.discovery ? DISCOVERY_BONUS : 0;
      m.utility[k] = m.taste[r]! + m.time[r]! + m.newPlace[r]! + discovery + m.variety[r]! + menuPart + morning;
    }
  }
  return m;
}
