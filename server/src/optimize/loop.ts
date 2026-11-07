/**
 * POST /api/agent/optimize core. Like a coding agent running tests:
 * read the latest prediction -> propose 2-3 edit sets -> simulate each (runs=8) -> keep the best -> repeat.
 * Stops at the target, after MAX_ROUNDS, or after two rounds with no gain. The final set waits for the owner.
 */
import type { AgentEvent, AgentOptimizeRequest, Concept, ConceptEdit, OptimizeGoal, Prediction, Scenario } from "@mise/shared";
import { applyEdits } from "../agent/patch";
import { simulate } from "../sim/simulate";
import { collapse, guardProposal, signature, type Candidate } from "./guard";
import { propose, type Tried } from "./propose";

const MAX_ROUNDS = 5;
const FAST_RUNS = 8;
const FINAL_RUNS = 20;
const MAX_STALE = 2;

type Send = (e: AgentEvent) => Promise<void>;

const metric = (goal: OptimizeGoal, p: Prediction) => (goal.metric === "orders" ? p.orders.p50 : p.revenue.p50);
const other = (goal: OptimizeGoal, p: Prediction) => (goal.metric === "orders" ? p.revenue.p50 : p.orders.p50);
const show = (goal: OptimizeGoal, x: number) => (goal.metric === "orders" ? `${Math.round(x)}` : `$${Math.round(x).toLocaleString("en-US")}`);
const unit = (goal: OptimizeGoal) => (goal.metric === "orders" ? "orders" : "revenue");
/** The smallest gain that counts as better, so noise does not keep a set. */
const minGain = (goal: OptimizeGoal, base: number) => (goal.metric === "orders" ? 1 : Math.max(10, base * 0.01));

const editsText = (edits: ConceptEdit[]) =>
  edits.map((e) => `${e.op} ${e.path}${e.value === undefined ? "" : ` = ${JSON.stringify(e.value)}`}`).join("; ");

export async function runOptimize(req: AgentOptimizeRequest, send: Send, signal?: AbortSignal) {
  const { concept: original, goal } = req;
  const fast: Scenario = { ...goal.scenario, runs: FAST_RUNS };
  const target = goal.target;
  const t0 = performance.now();

  await send({ type: "thinking", label: "Reading the goal", detail: `${show(goal, target)} ${unit(goal)} on ${goal.scenario.day}`, optimize: { round: 0 } });
  await send({ type: "simulating", scenario: fast, optimize: { round: 0 } });
  let prediction = await simulate(original, fast);
  await send({ type: "prediction", prediction, optimize: { round: 0, kept: true, title: "Start" } });

  let current: Concept = original;
  const kept: ConceptEdit[][] = [];
  const tried: Tried[] = [];
  const seen = new Set([signature(original)]);
  let stale = 0;
  let round = 0;

  while (metric(goal, prediction) < target && round < MAX_ROUNDS && stale < MAX_STALE) {
    if (signal?.aborted) return;
    round++;
    await send({ type: "thinking", label: `Round ${round}`, detail: "Reading the objections", optimize: { round } });
    const { plan, proposals, by } = await propose(goal, original, current, prediction, tried, round, signal);
    console.log(`[optimize] round ${round} by ${by}: ${plan}`);

    const candidates: Candidate[] = [];
    for (const p of proposals) {
      const c = guardProposal(p, original, current);
      if (!c) continue;
      const sig = signature(c.concept);
      if (seen.has(sig)) continue;
      seen.add(sig);
      candidates.push(c);
    }
    await send({ type: "thinking", label: `Round ${round}`, detail: plan || `${candidates.length} edit sets`, optimize: { round } });
    if (candidates.length === 0) {
      stale++;
      continue;
    }

    const results: { c: Candidate; p: Prediction; i: number }[] = [];
    for (const [i, c] of candidates.entries()) {
      if (signal?.aborted) return;
      await send({ type: "edits", edits: c.edits, needsApproval: false, optimize: { round, candidate: i, title: c.title } });
      await send({ type: "simulating", scenario: fast, optimize: { round, candidate: i, title: c.title } });
      const p = await simulate(c.concept, fast);
      await send({ type: "prediction", prediction: p, optimize: { round, candidate: i, title: c.title } });
      results.push({ c, p, i });
    }

    // Sets that reach the target compete on the other number (margin). Otherwise the metric wins.
    const hits = results.filter((r) => metric(goal, r.p) >= target);
    const best = hits.length
      ? hits.sort((a, b) => other(goal, b.p) - other(goal, a.p))[0]!
      : results.sort((a, b) => metric(goal, b.p) - metric(goal, a.p))[0]!;
    const before = metric(goal, prediction);
    const gain = metric(goal, best.p) - before;
    const keep = gain >= minGain(goal, before);
    for (const r of results)
      tried.push({ round, title: r.c.title, edits: editsText(r.c.edits), score: metric(goal, r.p), kept: keep && r === best });

    if (keep) {
      current = best.c.concept;
      prediction = best.p;
      kept.push(best.c.edits);
      stale = 0;
      await send({
        type: "thinking",
        label: "Kept",
        detail: `${best.c.title}: ${show(goal, before)} to ${show(goal, metric(goal, best.p))}`,
        optimize: { round, candidate: best.i, kept: true, title: best.c.title },
      });
    } else {
      stale++;
      await send({ type: "thinking", label: "Kept nothing", detail: `No set beat ${show(goal, before)}`, optimize: { round } });
    }
  }

  if (kept.length === 0) {
    await send({ type: "text", delta: `Nothing beat ${show(goal, metric(goal, prediction))} ${unit(goal)} in ${round} rounds.`, optimize: { round, final: true } });
    await send({ type: "done" });
    return;
  }

  // One set from the owner's concept to the result, one edit per field, checked by applying it again.
  const finalEdits = collapse(original, current, kept);
  const applied = applyEdits(original, finalEdits);
  if (!applied.ok) throw new Error(`the final edit set does not apply: ${applied.error}`);

  const full: Scenario = { ...goal.scenario, runs: Math.max(goal.scenario.runs, FINAL_RUNS) };
  await send({ type: "thinking", label: "Checking", detail: `${full.runs} runs`, optimize: { round, final: true } });
  await send({ type: "simulating", scenario: full, optimize: { round, final: true } });
  const check = await simulate(applied.concept, full);
  await send({ type: "prediction", prediction: check, optimize: { round, final: true } });

  const reached = metric(goal, check) >= target;
  const start = metric(goal, await simulate(original, full));
  const secs = Math.round((performance.now() - t0) / 1000);
  await send({
    type: "text",
    delta: `${reached ? "Reached" : "Got to"} ${show(goal, metric(goal, check))} ${unit(goal)} from ${show(goal, start)}, ${round} ${round === 1 ? "round" : "rounds"}, ${secs}s.`,
    optimize: { round, final: true },
  });
  await send({ type: "edits", edits: applied.edits, needsApproval: true, optimize: { round, final: true } });
  await send({ type: "done" });
}
