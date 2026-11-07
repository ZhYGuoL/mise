import type { Concept, Prediction } from "@mise/shared";
import { SITES, siteOf } from "./sites";

const r = Math.round;

/** The prediction in the few lines the model needs to reason about it. */
export function summarizePrediction(p: Prediction | null): string {
  if (!p) return "No prediction yet.";
  const s = p.scenario;
  const lines = [
    `Scenario: ${s.day}, ${s.weather}, event ${s.event}. Concept v${p.conceptVersion}.`,
    `Orders per day: p10 ${r(p.orders.p10)}, p50 ${r(p.orders.p50)}, p90 ${r(p.orders.p90)}.`,
    `Revenue per day: p10 $${r(p.revenue.p10)}, p50 $${r(p.revenue.p50)}, p90 $${r(p.revenue.p90)}. Avg ticket $${p.avgTicket.toFixed(2)}. Market share ${p.marketSharePct.toFixed(1)}%.`,
  ];
  const peak = [...p.byHour].sort((a, b) => b.p50 - a.p50).slice(0, 3);
  if (peak.length) lines.push(`Busiest hours (p50 orders): ${peak.map((h) => `${h.hour}:00 ${r(h.p50)}`).join(", ")}.`);
  if (p.objections.length) {
    lines.push("Why residents who considered it said no:");
    for (const o of p.objections) lines.push(`- ${o.pct}% ${o.label} (${o.code}${o.segment ? `, mostly ${o.segment}` : ""})`);
  }
  if (p.bySegment.length) lines.push(`Who ordered: ${p.bySegment.map((b) => `${b.segment} ${r(b.orders)} (${b.sharePct.toFixed(0)}%)`).join(", ")}.`);
  if (p.stolenFrom.length) lines.push(`Orders taken from: ${p.stolenFrom.map((x) => `${x.name} ${r(x.ordersLost)}`).join(", ")}.`);
  return lines.join("\n");
}

/** The concept as the model sees it. Image URLs are noise to the model, so they are left out. */
function conceptForModel(c: Concept) {
  const { brand, menu, ...rest } = c;
  const site = siteOf(c.location);
  return {
    ...rest,
    location: { ...c.location, siteId: site?.id ?? null },
    menu: menu.map(({ imageUrl: _i, ...m }, i) => ({ index: i, ...m })),
    brand: { colors: brand.colors, voice: brand.voice, logoPrompt: brand.logoPrompt },
  };
}

const sites = SITES.map((s) => `- ${s.id}: ${s.address} (${s.neighborhood})`).join("\n");

export function systemPrompt(concept: Concept | null, prediction: Prediction | null): string {
  const base = `You are Mise, an agent that designs a delivery-first restaurant with its owner in Pittsburgh.
The concept is the code. You change it only through tools. Code validates every change and keeps every version.
A simulated city of real Pittsburgh residents predicts how each version does. Use those numbers.

Sites you can open on (pick by id):
${sites}

How to write concepts:
- 5 to 8 menu items. Real dishes, real Pittsburgh delivery prices (USD, two decimals at most).
- Menu item categories: main, side, drink, dessert, combo. Diet tags only from: vegetarian, vegan, halal, gluten_free, spicy, late_night.
- cuisine is lowercase snake tokens, e.g. ["korean", "fried_chicken"].
- Hours are "HH:MM" 24h for every day Sunday to Saturday. close may be past midnight ("02:00"). null means closed.
- priceTier 1 to 4 ($ to $$$$). deliveryFee in USD. serviceFeePct 0 to 40.
- Brand colors are flat hex: primary, background, ink. Pick colors with clear contrast.
- imagePrompt per dish: what the photo shows, concrete food and packaging, no text, no people.
- logoPrompt: a flat two-color mark for the name.

How to talk:
- At most two short sentences per reply, under 40 words in total. Plain words. No lists, no headings, no markdown.
- Cite the prediction with real numbers, e.g. "31% said it is too far". Never invent numbers.
- Never mention tools, JSON, patches or paths. Never use em dashes.

Real restaurants (the city has 192 real Pittsburgh places):
- If the owner runs, owns or works at a specific real restaurant, or asks how a named real restaurant would do, call import_restaurant with the name or Maps link as they wrote it. Put the rest of their message in question.
- For a new idea, even one that names a cuisine or a street, use create_concept.
- Never make up a real restaurant. If import_restaurant finds no match, say so in one short sentence.`;

  if (!concept) {
    return `${base}

There is no concept yet. For a new idea, call create_concept once with a complete concept.
Then, after you see the prediction, reply with what you made and the predicted orders as a range.
For a real restaurant the owner names, call import_restaurant instead.`;
  }

  return `${base}

To change the concept, call edit_concept once with 1 to 4 JSON Patch ops against the current concept.
- Paths are JSON pointers into the concept below, e.g. "/menu/2/price", "/hours/Friday/close", "/tagline".
- To change hours, edit each day that changes, e.g. "/hours/Friday/close". Never replace "/hours" as a whole.
- Menu indexes are the "index" field below. To add a dish use op "add" with path "/menu/-" and a full dish without id.
- To move, use op "replace", path "/location", value "<site id>".
- Each op needs a reason in plain words that cites the prediction when it can.
- Price, fee, location, cuisine, promo and add or remove dish edits wait for the owner to approve. Other edits apply at once.
- If an edit is rejected, read the error, fix it and call edit_concept again.
When the owner asks to reach or raise a number of orders or revenue, call run_optimize. For a change the owner names, like a price or a dish, use edit_concept.
Call simulate only when the owner asks about a different day, weather or event.
Call generate_images only when the owner asks for new photos or a new logo.
If the owner only asks a question, answer it without tools.

${
  concept.existing
    ? `This concept is the owner's real restaurant, ${concept.existing.name}, loaded from the city. Keep its name. Do not import it again. To work on another real restaurant, call import_restaurant: it replaces this one after the owner says yes.\n\n`
    : ""
}Current concept (v${concept.version}):
${JSON.stringify(conceptForModel(concept))}

Latest prediction:
${summarizePrediction(prediction)}`;
}
