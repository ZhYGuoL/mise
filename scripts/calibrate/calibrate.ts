/**
 * Calibrate the simulator against Google popular times.
 * Run: bun scripts/calibrate/calibrate.ts
 *
 * Target: for each of the 64 places with popular times, the hourly SHAPE of its week
 * (relative busyness on every open day-hour). Google shows foot traffic, not delivery.
 * Model: expected orders per place per day-hour in the baseline city (no concept), computed exactly
 * from the choice model, not by Monte Carlo.
 * Fit: per-segment hour curves, day factors and cuisine time-of-day affinities, by gradient ascent on the
 * mean per-place correlation, on a fixed 80% of places. Then score the held-out 20% against the
 * hand-set model and a naive city-average curve. The output does not depend on a previous run.
 */
import path from "node:path";
import type { Day, Segment } from "@mise/shared";
import { hash, rng, round } from "../../server/src/city/rng";
import { DAYS } from "../../server/src/city/load";
import {
  HAND_DAY_FACTOR, HAND_HOUR_CURVE, HAND_SCALE, HAND_TIME_SCALE, HOUR_CURVE, OUTSIDE_GAP, TIME_SCALE, affinityPrior, daypartOf, deliveryMinutes,
  hourWeights,
} from "../../server/src/sim/model";
import { loadStatic } from "../../server/src/sim/static";
import { pearson } from "../../server/src/sim/simulate";

const ROOT = path.resolve(import.meta.dir, "../..");
const SEED = 20261107;
const SEGMENTS: Segment[] = ["undergrad", "grad_student", "young_professional", "family", "other"];
const G = SEGMENTS.length;
const HELD_OUT_SHARE = 0.2;

const s = await loadStatic();
const { residents, restaurants, nR, nP } = s;

/* ───────── targets: Google popular times from the raw CSV ───────── */

const csv = (await Bun.file(path.join(ROOT, "data/raw/popular_times_long.csv")).text()).trim().split("\n").slice(1);
const google = new Map<string, Map<string, number>>(); // placeId -> "d,h" -> busy
for (const line of csv) {
  const m = line.match(/^([^,]+),(?:"[^"]*"|[^,]*),(\w+),(\d+),(\d+)$/);
  if (!m) continue;
  const [, id, day, hour, busy] = m;
  const d = DAYS.indexOf(day as Day);
  if (!google.has(id!)) google.set(id!, new Map());
  google.get(id!)!.set(`${d},${hour}`, Number(busy));
}

type Target = { idx: number; placeId: string; name: string; slots: [number, number][]; busy: number[] };
const targets: Target[] = [];
for (const [placeId, curve] of google) {
  const idx = restaurants.findIndex((r) => r.placeId === placeId);
  if (idx < 0) continue;
  const slots: [number, number][] = [];
  const busy: number[] = [];
  for (let d = 0; d < 7; d++)
    for (let h = 0; h < 24; h++) {
      const b = curve.get(`${d},${h}`) ?? 0;
      if (b > 0) (slots.push([d, h]), busy.push(b));
    }
  if (slots.length >= 10) targets.push({ idx, placeId, name: restaurants[idx]!.name, slots, busy });
}
const T = targets.length;
const tIndex = new Int16Array(nP).fill(-1);
targets.forEach((t, k) => (tIndex[t.idx] = k));

// Fixed split by seed.
const order = targets.map((_, k) => k);
const shuffle = rng(hash(SEED, "calibration-split"));
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(shuffle() * (i + 1));
  [order[i], order[j]] = [order[j]!, order[i]!];
}
const nTest = Math.round(T * HELD_OUT_SHARE);
const test = order.slice(0, nTest).sort((a, b) => a - b);
const train = order.slice(nTest).sort((a, b) => a - b);
console.log(`${T} places with popular times: ${train.length} train, ${test.length} held out`);

/* ───────── choice part: A[g][d][h][t] = expected orders for place t from segment g, per unit of hour share ───────── */

