/**
 * POST /api/simulate core. Monte Carlo over one simulated day:
 *   (A) does each resident order this hour?  (B) from where? softmax over open places in range.
 * The concept and the "no concept" baseline share every random draw, so stolenFrom is exact per order.
 * No LLM calls here.
 */
import type { Concept, Prediction, Restaurant, Scenario, Segment } from "@mise/shared";
import { CUISINE_LABEL, type Cuisine } from "../city/cuisine";
import { DAYS } from "../city/load";
import { AREA_NAME } from "../city/residents";
import { hash, normal, pickIndex, poisson, rng, round } from "../city/rng";
import { buildConceptModel, conceptOpen, itemUtilities, type ConceptModel } from "./concept";
import { decide, type ResidentDecision } from "./explain";
import {
  CALIBRATION, DAY_FACTOR, RADIUS_KM, SCALE, WEATHER, daypartOf, deliveryMinutes, eventEffect, hourWeights, partySize, placeTerms, sumTerms, timeTerm,
} from "./model";
import { expUtilities, loadStatic, type StaticCity } from "./static";

export const SEGMENTS: Segment[] = ["undergrad", "grad_student", "young_professional", "family", "other"];

/** A resident "considered" the concept if it was within this much utility of what they picked. */
const NEAR = 1.5;
/** Day-to-day swing in overall delivery demand (1 sd, log). */
const DEMAND_SD = 0.06;
/** How unsure we are about how fast a new place gets discovered (1 sd, utility). */
const AWARENESS_SD = 0.25;
const MAX_FLOWS = 600;
const SAMPLE_POOL = 3000; // sampleResidentIds come from the first N. The prediction pane loads ?sample=3000.

type Code = Prediction["objections"][number]["code"];

type ObjectionAcc = {
  count: number;
  seg: number[];
  area: Map<string, number>;
  tag: Map<string, number>;
  mains: number[]; // compatible main count 0, 1, 2
  hour: Map<number, number>;
  cuisine: Map<string, number>;
  usual: number;
  unrated: number;
  cost: number[];
  budget: number[];
  place: Map<number, number>;
};

const newAcc = (): ObjectionAcc => ({
  count: 0, seg: [0, 0, 0, 0, 0], area: new Map(), tag: new Map(), mains: [0, 0, 0], hour: new Map(),
  cuisine: new Map(), usual: 0, unrated: 0, cost: [], budget: [], place: new Map(),
});

const bump = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const top = <K>(m: Map<K, number>): K | undefined => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function band(values: number[], digits = 0) {
  const s = [...values].sort((a, b) => a - b);
  return { p10: round(quantile(s, 0.1), digits), p50: round(quantile(s, 0.5), digits), p90: round(quantile(s, 0.9), digits) };
}

const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);
const money = (x: number) => (Number.isInteger(x) ? `$${x}` : `$${x.toFixed(2)}`);
const hourLabel = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);
const DIET_WORD: Record<string, string> = { vegetarian: "vegetarian", vegan: "vegan", halal: "halal", gluten_free: "gluten-free" };

