/**
 * Does an optimized edit set still win on simulated days the optimizer never saw?
 * Runs the optimize loop on the fixture (it searches on seed 20261107), then scores the
 * owner's concept and the optimized one on 10 fresh seeds x 20 runs each (paired: same days for both).
 * Run from repo root: bun --env-file=.env scripts/verify/optimize-holdout.ts orders 90
 */
import { Concept, type ConceptEdit } from "@mise/shared";
import { runOptimize } from "../../server/src/optimize/loop";
import { applyEdits } from "../../server/src/agent/patch";
import { simulate } from "../../server/src/sim/simulate";

const concept = Concept.parse(await Bun.file(new URL("../../data/fixtures/concept.json", import.meta.url).pathname).json());
const metric = (process.argv[2] ?? "orders") as "orders" | "revenue";
const target = Number(process.argv[3] ?? 90);
const day = "Friday";
let finalEdits: ConceptEdit[] | null = null;
let summary = "";
await runOptimize({ concept, goal: { metric, target, scenario: { day, weather: "clear", event: "none", runs: 20 } } }, async (e) => {
  if (e.type === "edits" && e.needsApproval) finalEdits = e.edits;
  if (e.type === "text") summary += e.delta;
});
console.log("optimizer:", summary.trim());
if (!finalEdits) { console.log("no edits kept"); process.exit(0); }
const edits = finalEdits as ConceptEdit[];
console.log("edits:", edits.map((x) => `${x.path} ${JSON.stringify(x.previous)} -> ${JSON.stringify(x.value)}`).join(" | "));
const applied = applyEdits(concept, edits);
if (!applied.ok) throw new Error(applied.error);
const pick = (p: any) => (metric === "orders" ? p.orders.p50 : p.revenue.p50);
const rows: { seed: number; before: number; after: number }[] = [];
for (let k = 1; k <= 10; k++) {
  const seed = 9000 + k * 7919;
  const sc = { day, weather: "clear", event: "none", runs: 20, seed } as const;
  const before = pick(await simulate(concept, sc as any));
  const after = pick(await simulate(applied.concept, sc as any));
  rows.push({ seed, before, after });
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return (s[4]! + s[5]!) / 2; };
for (const r of rows) console.log(`seed ${r.seed}: ${r.before} -> ${r.after}`);
console.log(JSON.stringify({
  metric, target,
  freshSeeds: rows.length,
  medianBefore: med(rows.map((r) => r.before)),
  medianAfter: med(rows.map((r) => r.after)),
  afterBeatsBefore: rows.filter((r) => r.after > r.before).length,
  afterReachesTarget: rows.filter((r) => r.after >= target).length,
  minAfter: Math.min(...rows.map((r) => r.after)),
}));