// Day modifiers (weekend brunch, Friday nights) stay as hand-set multipliers on top of the fitted curve.
const MOD = SEGMENTS.map((g) =>
  DAYS.map((day) => {
    const w = hourWeights(g, { day, weather: "clear", event: "none", runs: 1 });
    // Round off float noise so the fit does not depend on which curve file was loaded.
    return w.map((x, h) => Math.round((x / HOUR_CURVE[g][h]!) * 1e6) / 1e6);
  }),
);

const segOf = Uint8Array.from(residents, (r) => SEGMENTS.indexOf(r.segment));

// Cuisine time-of-day affinities: one row of 5 per cuisine that appears in the data. Others keep the prior.
const CUISINES_USED = [...new Set(targets.flatMap((t) => s.places[t.idx]!.cuisines))].sort();
const C = CUISINES_USED.length;
const aff0 = Float64Array.from(CUISINES_USED.flatMap((c) => affinityPrior(c)));

/** Per place and daypart, the average affinity of its cuisines. Same rule as affinityFor() in the model. */
function placeAff(aff: Float64Array): Float32Array {
  const out = new Float32Array(nP * 5);
  for (let p = 0; p < nP; p++) {
    const cs = s.places[p]!.cuisines;
    for (let k = 0; k < 5; k++) {
      if (cs.length === 0) {
        out[p * 5 + k] = affinityPrior("")[k]!;
        continue;
      }
      let x = 0;
      for (const c of cs) {
        const i = CUISINES_USED.indexOf(c);
        x += i >= 0 ? aff[i * 5 + k]! : affinityPrior(c)[k]!;
      }
      out[p * 5 + k] = x / cs.length;
    }
  }
  return out;
}

/** A[g][d][h][t]: expected orders for place t from segment g, per unit of hour share. Exact, same rule as the simulator. */
function choiceTable(scale: number, timeScale: number, pa: Float32Array): Float64Array {
  const A = new Float64Array(G * 7 * 24 * T);
  const e = new Float64Array(nP);
  const eK = Array.from({ length: 5 }, () => new Float64Array(nP));
  const am = Array.from({ length: 5 }, (_, k) => Float64Array.from({ length: nP }, (_, p) => Math.exp(scale * pa[p * 5 + k]!)));
  for (let r = 0; r < nR; r++) {
    const res = residents[r]!;
    let total = 0;
    for (let p = 0; p < nP; p++) {
      let u = s.base[r * nP + p]!;
      if (u === -Infinity) {
        e[p] = 0;
        continue;
      }
      u += (timeScale - TIME_SCALE) * res.weights.time * deliveryMinutes(s.km[r * nP + p]!);
      if (s.fav[r * 3] === p || s.fav[r * 3 + 1] === p || s.fav[r * 3 + 2] === p) u += res.weights.habit;
      e[p] = Math.exp(scale * u);
      total += e[p]!;
    }
    for (let k = 0; k < 5; k++) for (let p = 0; p < nP; p++) eK[k]![p] = e[p]! * am[k]![p]!;
    const outside = total * Math.exp(-scale * OUTSIDE_GAP);
    const rate = res.ordersPerWeek / 7;
    const g = segOf[r]!;
    for (let d = 0; d < 7; d++)
      for (let h = 0; h < 24; h++) {
        const open = s.openAt[d]![h]!;
        if (open.length === 0) continue;
        const ek = eK[daypartOf(h)]!;
        let S = outside;
        for (const j of open) S += ek[j]!;
        const coef = rate / S;
        const off = ((g * 7 + d) * 24 + h) * T;
        for (const j of open) {
          const t = tIndex[j]!;
          if (t >= 0) A[off + t] += ek[j]! * coef;
        }
      }
  }
  return A;
}

/* ───────── model curve and objective ───────── */

// theta[g*24+h] = log hour weight, delta[d] = log day factor, aff[c*5+k] = cuisine affinity
type Params = { theta: Float64Array; delta: Float64Array; aff: Float64Array };

