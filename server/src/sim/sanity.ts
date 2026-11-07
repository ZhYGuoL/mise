/**
 * Dev script: the brief's three hand checks, plus a few more levers.
 * Run: bun server/src/sim/sanity.ts [Day]
 */
import path from "node:path";
import { Concept, Scenario, type Prediction } from "@mise/shared";
import { ROOT } from "../fixtures";
import { TIER_PRICE } from "../city/cuisine";
import { loadCity } from "../city/load";
import { placeModel } from "./model";
import { explainResident } from "./explain";
import { simulate } from "./simulate";

const base = Concept.parse(await Bun.file(path.join(ROOT, "data/fixtures/concept.json")).json());
const friday = Scenario.parse({ day: process.argv[2] ?? "Friday" });
const seg = (p: Prediction, s: string) => p.bySegment.find((b) => b.segment === s)?.orders ?? 0;
const obj = (p: Prediction, code: string) => p.objections.find((o) => o.code === code)?.pct ?? 0;
const line = (name: string, p: Prediction) =>
  console.log(
    `${name.padEnd(22)} orders ${p.orders.p10}-${p.orders.p50}-${p.orders.p90}  rev $${p.revenue.p50}  share ${p.marketSharePct}%  ` +
      `ugrad ${seg(p, "undergrad")}  ticket $${p.avgTicket}  ${p.computedMs}ms | ` +
      p.objections.map((o) => `${o.code}:${o.pct}`).join(" "),
  );
const edit = (f: (c: Concept) => void) => {
  const c = structuredClone(base);
  f(c);
  return c;
};

const b = await simulate(base, friday);
line("fixture", b);
console.log("  objections:", b.objections.map((o) => `${o.label} (${o.pct}%, ${o.segment})`).join("; "));
console.log("  stolen:", b.stolenFrom.map((s) => `${s.name} ${s.ordersLost}`).join(", "));
console.log("  byHour p50:", b.byHour.map((h) => h.p50).join(" "));
console.log("  segments:", b.bySegment.map((s) => `${s.segment} ${s.orders}`).join(", "));

const checks: [string, boolean][] = [];

const cheaper = await simulate(edit((c) => c.menu.forEach((m) => (m.price = Math.round(m.price * 0.8 * 2) / 2))), friday);
line("20% cheaper", cheaper);
checks.push(["cheaper -> more undergrad orders", seg(cheaper, "undergrad") > seg(b, "undergrad")]);

const vegan = await simulate(
  edit((c) =>
    c.menu.push({
      id: "m7", name: "Vegan Japchae", description: "Glass noodles, vegetables, sesame.", price: 11,
      category: "main", tags: ["vegan", "vegetarian"], imageUrl: null,
    }),
  ),
  friday,
);
line("add a vegan main", vegan);
checks.push(["vegan main -> fewer diet objections", obj(vegan, "no_diet_option") < obj(b, "no_diet_option")]);

const farConcept = edit((c) => Object.assign(c.location, { lat: 40.4612, lon: -79.9255, neighborhood: "East Liberty" }));
const far = await simulate(farConcept, friday);
line("move to East Liberty", far);
const downtown = await simulate(edit((c) => Object.assign(c.location, { lat: 40.4406, lon: -79.9959, neighborhood: "Downtown" })), friday);
line("move to Downtown", downtown);
checks.push(["far from campus -> fewer orders", far.orders.p50 < b.orders.p50 && downtown.orders.p50 < far.orders.p50]);

const pricier = await simulate(edit((c) => c.menu.forEach((m) => (m.price = Math.round(m.price * 1.3 * 2) / 2))), friday);
line("30% pricier", pricier);
checks.push(["pricier -> fewer orders", pricier.orders.p50 < b.orders.p50]);

const freeDelivery = await simulate(edit((c) => (c.deliveryFee = 0)), friday);
line("free delivery", freeDelivery);
checks.push(["free delivery -> more orders", freeDelivery.orders.p50 > b.orders.p50]);

const early = await simulate(edit((c) => Object.values(c.hours).forEach((h) => h && (h.close = "21:00"))), friday);
line("close at 9 PM", early);
checks.push(["closing early -> fewer orders", early.orders.p50 < b.orders.p50]);

const rain = await simulate(base, { ...friday, weather: "rain" });
line("rain", rain);
const exams = await simulate(base, { ...friday, event: "exam_week" });
line("exam week", exams);
const monday = await simulate(base, { ...friday, day: "Monday" });
line("Monday", monday);
checks.push(["Monday < Friday", monday.orders.p50 < b.orders.p50]);

// Same city every time: an edit that changes nothing the model reads must not move a single number.
const renamed = await simulate(edit((c) => ((c.tagline = "Different words."), (c.version += 1))), friday);
checks.push(["tagline edit -> identical orders", JSON.stringify(renamed.orders) === JSON.stringify(b.orders) && renamed.revenue.p50 === b.revenue.p50]);

const wings = await simulate(edit((c) => (c.menu[0]!.price += 1)), friday);
line("wings +$1", wings);
checks.push(["one item +$1 -> orders same or lower", wings.orders.p50 <= b.orders.p50]);

const launch = await simulate(edit((c) => c.promos.push({ id: "p2", description: "20% off your first order" , discountPct: 20 })), friday);
line("launch promo 20%", launch);
checks.push(["launch promo -> more orders", launch.orders.p50 > b.orders.p50]);

