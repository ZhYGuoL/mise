/**
 * Why does one resident order (or not) from the concept? For Wave 2 interviews and sampleResidentIds.
 * Same model as the simulator, without randomness: their usual order hour, their best option.
 * The LLM must answer from these terms only.
 */
import type { Concept, InterviewAnswer, Prediction, Scenario } from "@mise/shared";
import { CUISINE_LABEL, type Cuisine } from "../city/cuisine";
import { DAYS } from "../city/load";
import { round } from "../city/rng";
import { buildConceptModel, conceptOpen, type ConceptModel } from "./concept";
import { RADIUS_KM, deliveryMinutes, eventEffect, hourWeights, placeTerms } from "./model";
import { loadStatic, type StaticCity } from "./static";

type Code = Prediction["objections"][number]["code"];

export type ResidentDecision = Omit<InterviewAnswer, "answer"> & {
  /** the hour this resident usually orders on this day */
  hour: number;
  /** concept utility minus best alternative; > 0 means the concept wins */
  margin: number;
  /** hard reason the concept was not an option at all */
  blocked: "too_far" | "no_diet_option" | "closed_when_hungry" | null;
  /** the term that hurt the concept most against their pick, null if the concept wins */
  reason: Code | null;
  /** index of the restaurant they pick instead, -1 if none */
  choseInsteadIndex: number;
};

const label = (cuisines: readonly string[]) => cuisines.map((c) => CUISINE_LABEL[c as Cuisine] ?? c).join(" and ") || "this food";

/**
 * Deterministic decision for resident r over their regular order hours (at least half as likely as
 * their peak hour). Reports the hour where the concept did best. `ci` is the resident's index inside
 * the concept model (equal to r when the model was built for the whole city).
 */
export function decide(s: StaticCity, cm: ConceptModel, ci: number, r: number, concept: Concept, scenario: Scenario): ResidentDecision {
  const weights = hourWeights(s.residents[r]!.segment, scenario);
  const peak = Math.max(...weights);
  let pick: ResidentDecision | null = null;
  weights.forEach((w, hour) => {
    if (w < 0.5 * peak) return;
    const d = decideAt(s, cm, ci, r, concept, scenario, hour);
    if (d.blocked === "closed_when_hungry") return;
    if (!pick || d.margin > pick.margin) pick = d;
  });
  return pick ?? decideAt(s, cm, ci, r, concept, scenario, weights.indexOf(peak));
}

/** Deterministic decision for resident r at one hour of the scenario day. */
export function decideAt(
  s: StaticCity, cm: ConceptModel, ci: number, r: number, concept: Concept, scenario: Scenario, hour: number,
): ResidentDecision {
  const res = s.residents[r]!;
  const day = DAYS.indexOf(scenario.day);
  const nS = cm.states.length;
  const ev = eventEffect(scenario.event, res.segment);
  const st = cm.stateOfHour[hour]!;
  const k = ci * nS + st;

  // Their best real option that hour.
  let best = -1;
  let bestU = -Infinity;
  for (const j of s.openAt[day]![hour]!) {
    const u0 = s.base[r * s.nP + j]!;
    if (u0 === -Infinity) continue;
    const fav = res.favorites.includes(s.restaurants[j]!.placeId);
    const u = u0 + (fav ? res.weights.habit * ev.habit : 0);
    if (u > bestU) [best, bestU] = [j, u];
  }

  const blocked =
    cm.inRadius[ci] === 0 ? ("too_far" as const)
    : cm.dietMains[ci] === 0 ? ("no_diet_option" as const)
    : !conceptOpen(concept, scenario.day, hour * 60 + 30) ? ("closed_when_hungry" as const)
    : null;
  const uc = cm.utility[k]!;
  const margin = best >= 0 ? uc - bestU : uc;
  const wouldOrder = blocked === null && margin >= 0;

  const breakdown: InterviewAnswer["breakdown"] = [];
  if (blocked === "too_far") breakdown.push({ factor: `outside the ${RADIUS_KM} km delivery range (${round(cm.km[ci]!, 1)} km away)`, value: -5 });
  if (blocked === "no_diet_option") breakdown.push({ factor: `no main that fits a ${res.diet.join(", ").replace("_", "-")} diet`, value: -5 });
  if (blocked === "closed_when_hungry") breakdown.push({ factor: `closed at ${hour}:00, when they usually order`, value: -5 });

  let reason: Code | null = blocked;
  if (best >= 0) {
    const place = s.places[best]!;
    const fav = res.favorites.includes(s.restaurants[best]!.placeId);
    const t = placeTerms(res, place, s.km[r * s.nP + best]!, fav);
    t.habit *= ev.habit;
    const name = s.restaurants[best]!.name;
    const cMin = Math.round(deliveryMinutes(cm.km[ci]!));
    const jMin = Math.round(deliveryMinutes(s.km[r * s.nP + best]!));
    // Positive values favor the concept, negative favor what they would pick instead.
    const terms: [Code, string, number][] = [
      ["wrong_cuisine", `taste: ${label(cm.cuisines)} vs ${label(place.cuisines)} at ${name}`, cm.taste[ci]! - t.taste],
      ["too_expensive", `price vs their $${res.budgetPerMeal} budget`, cm.pricePart[k]! - t.price],
      ["fee_too_high", "delivery fees vs the usual $2.99 + 14%", cm.feePart[k]!],
      ["too_far", `delivery time: ${cMin} min vs ${jMin} min`, cm.time[ci]! - t.time],
      [
        "unknown_new_place",
        fav ? `new place vs ${name}, a favorite` : `new place vs ${name}, ${s.restaurants[best]!.rating ?? "no"} stars`,
        cm.newPlace[ci]! - (t.rating + t.popularity + t.habit),
      ],
    ];
    const n = cm.dietMains[ci]!;
    if (cm.variety[ci]! < 0) terms.push(["no_diet_option", n === 1 ? "only one main fits their diet" : `only ${n} mains fit their diet`, cm.variety[ci]!]);
    for (const [, factor, value] of terms) breakdown.push({ factor, value: round(value, 2) });
    if (!blocked && !wouldOrder) {
      const worst = [...terms].sort((a, b) => a[2] - b[2])[0]!;
      reason = worst[2] < -0.05 ? worst[0] : null;
    }
  }
  breakdown.push({ factor: "total", value: blocked ? -5 : round(margin, 2) });

  return {
    residentId: res.id,
    wouldOrderFromConcept: wouldOrder,
    choseInstead: wouldOrder ? null : best >= 0 ? s.restaurants[best]!.name : null,
    breakdown,
    hour,
    margin: round(margin, 2),
    blocked,
    reason,
    choseInsteadIndex: wouldOrder ? -1 : best,
  };
}

/**
 * Wave 2 entry point: POST /api/residents/:id/ask calls this, then writes the answer from `breakdown`.
 * Without `hour`, it judges the resident's regular order hours and reports the one in `hour`.
 * For a resident in sampleResidentIds, this agrees with their order in orderFlows.
 */
export async function explainResident(
  concept: Concept, scenario: Scenario, residentId: string, hour?: number,
): Promise<ResidentDecision | null> {
  const s = await loadStatic();
  const r = s.residents.findIndex((x) => x.id === residentId);
  if (r < 0) return null;
  const cm = buildConceptModel(concept, scenario, [s.residents[r]!]);
  return hour === undefined ? decide(s, cm, 0, r, concept, scenario) : decideAt(s, cm, 0, r, concept, scenario, hour);
}