/** Per (g,d,h): day factor x share of segment g's day orders in hour h. */
function hourShares(p: Params): Float64Array {
  const W = new Float64Array(G * 7 * 24);
  for (let g = 0; g < G; g++)
    for (let d = 0; d < 7; d++) {
      let z = 0;
      for (let h = 0; h < 24; h++) z += Math.exp(p.theta[g * 24 + h]!) * MOD[g]![d]![h]!;
      const df = Math.exp(p.delta[d]!);
      for (let h = 0; h < 24; h++) W[(g * 7 + d) * 24 + h] = (df * Math.exp(p.theta[g * 24 + h]!) * MOD[g]![d]![h]!) / z;
    }
  return W;
}

/**
 * Simulated orders for target t on its open slots. `fac` corrects for an affinity change since A was built
 * (first order: the place's own share moves, the rest of the city stays). null = exact.
 */
function simCurve(A: Float64Array, W: Float64Array, t: number, fac: Float64Array | null = null): number[] {
  return targets[t]!.slots.map(([d, h]) => {
    let x = 0;
    for (let g = 0; g < G; g++) x += W[(g * 7 + d) * 24 + h]! * A[((g * 7 + d) * 24 + h) * T + t]!;
    return fac ? x * fac[t * 5 + daypartOf(h)]! : x;
  });
}

function affFactor(paBuilt: Float32Array, aff: Float64Array): Float64Array {
  const pa = placeAff(aff);
  const fac = new Float64Array(T * 5);
  for (let t = 0; t < T; t++)
    for (let k = 0; k < 5; k++) fac[t * 5 + k] = Math.exp(HAND_SCALE * (pa[targets[t]!.idx * 5 + k]! - paBuilt[targets[t]!.idx * 5 + k]!));
  return fac;
}

const corrOf = (A: Float64Array, W: Float64Array, t: number, fac: Float64Array | null = null) =>
  pearson(simCurve(A, W, t, fac), targets[t]!.busy) ?? 0;

const theta0 = Float64Array.from(SEGMENTS.flatMap((g) => HAND_HOUR_CURVE[g].map(Math.log)));
const delta0 = Float64Array.from(DAYS.map((d) => Math.log(HAND_DAY_FACTOR[d])));
const LAMBDA_SMOOTH = 0.02; // hour curves should be smooth
const LAMBDA_PRIOR = 0.003; // and stay near the hand-set shape where data is thin (3-6 AM)
const LAMBDA_AFF = 0.01; // affinities stay near the prior unless the data says otherwise

function penalty(p: Params): number {
  let x = 0;
  for (let g = 0; g < G; g++)
    for (let h = 0; h < 24; h++) {
      const a = p.theta[g * 24 + ((h + 23) % 24)]!, b = p.theta[g * 24 + h]!, c = p.theta[g * 24 + ((h + 1) % 24)]!;
      x += LAMBDA_SMOOTH * (a - 2 * b + c) ** 2 + LAMBDA_PRIOR * (b - theta0[g * 24 + h]!) ** 2;
    }
  for (let i = 0; i < p.aff.length; i++) x += LAMBDA_AFF * (p.aff[i]! - aff0[i]!) ** 2;
  return x;
}

/** Adam on finite-difference gradients over all three parameter groups, on the training places. */
function fit(A: Float64Array, paBuilt: Float32Array, start: Params, steps: number): Params {
  const p: Params = { theta: Float64Array.from(start.theta), delta: Float64Array.from(start.delta), aff: Float64Array.from(start.aff) };
  const groups = [p.theta, p.delta, p.aff];
  const n = groups.reduce((a, g) => a + g.length, 0);
  const locate = (i: number): [Float64Array, number] => {
    for (const g of groups) {
      if (i < g.length) return [g, i];
      i -= g.length;
    }
    throw new Error("index");
  };
  const J = () => {
    const W = hourShares(p);
    const fac = affFactor(paBuilt, p.aff);
    return train.reduce((a, t) => a + corrOf(A, W, t, fac), 0) / train.length - penalty(p);
  };
  const m = new Float64Array(n), v = new Float64Array(n);
  const lr = 0.04, b1 = 0.9, b2 = 0.999, eps = 1e-3;
  for (let step = 1; step <= steps; step++) {
    const grad = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const [g, j] = locate(i);
      const x = g[j]!;
      g[j] = x + eps;
      const up = J();
      g[j] = x - eps;
      const down = J();
      g[j] = x;
      grad[i] = (up - down) / (2 * eps);
    }
    for (let i = 0; i < n; i++) {
      m[i] = b1 * m[i]! + (1 - b1) * grad[i]!;
      v[i] = b2 * v[i]! + (1 - b2) * grad[i]! ** 2;
      const mh = m[i]! / (1 - b1 ** step), vh = v[i]! / (1 - b2 ** step);
      const [g, j] = locate(i);
      g[j] = g[j]! + (lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
  }
  return p;
}

/* ───────── run ───────── */

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2;
};
const meanOver = (A: Float64Array, p: Params, set: number[]) => {
  const W = hourShares(p);
  return set.reduce((a, t) => a + corrOf(A, W, t), 0) / set.length;
};

