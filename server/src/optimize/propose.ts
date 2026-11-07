/**
 * Propose 2-3 edit sets for the next round. The fast model reads the latest prediction and the
 * history of what was tried. If the model is off or fails, rules built on the objections propose instead.
 */
import type { Concept, OptimizeGoal, Prediction } from "@mise/shared";
import { SITES, siteOf } from "../agent/sites";
import { MAX_EDITS, priceFloor, type Proposal } from "./guard";
import { completeJson, fastModel } from "./llm";

export type Tried = { round: number; title: string; edits: string; score: number; kept: boolean };

const fmt = (x: number) => (Number.isInteger(x) ? `$${x}` : `$${x.toFixed(2)}`);
const metricOf = (goal: OptimizeGoal, p: Prediction) => (goal.metric === "orders" ? p.orders.p50 : p.revenue.p50);
const metricWord = (goal: OptimizeGoal) => (goal.metric === "orders" ? "orders" : "revenue");
const show = (goal: OptimizeGoal, x: number) => (goal.metric === "orders" ? `${Math.round(x)} orders` : `$${Math.round(x)}`);

function describeConcept(c: Concept, original: Concept, goal: OptimizeGoal): string {
  const day = goal.scenario.day;
  const h = c.hours[day];
  const site = siteOf(c.location);
  return [
    `"${c.name}" (${c.cuisine.join(", ")}), price tier ${c.priceTier}`,
    `Location: ${site?.id ?? "custom"} (${c.location.neighborhood})`,
    `${day} hours: ${h ? `${h.open} to ${h.close}` : "closed"}`,
    `Delivery fee ${fmt(c.deliveryFee)}, service fee ${c.serviceFeePct}%`,
    "Menu (index, name, category, price, floor, tags):",
    ...c.menu.map(
      (m, i) => `  ${i}. ${m.name}, ${m.category}, ${fmt(m.price)} (floor ${fmt(priceFloor(original, m.id))}), [${m.tags.join(", ")}]`,
    ),
    `Promos: ${c.promos.length ? c.promos.map((p, i) => `${i}. "${p.description}"${p.discountPct ? ` ${p.discountPct}%` : ""}${p.days ? ` on ${p.days.join(", ")}` : ""}${p.hours ? ` ${p.hours[0]} to ${p.hours[1]}` : ""}`).join("; ") : "none"}`,
  ].join("\n");
}

function describePrediction(p: Prediction): string {
  const peak = [...p.byHour].sort((a, b) => b.p50 - a.p50).slice(0, 3).map((h) => `${h.hour}:00`);
  return [
    `Orders p50 ${Math.round(p.orders.p50)} (p10 ${Math.round(p.orders.p10)}, p90 ${Math.round(p.orders.p90)}), revenue p50 $${Math.round(p.revenue.p50)}, avg ticket $${p.avgTicket.toFixed(2)}`,
    "Objections (share of residents who considered the place and said no):",
    ...p.objections.slice(0, 6).map((o) => `  ${o.code} ${o.pct}%: ${o.label}${o.segment ? ` (mostly ${o.segment})` : ""}`),
    `Orders by segment: ${p.bySegment.map((s) => `${s.segment} ${Math.round(s.orders)}`).join(", ")}`,
    `Peak hours: ${peak.join(", ")}`,
    `Took orders from: ${p.stolenFrom.slice(0, 3).map((s) => `${s.name} (${Math.round(s.ordersLost)})`).join(", ") || "nobody yet"}`,
  ].join("\n");
}

const SYSTEM = `You optimize a restaurant concept against a simulated city, like a coding agent fixing failing tests.
Each round you propose edit sets. Code simulates each set and keeps the best one.
Reply with JSON only:
{"plan": "max 14 words: what the last result tells you and what you try now",
 "candidates": [{"title": "2 to 4 words", "edits": [{"op": "replace", "path": "/deliveryFee", "value": 0.99, "reason": "max 12 words, names the objection it fixes"}]}]}
Be brief. No text outside the JSON.

Rules:
- Exactly 3 candidates. Each has 1 to ${MAX_EDITS} edits. The 3 candidates test different ideas.
- Allowed edits only:
  replace /menu/<i>/price (number, never below the floor shown)
  replace /menu/<i>/tags (array of: vegetarian, vegan, halal, gluten_free, spicy, late_night). Only tag what the dish really is.
  add /menu/- with {"name","description","price","category":"main"|"side"|"drink"|"dessert"|"combo","tags":[...],"imagePrompt"} (a real dish that fits the cuisine)
  replace /deliveryFee (0 to 5.99)
  replace /serviceFeePct (5 to 40)
  add /promos/- with {"description","discountPct" (max 30),"days":["Friday"],"hours":["HH:MM","HH:MM"]}. Words like "first order", "launch" or "opening week" in the description make it a discovery promo for new customers. "free delivery" in the description waives the fee.
  remove /promos/<i>
  replace /hours/<Day> with {"open":"HH:MM","close":"HH:MM"}
  replace /location with a site id string from the list
- Keep the name, cuisine and brand. Prefer the smallest change that reaches the target.
- For an orders goal, do not give away the margin: a set that reaches the target with more revenue wins.
- Do not repeat a set that was already tried. Build on what was kept.`;