// Sampled residents: each one is on the map, and the map agrees with their interview.
const { restaurants } = await loadCity();
for (const [name, c, p] of [["fixture", base, b], ["East Liberty", farConcept, far], ["Monday", base, monday]] as const) {
  let agree = 0, yes = 0;
  for (const id of p.sampleResidentIds) {
    const d = await explainResident(c, p.scenario, id);
    const flow = p.orderFlows.find((f) => f.residentId === id);
    if (!d || !flow) continue;
    if (d.wouldOrderFromConcept) yes++;
    const same = d.wouldOrderFromConcept
      ? flow.restaurant === "concept"
      : flow.restaurant === "other" && flow.placeId === restaurants[d.choseInsteadIndex]?.placeId;
    // The list shows sampleDecisions. It must be exactly what the interview computes.
    const listed = p.sampleDecisions?.find((x) => x.residentId === id);
    const listMatches =
      listed?.wouldOrderFromConcept === d.wouldOrderFromConcept && listed.choseInstead === d.choseInstead && listed.hour === d.hour;
    if (same && listMatches) agree++;
  }
  console.log(`${name}: ${p.sampleResidentIds.length} samples, ${yes} would order, ${agree} match the map and the interview`);
  checks.push([`${name}: sampled residents: list, map and interview agree`, p.sampleResidentIds.length >= 3 && agree === p.sampleResidentIds.length]);
}

// Existing restaurants: an unchanged import replaces its real self.
const city = await loadCity();
/** A plain import of a real place: its location, cuisine, open hours and price tier. */
function importPlace(name: string): Concept {
  const i = city.restaurants.findIndex((r) => r.name === name);
  const r = city.restaurants[i]!;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
  const isOpen = (d: number, h: number) => city.openAt[(d + 7) % 7]![h]!.includes(i);
  const hm = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  const hours = Object.fromEntries(
    days.map((day, d) => {
      let open = -1;
      for (let h = 5; h < 24 && open < 0; h++) if (isOpen(d, h)) open = h;
      if (open < 0) return [day, null];
      let close = open;
      while (close < open + 23 && (close < 24 ? isOpen(d, close) : isOpen(d + 1, close - 24))) close++;
      return [day, { open: hm(open), close: hm(close) }];
    }),
  ) as Concept["hours"];
  const model = placeModel(r);
  const price = TIER_PRICE[r.priceTier ?? 2]!;
  const tags = (["vegetarian", "vegan", "halal", "gluten_free"] as const).filter((d) => model.diet[d]);
  return Concept.parse({
    ...structuredClone(base),
    id: `existing-${i}`,
    name: r.name,
    cuisine: r.cuisine,
    location: { lat: r.lat, lon: r.lon, address: r.name, neighborhood: "Oakland" },
    hours,
    priceTier: r.priceTier ?? 2,
    deliveryFee: 2.99,
    serviceFeePct: 14,
    promos: [],
    menu: [0.85, 0.95, 1.05, 1.15].map((f, k) => ({
      id: `e${k}`, name: `Main ${k + 1}`, description: "Imported.", price: Math.round(price * f * 2) / 2,
      category: "main", tags: k === 0 ? tags : [], imageUrl: null,
    })),
    existing: { placeId: r.placeId, name: r.name, rating: r.rating, reviews: r.reviews, menuSource: "estimated" },
  });
}

for (const name of ["CHiKN", "Noodlehead", "Pizza Palermo", "Sushi Fuku"]) {
  const c = importPlace(name);
  const p = await simulate(c, friday);
  const today = p.baselineOrders?.p50 ?? 0;
  const stolenSum = p.stolenFrom.reduce((a, x) => a + x.ordersLost, 0);
  console.log(
    `existing ${name.padEnd(14)} orders ${p.orders.p50} vs today ${today}  stolen ${stolenSum}  ` +
      `google r=${p.observedCorrelation ?? "n/a"}  ${p.computedMs}ms`,
  );
  checks.push([`unchanged import of ${name} -> about its orders today`, today > 0 && Math.abs(p.orders.p50 - today) <= Math.max(3, 0.25 * today)]);
  checks.push([`unchanged import of ${name} -> stolenFrom near zero`, stolenSum <= Math.max(3, 0.15 * today)]);
  const cheaper = await simulate({ ...c, menu: c.menu.map((m) => ({ ...m, price: Math.round(m.price * 0.8 * 2) / 2 })) }, friday);
  const cheaperStolen = cheaper.stolenFrom.reduce((a, x) => a + x.ordersLost, 0);
  console.log(`  20% cheaper: orders ${cheaper.orders.p50} vs today ${cheaper.baselineOrders?.p50}  stolen ${cheaperStolen}`);
  // The extra orders come from many places, often under 0.5 each, so stolenFrom may not list them.
  checks.push([`${name} 20% cheaper -> more orders than today`, cheaper.orders.p50 > today]);
}

const t0 = performance.now();
const big = await simulate(base, { ...friday, runs: 100 });
console.log(`runs=100 in ${Math.round(performance.now() - t0)} ms (orders ${big.orders.p10}-${big.orders.p50}-${big.orders.p90})`);
checks.push(["runs=100 under 3 s", performance.now() - t0 < 3000]);

console.log();
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