// Logit and travel-time scales: a 3x3 grid (1.0-1.5, 0.75-1.25) moved the training r by under 0.01,
// so they stay at the hand-set values and the fit spends its freedom on curves and affinities.
const scale = HAND_SCALE, timeScale = HAND_TIME_SCALE;
const handParams: Params = { theta: Float64Array.from(theta0), delta: Float64Array.from(delta0), aff: Float64Array.from(aff0) };
let t0 = performance.now();
const handA = choiceTable(scale, timeScale, placeAff(aff0));
console.log(`choice table: ${Math.round(performance.now() - t0)} ms, train mean r before fit ${meanOver(handA, handParams, train).toFixed(3)}`);

// Alternate: fit with the city fixed, rebuild the city's choices with the new affinities, fit again.
let p = handParams;
let A = handA;
let pa = placeAff(aff0);
for (const steps of [250, 150, 150]) {
  t0 = performance.now();
  p = fit(A, pa, p, steps);
  pa = placeAff(p.aff);
  A = choiceTable(scale, timeScale, pa);
  console.log(`fit ${steps} steps: train mean r ${meanOver(A, p, train).toFixed(3)} exact (${Math.round(performance.now() - t0)} ms)`);
}
const best = { A, p, scale, timeScale };

// Held-out scores, all exact.
const W = hourShares(best.p);
const Whand = hourShares(handParams);
const fitted = test.map((t) => corrOf(best.A, W, t));
const uncal = test.map((t) => corrOf(handA, Whand, t));
// Naive: every place gets the city-wide average curve from the training places. Two versions; we keep
// whichever scores higher on the held-out places, so the comparison is against the stronger baseline.
const naiveCurves = [false, true].map((openOnly) => {
  const sum = new Float64Array(7 * 24), cnt = new Float64Array(7 * 24);
  for (const t of train) {
    const busy = new Map(targets[t]!.slots.map(([d, h], k) => [d * 24 + h, targets[t]!.busy[k]!]));
    for (let k = 0; k < 7 * 24; k++) {
      const b = busy.get(k) ?? 0;
      if (openOnly && b === 0) continue;
      sum[k] += b;
      cnt[k]++;
    }
  }
  return Array.from(sum, (x, k) => (cnt[k] ? x / cnt[k]! : 0));
});
const naiveScores = naiveCurves.map((curve) =>
  test.map((t) => pearson(targets[t]!.slots.map(([d, h]) => curve[d * 24 + h]!), targets[t]!.busy) ?? 0),
);
const naive = median(naiveScores[0]!) >= median(naiveScores[1]!) ? naiveScores[0]! : naiveScores[1]!;
const naiveTrain = (() => {
  const curve = naiveScores[0] === naive ? naiveCurves[0]! : naiveCurves[1]!;
  return train.map((t) => pearson(targets[t]!.slots.map(([d, h]) => curve[d * 24 + h]!), targets[t]!.busy) ?? 0);
})();