export async function simulate(concept: Concept, scenario: Scenario): Promise<Prediction> {
  const t0 = performance.now();
  const s = await loadStatic();
  const { residents, restaurants, places, nR, nP } = s;
  const day = DAYS.indexOf(scenario.day);
  const runs = scenario.runs;
  const seed = scenario.seed ?? 20261107;

  const effects = SEGMENTS.map((g) => eventEffect(scenario.event, g));
  const habitBySeg = Object.fromEntries(SEGMENTS.map((g, i) => [g, effects[i]!.habit]));
  const { exp, outside } = expUtilities(s, habitBySeg);
  const cm = buildConceptModel(concept, scenario, residents);
  const nS = cm.states.length;
  const weather = WEATHER[scenario.weather];
  const hw = SEGMENTS.map((g) => hourWeights(g, scenario));
  const segIdx = Uint8Array.from(residents, (r) => SEGMENTS.indexOf(r.segment));

  // Rain, snow and game-day traffic slow every delivery. That makes cooking or skipping look better.
  const outsideAdj = new Float64Array(nR);
  for (let r = 0; r < nR; r++) {
    const extra = weather.extraMinutes + effects[segIdx[r]!]!.extraMinutes;
    outsideAdj[r] = outside[r]! * Math.exp(-SCALE * timeTerm(residents[r]!.weights.time, extra));
  }
  const openMinute = new Uint8Array(1440);
  for (let m = 0; m < 1440; m++) openMinute[m] = conceptOpen(concept, scenario.day, m) ? 1 : 0;

  // Per-run tallies.
  const ordersRun: number[] = [], revenueRun: number[] = [], marketRun: number[] = [];
  const hourRun: number[][] = Array.from({ length: 24 }, () => []);
  const segTotal = [0, 0, 0, 0, 0];
  const stolen = new Float64Array(nP);
  const gained = new Float64Array(nP); // orders an existing restaurant loses to others after an edit
  const baseExRun: number[] = [];
  // An existing restaurant replaces its real self. -1 = a brand-new concept.
  const ex = concept.existing ? restaurants.findIndex((p) => p.placeId === concept.existing!.placeId) : -1;
  const flowsRun: { r: number; t: number; p: number }[][] = [];
  const objections = new Map<Code, ObjectionAcc>();
  let considered = 0;

  for (let run = 0; run < runs; run++) {
    const rand = rng(hash(seed, "run", run));
    const demand = Math.exp(DEMAND_SD * normal(rand));
    // How fast people discover a new place is uncertain. A real place is already known.
    const aware = AWARENESS_SD * normal(rand) * (concept.existing ? 0 : 1);
    let orders = 0, revenue = 0, market = 0, baseEx = 0;
    const byHour = new Array(24).fill(0);
    const flows: { r: number; t: number; p: number }[] = [];

    for (let r = 0; r < nR; r++) {
      const res = residents[r]!;
      const g = segIdx[r]!;
      const lambda = (res.ordersPerWeek / 7) * DAY_FACTOR[scenario.day] * weather.orders * effects[g]!.orders * demand;
      const n = poisson(rand, lambda);
      for (let k = 0; k < n; k++) {
        // Fixed number of draws per order, whatever happens, so every concept version sees the same city.
        const hour = pickIndex(hw[g]!, rand());
        const minute = Math.floor(rand() * 60);
        const v = rand(), w = rand(), ui = rand(), up = rand(), ua = rand(), ud = rand();

        const open = s.openAt[day]![hour]!;
        const row = r * nP;
        // Today's city: every open place, including the real restaurant if the concept replaces one.
        const am = s.affMult[hour]!; // what people want at this time of day
        let others = outsideAdj[r]!;
        let eEx = 0;
        for (const j of open) {
          if (j === ex) eEx = exp[row + j]! * am[j]!;
          else others += exp[row + j]! * am[j]!;
        }
        const today = others + eEx;

        // Baseline: where would they order in today's city? (-1 = they do not order)
        let target = v * today - outsideAdj[r]!;
        let base = -1;
        if (target >= 0) {
          for (const j of open) {
            const e = exp[row + j]! * am[j]!;
            if (e === 0) continue;
            base = j;
            target -= e;
            if (target < 0) break;
          }
        }
        if (ex >= 0 && base === ex) baseEx++;

        const st = cm.stateOfHour[hour]!;
        const ck = r * nS + st;
        const isOpen = openMinute[hour * 60 + minute] === 1;
        const avail = isOpen && cm.inRadius[r] === 1 && cm.dietMains[r]! > 0;
        const uc = cm.utility[ck]! + aware;
        const ec = avail ? Math.exp(SCALE * uc) : 0;
        const withConcept = others + ec;

        // With the concept: it replaces the real place (if any) and joins the rest. One shared draw w keeps
        // as many choices as possible equal to today's, so the difference is the effect of the concept.
        // For a brand-new concept (eEx = 0) this is: concept if w < ec / (others + ec), else today's pick.
        let pick = base; // -2 = concept
        const exPicked = ex >= 0 && base === ex;
        if (ec >= eEx) {
          if (exPicked || w < 1 - today / withConcept) pick = -2;
        } else if (exPicked) {
          const keep = ec / withConcept / (eEx / today);
          if (w < keep) pick = -2;
          else {
            // The concept lost this customer. They go where they would without the real place.
            let t2 = ((w - keep) / (1 - keep)) * others - outsideAdj[r]!;
            pick = -1;
            if (t2 >= 0) {
              for (const j of open) {
                const e = j === ex ? 0 : exp[row + j]! * am[j]!;
                if (e === 0) continue;
                pick = j;
                t2 -= e;
                if (t2 < 0) break;
              }
            }
            if (pick >= 0) gained[pick]++;
          }
        }

        if (pick === -2) {
          const state = cm.states[st]!;
          const items = itemUtilities(res, cm, state);
          const pickW = items.utilities.map((u) => (u === -Infinity ? 0 : Math.exp(SCALE * u)));
          const main = cm.mains[pickIndex(pickW, ui)]!;
          const party = partySize(res.household, up);
          let ticket = party * state.prices[main]!;
          const pSide = res.household === "family_with_kids" ? 0.6 : 0.3;
          if (cm.sides.length && ua < pSide) ticket += state.prices[cm.sides[Math.floor((ua / pSide) * cm.sides.length)]!]!;
          if (cm.drinks.length && ud < 0.25) ticket += state.prices[cm.drinks[Math.floor((ud / 0.25) * cm.drinks.length)]!]!;
          orders++;
          market++;
          revenue += ticket;
          byHour[hour]++;
          segTotal[g]++;
          considered++;
          if (base >= 0 && base !== ex) stolen[base]++;
          flows.push({ r, t: hour * 60 + minute, p: -1 });
          continue;
        }
        if (pick < 0) continue;
        market++;
        flows.push({ r, t: hour * 60 + minute, p: pick });

        // Did they consider the concept? Compare with what they picked, term by term.
        const fav = s.fav[r * 3] === pick || s.fav[r * 3 + 1] === pick || s.fav[r * 3 + 2] === pick;
        const t = placeTerms(res, places[pick]!, s.km[row + pick]!, fav);
        t.habit *= effects[g]!.habit;
        const dp = daypartOf(hour);
        const uj = sumTerms(t) + s.aff[pick * 5 + dp]!;
        // Out of range: would they want it if it delivered to them? Judge it at the edge of the range.
        const ucSeen = cm.inRadius[r] === 0 ? uc - cm.time[r]! + timeTerm(res.weights.time, deliveryMinutes(RADIUS_KM)) : uc;
        if (ucSeen < uj - NEAR) continue;
        considered++;

        let code: Code | null = null;
        if (cm.inRadius[r] === 0) code = "too_far";
        else if (cm.dietMains[r] === 0) code = "no_diet_option";
        else if (!isOpen) code = "closed_when_hungry";
        else {
          const diffs: [Code, number][] = [
            ["too_expensive", cm.pricePart[ck]! - t.price],
            ["fee_too_high", cm.feePart[ck]!],
            ["too_far", cm.time[r]! - t.time],
            ["wrong_cuisine", cm.taste[r]! + cm.affinity[dp]! - t.taste - s.aff[pick * 5 + dp]!],
            ["unknown_new_place", cm.newPlace[r]! + aware - (t.rating + t.popularity + t.habit)],
            ["no_diet_option", cm.variety[r]!],
          ];
          const worst = diffs.sort((a, b) => a[1] - b[1])[0]!;
          if (worst[1] < -0.05) code = worst[0];
        }
        if (!code) continue;

        let acc = objections.get(code);
        if (!acc) objections.set(code, (acc = newAcc()));
        acc.count++;
        acc.seg[g]++;
        bump(acc.area, res.tractId);
        if (code === "no_diet_option") {
          bump(acc.tag, res.diet[0] ?? "vegetarian");
          acc.mains[Math.min(2, cm.dietMains[r]!)]++;
        }
        if (code === "closed_when_hungry") bump(acc.hour, hour);
        if (code === "wrong_cuisine") bump(acc.cuisine, places[pick]!.cuisines[0] ?? "american");
        if (code === "unknown_new_place") t.habit > t.rating + t.popularity ? acc.usual++ : acc.unrated++;
        if (code === "too_expensive") bump(acc.place, pick);
        if (code === "too_expensive" && acc.cost.length < 4000) {
          const items = itemUtilities(res, cm, cm.states[st]!);
          const price = cm.states[st]!.prices[cm.mains[items.best]!]!;
          acc.cost.push(price + cm.states[st]!.deliveryFee + (price * concept.serviceFeePct) / 100);
          acc.budget.push(res.budgetPerMeal);
        }
      }
    }

    ordersRun.push(orders);
    baseExRun.push(baseEx);
    revenueRun.push(revenue);
    marketRun.push(market);
    for (let h = 0; h < 24; h++) hourRun[h]!.push(byHour[h]);
    flowsRun.push(flows);
  }

  /* ───────── aggregate ───────── */

  const totalOrders = ordersRun.reduce((a, b) => a + b, 0);
  const totalRevenue = revenueRun.reduce((a, b) => a + b, 0);
  const totalMarket = marketRun.reduce((a, b) => a + b, 0);

  // Net orders each place loses to the concept, against today's city.
  const stolenFrom = [...stolen.entries()]
    .map(([j, n]) => ({ j, lost: (n - gained[j]!) / runs }))
    .filter((x) => x.lost >= 0.5)
    .sort((a, b) => b.lost - a.lost)
    .slice(0, 6)
    .map(({ j, lost }) => ({
      placeId: restaurants[j]!.placeId, name: restaurants[j]!.name, lat: restaurants[j]!.lat, lon: restaurants[j]!.lon,
      ordersLost: Math.max(1, Math.round(lost)),
    }));

  const objectionList = [...objections.entries()]
    .map(([code, acc]) => {
      const segI = acc.seg.indexOf(Math.max(...acc.seg));
      return {
        code,
        label: objectionLabel(code, acc, concept, restaurants.map((r) => r.name)),
        pct: round((100 * acc.count) / Math.max(1, considered), 1),
        segment: SEGMENTS[segI]!,
      };
    })
    .filter((o) => o.pct >= 1)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  // The time-lapse plays the run closest to the median, so the map matches the headline number.
  const mid = median(ordersRun);
  const flowRun = ordersRun.reduce((best, o, i) => (Math.abs(o - mid) < Math.abs(ordersRun[best]! - mid) ? i : best), 0);
  const all = flowsRun[flowRun]!;
  const samples = pickSamples(s, cm, concept, scenario, objectionList.map((o) => o.code), all);
  // Every sampled resident's order is on the map, so the panel and the map agree.
  const forced = samples.filter((x) => x.flow.p !== -1).map((x) => x.flow);
  const mine = all.filter((f) => f.p === -1).slice(0, 300);
  const others = all.filter((f) => f.p !== -1 && !forced.includes(f));
  const room = MAX_FLOWS - mine.length - forced.length;
  const stride = others.length / Math.max(1, room);
  const picked = room > 0 ? Array.from({ length: Math.min(room, others.length) }, (_, i) => others[Math.floor(i * stride)]!) : [];
  const orderFlows = [...mine, ...forced, ...picked]
    .sort((a, b) => a.t - b.t)
    .map((f) => ({
      residentId: residents[f.r]!.id,
      from: residents[f.r]!.home,
      hour: Math.floor(f.t / 60),
      minute: f.t % 60,
      restaurant: f.p === -1 ? ("concept" as const) : ("other" as const),
      ...(f.p === -1 ? {} : { placeId: restaurants[f.p]!.placeId }),
    }));

  return {
    conceptId: concept.id,
    conceptVersion: concept.version,
    scenario,
    orders: band(ordersRun),
    revenue: band(revenueRun),
    avgTicket: round(totalOrders ? totalRevenue / totalOrders : 0, 2),
    marketSharePct: round(totalMarket ? (100 * totalOrders) / totalMarket : 0, 1),
    avgTicketBand: band(ordersRun.map((o, i) => (o ? revenueRun[i]! / o : 0)), 2),
    marketSharePctBand: band(marketRun.map((m, i) => (m ? (100 * ordersRun[i]!) / m : 0)), 1),
    byHour: hourRun.map((v, hour) => ({ hour, ...band(v, 1) })),
    bySegment: SEGMENTS.map((segment, i) => ({
      segment,
      orders: round(segTotal[i]! / runs, 1),
      sharePct: round(totalOrders ? (100 * segTotal[i]!) / totalOrders : 0, 1),
    })),
    stolenFrom,
    objections: objectionList,
    orderFlows,
    sampleResidentIds: samples.map((x) => residents[x.flow.r]!.id),
    sampleDecisions: samples.map(({ d }) => ({
      residentId: d.residentId,
      wouldOrderFromConcept: d.wouldOrderFromConcept,
      choseInstead: d.choseInstead,
      hour: d.hour,
    })),
    calibration: { heldOutCorrelation: CALIBRATION.heldOut?.median ?? null, note: CALIBRATION.note },
    ...existingFields(ex >= 0 ? restaurants[ex]! : null, scenario, hourRun, baseExRun),
    computedMs: Math.round(performance.now() - t0),
  };
}

