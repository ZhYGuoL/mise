/**
 * Lane H. The two MODEL_FAST calls of an import, run at the same time:
 *   - extractMenu: copy up to 8 real items with prices from the restaurant's website text.
 *     Code then checks that every name and price is really in that text, and drops the rest.
 *   - draftBrand: tagline, voice, colors and logo idea, plus a likely menu from the cuisine and
 *     price tier, used when the website gave too few real items.
 */
import { DietTag, type MenuItem } from "@mise/shared";
import { completeJson } from "./llm";
import type { Place } from "./places";
import { numbersIn, type Site } from "./website";

export type DraftItem = Omit<MenuItem, "id" | "imageUrl">;
export type Brand = {
  tagline: string;
  voice: string;
  logoPrompt: string;
  colors: { primary: string; background: string; ink: string };
};

/** A website menu with fewer verified items than this is not the real menu. */
export const MIN_WEBSITE_ITEMS = 3;
/** Fewer prices than this in the text: the menu is not on the page (a PDF or a JS ordering widget). */
export const MIN_PRICES = 6;

const CATEGORIES = ["main", "side", "drink", "dessert", "combo"] as const;
const TAGS = new Set<string>(DietTag.options);

const ITEM_SHAPE = `{"name": string, "price": number, "description": string, "category": "main"|"side"|"drink"|"dessert"|"combo", "tags": string[], "imagePrompt": string}`;
const ITEM_RULES = `- tags only from: ${DietTag.options.join(", ")}. Use one only when the text or the dish makes it plain.
- imagePrompt: what the photo shows, concrete food and its takeout packaging, no text, no people.
- Mostly mains (main or combo), plus at most one or two sides, drinks or desserts.`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function cleanItem(raw: unknown): DraftItem | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = str(r.name, 60);
  const price = typeof r.price === "number" ? r.price : Number(String(r.price ?? "").replace(/[^\d.]/g, ""));
  if (!name || !Number.isFinite(price) || price <= 0 || price > 200) return null;
  const category = CATEGORIES.includes(r.category as (typeof CATEGORIES)[number]) ? (r.category as DraftItem["category"]) : "main";
  const tags = (Array.isArray(r.tags) ? r.tags : []).filter((t): t is DraftItem["tags"][number] => TAGS.has(t as string));
  return {
    name,
    price: Math.round(price * 100) / 100,
    description: str(r.description, 160),
    category,
    tags: [...new Set(tags)],
    imagePrompt: str(r.imagePrompt, 240) || `${name}. ${str(r.description, 160)}`,
  };
}

const items = (json: unknown) => {
  const list = (json as { items?: unknown; menu?: unknown })?.items ?? (json as { menu?: unknown })?.menu;
  return (Array.isArray(list) ? list : []).map(cleanItem).filter((x): x is DraftItem => !!x);
};

/* ───────────── the website menu, checked against its source ───────────── */

const words = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

/** Every word of the name, and the price, are on the page within a few lines of each other. */
function onPage(item: DraftItem, lines: string[]): boolean {
  const name = words(item.name).filter((w) => !/^\d+$/.test(w));
  if (!name.length) return false;
  return lines.some((_, i) => {
    const near = lines.slice(Math.max(0, i - 1), i + 3).join("\n");
    const nearWords = new Set(words(near));
    return name.every((w) => nearWords.has(w)) && numbersIn(near).some((n) => Math.abs(n - item.price) < 0.005);
  });
}

export async function extractMenu(place: Place, site: Site): Promise<{ items: DraftItem[]; dropped: number; costUsd: number }> {
  const r = place.restaurant;
  const reply = await completeJson({
    tag: `menu ${r.name}`,
    maxTokens: 1400,
    system: "You copy a real restaurant's menu from its website text. You never invent a dish or a price. Reply with JSON only.",
    user: `Restaurant: ${r.name}${place.facts.neighborhood ? `, ${place.facts.neighborhood}, Pittsburgh` : ""}.
Website text with prices (${new URL(site.pages[0]!).hostname}):
"""
${site.menuText}
"""

Copy up to 8 menu items from this text that a delivery customer would order.
- name: exactly as written, only fix the capitalization.
- price: exactly as written. Use the regular price, not a happy hour, special or add-on price. If a dish has several sizes, take the first.
- description: one short sentence that uses only what the text says about the dish. Empty if it says nothing.
${ITEM_RULES}
If the text has fewer than ${MIN_WEBSITE_ITEMS} dishes with prices, reply {"items": []}.
Reply: {"items": [${ITEM_SHAPE}]}`,
  });
  const all = items(reply.json).slice(0, 8);
  const lines = site.menuText.split("\n");
  const kept = all.filter((it) => onPage(it, lines));
  return { items: kept, dropped: all.length - kept.length, costUsd: reply.costUsd };
}