async function proposeWithModel(
  goal: OptimizeGoal,
  original: Concept,
  current: Concept,
  prediction: Prediction,
  tried: Tried[],
  round: number,
  signal?: AbortSignal,
): Promise<{ plan: string; proposals: Proposal[] }> {
  const user = [
    `Goal: ${goal.target} ${metricWord(goal)} (p50) on a ${goal.scenario.day}${goal.scenario.weather !== "clear" ? `, ${goal.scenario.weather}` : ""}${goal.scenario.event !== "none" ? `, ${goal.scenario.event}` : ""}. Now: ${show(goal, metricOf(goal, prediction))}. Round ${round}.`,
    "",
    "Current concept:",
    describeConcept(current, original, goal),
    "",
    "Latest prediction for the current concept:",
    describePrediction(prediction),
    "",
    `Sites: ${SITES.map((s) => `${s.id} (${s.neighborhood})`).join(", ")}`,
    "",
    tried.length
      ? `Tried so far:\n${tried.map((t) => `  round ${t.round}: "${t.title}" [${t.edits}] -> ${show(goal, t.score)}${t.kept ? " KEPT" : ""}`).join("\n")}`
      : "Nothing tried yet.",
  ].join("\n");
  const out = (await completeJson({ system: SYSTEM, user, maxTokens: 1800, temperature: 0.6, timeoutMs: 15_000, signal, tag: "optimize" })) as {
    plan?: unknown;
    candidates?: unknown;
  };
  const proposals = (Array.isArray(out.candidates) ? out.candidates : [])
    .slice(0, 3)
    .map((c) => c as { title?: unknown; edits?: unknown })
    .map((c) => ({ title: typeof c.title === "string" ? c.title : "Edit set", edits: Array.isArray(c.edits) ? c.edits : [] }));
  if (proposals.length === 0) throw new Error("the model proposed no edit sets");
  return { plan: typeof out.plan === "string" ? out.plan.slice(0, 200) : "", proposals };
}

/** Rules from the objections. Used when the model is off or fails, so the loop always runs. */
function proposeWithRules(goal: OptimizeGoal, original: Concept, current: Concept, prediction: Prediction, tried: Tried[]): Proposal[] {
  const done = new Set(tried.map((t) => t.title));
  const day = goal.scenario.day;
  const ideas: Proposal[] = [];
  const mains = current.menu.map((m, i) => [m, i] as const).filter(([m]) => m.category === "main" || m.category === "combo");

  for (const o of prediction.objections) {
    if (o.code === "unknown_new_place" && !current.promos.some((p) => /first order|launch|opening/i.test(p.description)))
      ideas.push({
        title: "Launch promo",
        edits: [{ op: "add", path: "/promos/-", value: { description: "20% off your first order, opening week", discountPct: 20 }, reason: `${o.pct}% pass on a new, unrated place` }],
      });
    if (o.code === "fee_too_high" || o.code === "too_expensive") {
      if (current.deliveryFee > 0.99)
        ideas.push({ title: "Cheaper delivery", edits: [{ op: "replace", path: "/deliveryFee", value: 0.99, reason: `${o.pct}% say it costs too much with fees` }] });
      else if (current.deliveryFee > 0)
        ideas.push({ title: "Free delivery", edits: [{ op: "replace", path: "/deliveryFee", value: 0, reason: `${o.pct}% say it costs too much with fees` }] });
      const top = [...mains].sort((a, b) => b[0].price - a[0].price).slice(0, 2);
      ideas.push({
        title: "Trim top mains",
        edits: top.map(([m, i]) => ({ op: "replace", path: `/menu/${i}/price`, value: Math.max(priceFloor(original, m.id), Math.round(m.price * 0.9 * 2) / 2), reason: `${o.pct}% say it is over budget` })),
      });
    }
    if (o.code === "closed_when_hungry") {
      const h = current.hours[day];
      ideas.push({ title: `Longer ${day} hours`, edits: [{ op: "replace", path: `/hours/${day}`, value: { open: "10:00", close: h?.close && h.close < "06:00" ? "03:00" : "02:00" }, reason: `${o.pct}% want food when it is closed` }] });
    }
    if (o.code === "too_far") {
      const here = siteOf(current.location)?.id;
      const next = SITES.find((s) => s.id !== here && !done.has(`Move to ${s.neighborhood}`));
      if (next) ideas.push({ title: `Move to ${next.neighborhood}`, edits: [{ op: "replace", path: "/location", value: next.id, reason: `${o.pct}% say it is too far` }] });
    }
  }
  if (current.deliveryFee > 0)
    ideas.push({ title: `${day} free delivery`, edits: [{ op: "add", path: "/promos/-", value: { description: `Free delivery on ${day}s`, days: [day] }, reason: "Fees are the cheapest lever to pull" }] });
  ideas.push({ title: `${day} 15% off`, edits: [{ op: "add", path: "/promos/-", value: { description: `15% off on ${day}s`, discountPct: 15, days: [day] }, reason: "A day deal lifts the target day only" }] });

  const seen = new Set<string>();
  return ideas.filter((p) => !done.has(p.title) && !seen.has(p.title) && seen.add(p.title)).slice(0, 3);
}

export async function propose(
  goal: OptimizeGoal,
  original: Concept,
  current: Concept,
  prediction: Prediction,
  tried: Tried[],
  round: number,
  signal?: AbortSignal,
): Promise<{ plan: string; proposals: Proposal[]; by: "model" | "rules" }> {
  if (fastModel()) {
    try {
      return { ...(await proposeWithModel(goal, original, current, prediction, tried, round, signal)), by: "model" };
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn("[optimize] model proposal failed, using rules:", err instanceof Error ? err.message : err);
    }
  }
  const top = prediction.objections[0];
  return {
    plan: top ? `Top objection: ${top.label} (${top.pct}%)` : "Try the cheapest levers first",
    proposals: proposeWithRules(goal, original, current, prediction, tried),
    by: "rules",
  };
}