function objectionLabel(code: Code, acc: ObjectionAcc, concept: Concept, names: string[]): string {
  switch (code) {
    case "too_expensive": {
      const budget = Math.round(median(acc.budget));
      return median(acc.cost) > budget ? `over a ${money(budget)} budget with fees` : `pricier than ${names[top(acc.place) ?? 0] ?? "their usual"}`;
    }
    case "fee_too_high":
      return `${money(concept.deliveryFee)} delivery + ${concept.serviceFeePct}% service fee`;
    case "too_far": {
      const area = AREA_NAME[top(acc.area) ?? ""];
      return area ? `too far for ${area} residents` : "too far for residents";
    }
    case "no_diet_option": {
      const tag = DIET_WORD[top(acc.tag) ?? "vegetarian"]!;
      const n = acc.mains.indexOf(Math.max(...acc.mains));
      return n === 0 ? `no ${tag} main` : n === 1 ? `only one ${tag} main` : `only two ${tag} mains`;
    }
    case "wrong_cuisine":
      return `would rather have ${CUISINE_LABEL[(top(acc.cuisine) ?? "american") as Cuisine]}`;
    case "closed_when_hungry":
      return `closed at ${hourLabel(top(acc.hour) ?? 0)}`;
    case "unknown_new_place":
      if (acc.usual >= acc.unrated) return "loyal to their usual spot";
      return concept.existing ? "rated lower than their pick" : "new and unrated";
  }
}