/* ───────────── brand, and the likely menu ───────────── */

const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : null);

function luminance(h: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** Model colors, kept only if the ink reads on the background. A neutral set otherwise. */
function cleanColors(raw: unknown): Brand["colors"] {
  const c = (raw ?? {}) as Record<string, unknown>;
  const background = hex(c.background) ?? "#FAF7F2";
  const primary = hex(c.primary) ?? "#B0452F";
  let ink = hex(c.ink) ?? "#1A1A1A";
  if (contrast(ink, background) < 4.5) ink = luminance(background) > 0.4 ? "#1A1A1A" : "#FFFFFF";
  return { primary, background, ink };
}

const tier = (n: number | null) => "$".repeat(Math.min(4, Math.max(1, n ?? 2)));

/** Always drafts the likely menu too: it runs beside extractMenu, so a thin website menu never costs a third call. */
export async function draftBrand(place: Place, site: Site | null): Promise<{ brand: Brand; items: DraftItem[]; costUsd: number }> {
  const r = place.restaurant;
  const facts = [
    `Real restaurant: ${r.name}.`,
    place.googleName && place.googleName !== r.name ? `Google lists it as: ${place.googleName}.` : "",
    `Cuisine: ${r.cuisine.join(", ").replaceAll("_", " ")}${r.category ? ` (Google category: ${r.category})` : ""}.`,
    `Price tier: ${tier(r.priceTier)} of $$$$.`,
    `Where: ${[place.facts.street, place.facts.neighborhood, "Pittsburgh"].filter(Boolean).join(", ")}.`,
    r.rating !== null ? `Google rating ${r.rating} from ${r.reviews ?? 0} reviews.` : "",
    site?.title ? `Website title: ${site.title}` : "",
    site?.description ? `Website description: ${site.description}` : "",
    site?.themeColor && site.themeColor.toLowerCase() !== "#ffffff" ? `Website theme color: ${site.themeColor}` : "",
    site?.intro ? `Website opening text (may hold menus and navigation, ignore boilerplate):\n"""\n${site.intro}\n"""` : "",
  ].filter(Boolean);

  const reply = await completeJson({
    tag: `brand ${r.name}`,
    maxTokens: 1600,
    system: "You describe a real restaurant for a planning tool. Plain words, no made-up claims, awards or history. Reply with JSON only.",
    user: `${facts.join("\n")}

Reply with:
- tagline: under 60 characters, plain, what the place is and where. No em dashes.
- voice: one sentence, how this restaurant talks to customers.
- colors: flat hex "#RRGGBB" primary, background, ink. Ink must read clearly on background. Use the website color if it has one, otherwise colors that fit the food.
- logoPrompt: one short idea for a flat two-color mark for the name.
- items: the 6 to 8 dishes this restaurant most likely sells, at typical ${tier(r.priceTier)} Pittsburgh prices in USD with two decimals at most. Name real, common dishes for this cuisine, not invented signature dishes.
${ITEM_RULES}
Reply: {"tagline": string, "voice": string, "colors": {"primary": string, "background": string, "ink": string}, "logoPrompt": string, "items": [${ITEM_SHAPE}]}`,
  });
  const j = (reply.json ?? {}) as Record<string, unknown>;
  const where = place.facts.neighborhood ?? "Pittsburgh";
  const brand: Brand = {
    tagline: str(j.tagline, 60).replace(/\s*[—–]\s*/g, ", ") || `${r.cuisine[0]?.replaceAll("_", " ") ?? "Food"} in ${where}`,
    voice: str(j.voice, 200) || "Warm, plain and quick.",
    logoPrompt: str(j.logoPrompt, 200),
    colors: cleanColors(j.colors),
  };
  return { brand, items: items(j).slice(0, 8), costUsd: reply.costUsd };
}