// Share proxy: does a place's simulated weekly volume rank like its Google review count?
const spearman = (a: number[], b: number[]) => {
  const rank = (x: number[]) => {
    const idx = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(x.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r as number[];
  };
  return pearson(rank(a), rank(b));
};
const weekly = (A: Float64Array, Wx: Float64Array, t: number) => simCurve(A, Wx, t).reduce((x, y) => x + y, 0);
const withReviews = targets.map((_, t) => t).filter((t) => restaurants[targets[t]!.idx]!.reviews);
const shareRank = spearman(withReviews.map((t) => weekly(best.A, W, t)), withReviews.map((t) => restaurants[targets[t]!.idx]!.reviews!));

const result = {
  median: round(median(fitted), 2),
  naiveMedian: round(median(naive), 2),
  uncalibratedMedian: round(median(uncal), 2),
  trainMedian: round(median(train.map((t) => corrOf(best.A, W, t))), 2),
  naiveTrainMedian: round(median(naiveTrain), 2),
  beatsNaive: fitted.filter((x, i) => x > naive[i]!).length,
  places: test.length,
};
console.log("held out:", result, "review-count rank correlation (all places):", round(shareRank ?? 0, 2));

/* ───────── write ───────── */

// Hour curves scaled so each segment's peak is 1.5 (only the shape matters). Day factors keep the hand-set mean.
const hourCurve = Object.fromEntries(
  SEGMENTS.map((g, gi) => {
    const c = Array.from({ length: 24 }, (_, h) => Math.exp(best.p.theta[gi * 24 + h]!));
    const k = 1.5 / Math.max(...c);
    return [g, c.map((x) => round(x * k, 3))];
  }),
) as Record<Segment, number[]>;
const handMean = DAYS.reduce((a, d) => a + HAND_DAY_FACTOR[d], 0) / 7;
const df = DAYS.map((_, d) => Math.exp(best.p.delta[d]!));
const dfMean = df.reduce((a, b) => a + b, 0) / 7;
const dayFactor = Object.fromEntries(DAYS.map((d, i) => [d, round((df[i]! / dfMean) * handMean, 3)])) as Record<Day, number>;

const affinity = Object.fromEntries(
  CUISINES_USED.map((c, i) => [c, Array.from({ length: 5 }, (_, k) => round(best.p.aff[i * 5 + k]!, 2))]),
);
const note = `Hourly shape vs Google popular times, median r over ${test.length} held-out places. City-average curve: ${result.naiveMedian.toFixed(2)}.`;
await Bun.write(
  path.join(ROOT, "data/city/calibration.json"),
  JSON.stringify({ note, scale: best.scale, timeScale: best.timeScale, hourCurve, dayFactor, affinity, heldOut: result }, null, 1),
);

// Details for docs/calibration.md and the chart.
const details = {
  seed: SEED,
  chosen: { scale: best.scale, timeScale: best.timeScale },
  result,
  reviewRankCorrelation: round(shareRank ?? 0, 2),
  heldOut: test.map((t, i) => ({
    placeId: targets[t]!.placeId,
    name: targets[t]!.name,
    slots: targets[t]!.slots.length,
    fitted: round(fitted[i]!, 2),
    naive: round(naive[i]!, 2),
    uncalibrated: round(uncal[i]!, 2),
    // Friday shape for the chart: Google busy and simulated orders per hour (open hours only).
    friday: targets[t]!.slots
      .map(([d, h], k) => ({ d, h, google: targets[t]!.busy[k]!, sim: simCurve(best.A, W, t)[k]! }))
      .filter((x) => x.d === DAYS.indexOf("Friday"))
      .map(({ h, google, sim }) => ({ hour: h, google, sim: round(sim, 4) })),
    uncalibratedFriday: targets[t]!.slots
      .map(([d, h], k) => ({ d, h, sim: simCurve(handA, Whand, t)[k]! }))
      .filter((x) => x.d === DAYS.indexOf("Friday"))
      .map(({ h, sim }) => ({ hour: h, sim: round(sim, 4) })),
  })),
  train: train.map((t) => targets[t]!.name),
};
await Bun.write(path.join(ROOT, "data/city/calibration-details.json"), JSON.stringify(details, null, 1));
console.log("wrote data/city/calibration.json and data/city/calibration-details.json");
