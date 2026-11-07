/**
 * Dev script: the brief's three hand checks, plus a few more levers.
 * Run: bun server/src/sim/sanity.ts [Day]
 */
import path from "node:path";
import { Concept, Scenario, type Prediction } from "@mise/shared";
import { ROOT } from "../fixtures";
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

const far = await simulate(edit((c) => Object.assign(c.location, { lat: 40.4612, lon: -79.9255, neighborhood: "East Liberty" })), friday);
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

const t0 = performance.now();
const big = await simulate(base, { ...friday, runs: 100 });
console.log(`runs=100 in ${Math.round(performance.now() - t0)} ms (orders ${big.orders.p10}-${big.orders.p50}-${big.orders.p90})`);
checks.push(["runs=100 under 3 s", performance.now() - t0 < 3000]);

console.log();
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
