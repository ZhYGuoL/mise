/**
 * Guardrails for optimize proposals. Code decides what the model may change:
 * a fixed set of paths, at most 3 edits per set, no price below the floor, sites from the sim area only.
 */
import { type Concept, type ConceptEdit, DietTag, TimeHM } from "@mise/shared";
import { applyEdits } from "../agent/patch";
import { SITES, siteById, siteOf } from "../agent/sites";

export const MAX_EDITS = 3;
export const MIN_PRICE = 4;
/** A dish never drops below this share of the owner's own price. */
const FLOOR_SHARE = 0.6;
const MAX_DISCOUNT_PCT = 30;
const MAX_PROMOS = 3;
const MIN_SERVICE_PCT = 5;
const MAX_DELIVERY_FEE = 5.99;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CATEGORIES = ["main", "side", "drink", "dessert", "combo"];

export type RawEdit = { op?: unknown; path?: unknown; value?: unknown; reason?: unknown };
export type Proposal = { title: string; edits: RawEdit[] };
export type Candidate = { title: string; edits: ConceptEdit[]; concept: Concept };

const money = (x: number) => Math.round(x * 100) / 100;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$%\s]/g, "")) : NaN);

/** The lowest price a dish may have: $4, or 60% of what the owner priced it at. */
export function priceFloor(original: Concept, itemId: string | undefined): number {
  const own = original.menu.find((m) => m.id === itemId)?.price;
  return money(Math.max(MIN_PRICE, own ? own * FLOOR_SHARE : 0));
}

const tags = (v: unknown) => (Array.isArray(v) ? v.filter((t) => DietTag.safeParse(t).success) : []);

/** One edit through the guardrails. Returns null when the edit is not allowed. */
function guardEdit(e: RawEdit, original: Concept, current: Concept, fallbackReason: string): ConceptEdit | null {
  const op = e.op;
  const path = typeof e.path === "string" ? e.path.trim() : "";
  const reason = typeof e.reason === "string" && e.reason.trim() ? e.reason.trim().slice(0, 160) : fallbackReason;
  let m: RegExpExecArray | null;

  if (op === "replace" && (m = /^\/menu\/(\d+)\/price$/.exec(path))) {
    const item = current.menu[Number(m[1])];
    const price = num(e.value);
    if (!item || !Number.isFinite(price)) return null;
    return { op, path, value: money(Math.max(priceFloor(original, item.id), price)), reason };
  }
  if (op === "replace" && (m = /^\/menu\/(\d+)\/tags$/.exec(path))) {
    if (!current.menu[Number(m[1])]) return null;
    return { op, path, value: [...new Set(tags(e.value))], reason };
  }
  if (op === "add" && /^\/menu\/-$/.test(path)) {
    const v = e.value as Record<string, unknown> | null;
    const price = num(v?.price);
    if (!v || typeof v.name !== "string" || !Number.isFinite(price)) return null;
    const category = CATEGORIES.includes(v.category as string) ? v.category : "main";
    return {
      op,
      path,
      value: {
        name: v.name.slice(0, 60),
        description: typeof v.description === "string" ? v.description.slice(0, 160) : "",
        price: money(Math.max(MIN_PRICE, price)),
        category,
        tags: [...new Set(tags(v.tags))],
        ...(typeof v.imagePrompt === "string" ? { imagePrompt: v.imagePrompt.slice(0, 200) } : {}),
      },
      reason,
    };
  }
  if (op === "replace" && path === "/deliveryFee") {
    const fee = num(e.value);
    if (!Number.isFinite(fee)) return null;
    return { op, path, value: money(Math.min(MAX_DELIVERY_FEE, Math.max(0, fee))), reason };
  }
  if (op === "replace" && path === "/serviceFeePct") {
    const pct = num(e.value);
    if (!Number.isFinite(pct)) return null;
    return { op, path, value: Math.round(Math.min(40, Math.max(MIN_SERVICE_PCT, pct))), reason };
  }
  if (op === "replace" && path === "/priceTier") {
    const tier = Math.round(num(e.value));
    if (![1, 2, 3, 4].includes(tier)) return null;
    return { op, path, value: tier, reason };
  }
  if (op === "add" && /^\/promos\/-$/.test(path)) {
    const v = e.value as Record<string, unknown> | null;
    if (!v || typeof v.description !== "string" || current.promos.length >= MAX_PROMOS) return null;
    const pct = num(v.discountPct);
    const days = Array.isArray(v.days) ? v.days.filter((d) => DAYS.includes(d as string)) : undefined;
    const hours =
      Array.isArray(v.hours) && v.hours.length === 2 && v.hours.every((h) => TimeHM.safeParse(h).success) ? v.hours : undefined;
    const appliesTo = Array.isArray(v.appliesTo)
      ? v.appliesTo.filter((id) => current.menu.some((x) => x.id === id))
      : undefined;
    const n = current.promos.reduce((max, p) => Math.max(max, Number(/^p(\d+)$/.exec(p.id)?.[1] ?? 0)), 0);
    return {
      op,
      path,
      value: {
        id: `p${n + 1}`,
        description: v.description.slice(0, 80),
        ...(Number.isFinite(pct) && pct > 0 ? { discountPct: Math.min(MAX_DISCOUNT_PCT, Math.round(pct)) } : {}),
        ...(days?.length ? { days } : {}),
        ...(hours ? { hours } : {}),
        ...(appliesTo?.length ? { appliesTo } : {}),
      },
      reason,
    };
  }
  if (op === "remove" && (m = /^\/promos\/(\d+)$/.exec(path))) {
    return current.promos[Number(m[1])] ? { op, path, reason } : null;
  }
  if (op === "replace" && (m = /^\/hours\/(\w+)$/.exec(path))) {
    if (!DAYS.includes(m[1]!)) return null;
    if (e.value === null) return { op, path, value: null, reason };
    const v = e.value as { open?: unknown; close?: unknown } | null;
    if (!TimeHM.safeParse(v?.open).success || !TimeHM.safeParse(v?.close).success) return null;
    return { op, path, value: { open: v!.open, close: v!.close }, reason };
  }
  if (op === "replace" && path === "/location") {
    // Only our candidate sites, which all sit inside the simulated area.
    const id = typeof e.value === "string" ? e.value : (e.value as { siteId?: unknown } | null)?.siteId;
    if (typeof id !== "string" || !siteById(id)) return null;
    return { op, path, value: id, reason };
  }
  return null;
}

