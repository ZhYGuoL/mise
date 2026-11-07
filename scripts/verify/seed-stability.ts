/**
 * How much does the headline p50 move with the random seed, at 20 vs 100 vs 200 runs?
 * Run from repo root: bun scripts/verify/seed-stability.ts
 */
import { Concept } from "@mise/shared";
import { simulate } from "../../server/src/sim/simulate";
const concept = Concept.parse(await Bun.file(new URL("../../data/fixtures/concept.json", import.meta.url).pathname).json());
const seeds = [20261107, ...Array.from({ length: 9 }, (_, k) => 9000 + (k + 1) * 7919)];
for (const runs of [20, 100, 200]) {
  const t0 = performance.now();
  const p50s: number[] = [];
  for (const seed of seeds) p50s.push((await simulate(concept, { day: "Friday", weather: "clear", event: "none", runs, seed } as any)).orders.p50);
  const s = [...p50s].sort((a, b) => a - b);
  console.log(JSON.stringify({ runs, defaultSeed: p50s[0], min: s[0], max: s.at(-1), spread: s.at(-1)! - s[0]!, msPerSim: Math.round((performance.now() - t0) / seeds.length) }));
}