type FlowEvent = { r: number; t: number; p: number };

/**
 * Up to six residents worth interviewing. Each one placed a real order in the run the map plays,
 * and that order agrees with the interview decision: the concept for a yes, the same other place for a no.
 * Order: the two strongest yeses, the closest no for each top objection, one hard no, then more noes.
 */
function pickSamples(
  s: StaticCity, cm: ConceptModel, concept: Concept, scenario: Scenario, topCodes: Code[], run: FlowEvent[],
): { d: ResidentDecision; flow: FlowEvent }[] {
  const byResident = new Map<number, FlowEvent[]>();
  for (const f of run) if (f.r < SAMPLE_POOL) byResident.set(f.r, [...(byResident.get(f.r) ?? []), f]);
  const pool: { d: ResidentDecision; flow: FlowEvent }[] = [];
  for (const [r, flows] of [...byResident.entries()].sort((a, b) => a[0] - b[0])) {
    if (flows.length !== 1) continue; // one order that day, so the map cannot show a different one
    const flow = flows[0]!;
    const d = decide(s, cm, r, r, concept, scenario);
    if (d.wouldOrderFromConcept ? flow.p === -1 : flow.p === d.choseInsteadIndex) pool.push({ d, flow });
  }
  const picked: typeof pool = [];
  const add = (pred: (d: ResidentDecision) => boolean) => {
    const hit = pool.filter((x) => !picked.includes(x) && pred(x.d)).sort((a, b) => b.d.margin - a.d.margin)[0];
    if (hit) picked.push(hit);
  };
  const seg = (d: ResidentDecision) => s.residents[Number(d.residentId.slice(1))]!.segment;
  add((d) => d.wouldOrderFromConcept && seg(d) === "undergrad");
  add((d) => d.wouldOrderFromConcept && seg(d) !== "undergrad");
  for (const code of topCodes.slice(0, 3)) add((d) => !d.wouldOrderFromConcept && d.reason === code);
  add((d) => d.blocked !== null);
  while (picked.length < 6) {
    const before = picked.length;
    add((d) => !d.wouldOrderFromConcept);
    if (picked.length === before) break;
  }
  return picked;
}

/** Pearson correlation. null if fewer than 3 points or no variation. */
export function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb);
    saa += (a[i]! - ma) ** 2;
    sbb += (b[i]! - mb) ** 2;
  }
  return saa === 0 || sbb === 0 ? null : sab / Math.sqrt(saa * sbb);
}

/**
 * Existing restaurant only: its orders in today's city, and Google's busy curve for the day next to
 * the simulated one. Correlation runs over the hours Google shows the place open.
 */
function existingFields(place: Restaurant | null, scenario: Scenario, hourRun: number[][], baseExRun: number[]) {
  if (!place) return {};
  const out: Pick<Prediction, "baselineOrders" | "observedByHour" | "observedCorrelation"> = { baselineOrders: band(baseExRun) };
  const google = place.popularTimes?.[scenario.day];
  if (!google) return out;
  const observedByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, busyPct: google[String(hour)] ?? 0 }));
  const openHours = observedByHour.filter((o) => o.busyPct > 0).map((o) => o.hour);
  const simP50 = openHours.map((h) => band(hourRun[h]!, 1).p50);
  const r = pearson(simP50, openHours.map((h) => observedByHour[h]!.busyPct));
  return { ...out, observedByHour, observedCorrelation: r === null ? null : round(r, 2) };
}