/** Guard a proposal and apply it to the current concept. Null when nothing valid is left. */
export function guardProposal(p: Proposal, original: Concept, current: Concept): Candidate | null {
  const title = (p.title || "Edit set").slice(0, 40);
  const edits = (Array.isArray(p.edits) ? p.edits : [])
    .slice(0, MAX_EDITS)
    .map((e) => guardEdit(e, original, current, title))
    .filter((e): e is ConceptEdit => e !== null);
  if (edits.length === 0) return null;
  const applied = applyEdits(current, edits);
  if (!applied.ok) {
    console.warn(`[optimize] dropped "${title}": ${applied.error}`);
    return null;
  }
  return { title, edits: applied.edits, concept: applied.concept };
}

/** What the concept looks like to the optimizer, so two sets that end in the same place count as one. */
export const signature = (c: Concept) =>
  JSON.stringify([c.menu.map((m) => [m.name, m.price, m.tags]), c.deliveryFee, c.serviceFeePct, c.priceTier, c.hours, c.location.lat, c.location.lon, c.promos.map((p) => [p.description, p.discountPct, p.days, p.hours, p.appliesTo])]);

/**
 * The edits from `original` to `final` as one set the owner can approve, one edit per changed field.
 * Reasons come from the round that last touched that field.
 */
export function collapse(original: Concept, final: Concept, rounds: ConceptEdit[][]): ConceptEdit[] {
  // New dishes and promos are keyed by their name or id, since they all share the path "/-".
  const reasonKey = (e: ConceptEdit) => {
    const v = e.value as { id?: string; name?: string } | undefined;
    if (e.path === "/menu/-") return `dish:${v?.name}`;
    if (e.path === "/promos/-") return `promo:${v?.id}`;
    return e.path;
  };
  const reasons = new Map<string, string>();
  for (const e of rounds.flat()) reasons.set(reasonKey(e), e.reason);
  const why = (path: string, fallback = "From the optimize run") => reasons.get(path) ?? fallback;
  const out: ConceptEdit[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  original.menu.forEach((item, i) => {
    const now = final.menu[i];
    if (!now) return;
    if (now.price !== item.price) out.push({ op: "replace", path: `/menu/${i}/price`, value: now.price, reason: why(`/menu/${i}/price`) });
    if (!same(now.tags, item.tags)) out.push({ op: "replace", path: `/menu/${i}/tags`, value: now.tags, reason: why(`/menu/${i}/tags`) });
  });
  for (const item of final.menu.slice(original.menu.length)) {
    const { id: _id, imageUrl: _img, ...value } = item;
    out.push({ op: "add", path: "/menu/-", value, reason: why(`dish:${item.name}`) });
  }
  for (const key of ["deliveryFee", "serviceFeePct", "priceTier"] as const) {
    if (final[key] !== original[key]) out.push({ op: "replace", path: `/${key}`, value: final[key], reason: why(`/${key}`) });
  }
  for (const day of DAYS) {
    const a = original.hours[day as keyof Concept["hours"]] ?? null;
    const b = final.hours[day as keyof Concept["hours"]] ?? null;
    if (!same(a, b)) out.push({ op: "replace", path: `/hours/${day}`, value: b, reason: why(`/hours/${day}`) });
  }
  if (original.location.lat !== final.location.lat || original.location.lon !== final.location.lon) {
    const site = siteOf(final.location) ?? SITES[0]!;
    out.push({ op: "replace", path: "/location", value: site.id, reason: why("/location") });
  }
  // Promos: removed ones go first, highest index first, so the indices stay right. Then the new ones.
  const kept = new Set(final.promos.map((p) => p.id));
  original.promos
    .map((p, i) => [p, i] as const)
    .filter(([p]) => !kept.has(p.id))
    .reverse()
    .forEach(([, i]) => out.push({ op: "remove", path: `/promos/${i}`, reason: why(`/promos/${i}`, "Replaced by a stronger offer") }));
  const had = new Set(original.promos.map((p) => p.id));
  for (const p of final.promos.filter((x) => !had.has(x.id))) {
    out.push({ op: "add", path: "/promos/-", value: p, reason: why(`promo:${p.id}`) });
  }
  return out;
}
