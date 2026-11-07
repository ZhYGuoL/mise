import { Concept, ConceptEdit, MenuItem } from "@mise/shared";
import { applyOperation, getValueByPointer } from "fast-json-patch";
import { siteById, toLocation } from "./sites";

/**
 * Code decides: every edit is checked, applied to a copy, and the result is validated with zod.
 * Nothing the model writes reaches the owner unless the whole batch passes.
 */

export type ApplyResult =
  | { ok: true; concept: Concept; edits: ConceptEdit[] }
  | { ok: false; error: string };

/** Fields that only code writes. */
const LOCKED = [/^\/id$/, /^\/version$/, /^\/brand\/logoUrl$/, /^\/menu\/\d+\/imageUrl$/, /^\/menu\/\d+\/id$/];

/** Price, location and cuisine changes wait for the owner. Adding or removing a dish changes prices too. */
const NEEDS_APPROVAL = [
  /\/price$/,
  /^\/priceTier$/,
  /^\/deliveryFee$/,
  /^\/serviceFeePct$/,
  /^\/promos(\/|$)/,
  /^\/location(\/|$)/,
  /^\/cuisine(\/|$)/,
  /^\/menu(\/(\d+|-))?$/,
];

export const needsApproval = (edits: ConceptEdit[]) =>
  edits.some((e) => NEEDS_APPROVAL.some((re) => re.test(e.path)));

const read = (doc: unknown, path: string) => {
  try {
    return structuredClone(getValueByPointer(doc, path));
  } catch {
    return undefined;
  }
};

function nextItemId(menu: { id: string }[]) {
  const n = menu.reduce((max, m) => Math.max(max, Number(/^m(\d+)$/.exec(m.id)?.[1] ?? 0)), 0);
  return `m${n + 1}`;
}

/** A location value can be a site id string or {siteId}. Code turns it into the real address and lat/lon. */
function resolveLocation(value: unknown): unknown {
  const id = typeof value === "string" ? value : (value as { siteId?: unknown } | null)?.siteId;
  if (typeof id !== "string") return value;
  const site = siteById(id);
  if (!site) throw new Error(`unknown site id "${id}"`);
  return toLocation(site);
}

/** A new dish gets its id and empty image from code. */
function prepareItem(value: unknown, menu: { id: string }[]): unknown {
  if (!value || typeof value !== "object") return value;
  return { tags: [], ...(value as Record<string, unknown>), id: nextItemId(menu), imageUrl: null };
}

export function applyEdits(base: Concept, edits: ConceptEdit[]): ApplyResult {
  if (edits.length === 0) return { ok: false, error: "no edits" };
  const doc = structuredClone(base) as Concept;
  const filled: ConceptEdit[] = [];

  for (const [i, raw] of edits.entries()) {
    const edit = ConceptEdit.safeParse(raw);
    if (!edit.success) return { ok: false, error: `edit ${i}: ${edit.error.issues.map((x) => x.message).join("; ")}` };
    const { op, path, reason } = edit.data;
    let value = edit.data.value;
    const label = `edit ${i} (${op} ${path})`;

    if (!path.startsWith("/")) return { ok: false, error: `${label}: path must start with "/"` };
    if (LOCKED.some((re) => re.test(path))) return { ok: false, error: `${label}: ${path} is set by code, not by edits` };
    if (op !== "remove" && value === undefined) return { ok: false, error: `${label}: value is required` };

    try {
      if (path === "/location") value = resolveLocation(value);
      const arrayInsert = op === "add" && /\/(\d+|-)$/.test(path);
      const previous = arrayInsert ? undefined : read(doc, path);
      if (op !== "add" && previous === undefined) return { ok: false, error: `${label}: nothing at ${path}` };
      if (op === "add" && /^\/menu\/(\d+|-)$/.test(path)) value = prepareItem(value, doc.menu);
      // A whole-dish replace keeps the dish id and photo. A new photo prompt gets a new photo later.
      if (op === "replace" && /^\/menu\/\d+$/.test(path) && value && typeof value === "object") {
        const old = previous as MenuItem;
        value = { tags: [], ...(value as object), id: old.id, imageUrl: old.imageUrl };
      }
      // A replace that keeps the same value is not a change. It must not make a version.
      if (op === "replace" && JSON.stringify(previous) === JSON.stringify(value)) continue;
      applyOperation(doc, { op, path, value } as never, true, true);
      filled.push({ op, path, value, previous, reason });
    } catch (err) {
      return { ok: false, error: `${label}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
    }
  }

  if (filled.length === 0) return { ok: false, error: "the edits change nothing: every value is already set" };
  doc.version = base.version + 1;
  const parsed = Concept.safeParse(doc);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((x) => `${"/" + x.path.join("/")}: ${x.message}`).join("; ");
    return { ok: false, error: `the result is not a valid concept: ${issues}` };
  }
  const ids = parsed.data.menu.map((m) => m.id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: "menu item ids must be unique" };
  return { ok: true, concept: parsed.data, edits: filled };
}

/** Images that an applied version needs: new dishes, dishes with a new photo prompt, and the logo when the brand changed. */
export function imageTargets(before: Concept | null, after: Concept): string[] {
  const targets: string[] = [];
  const brandChanged =
    !before ||
    before.name !== after.name ||
    before.brand.logoPrompt !== after.brand.logoPrompt ||
    JSON.stringify(before.brand.colors) !== JSON.stringify(after.brand.colors);
  if (brandChanged) targets.push("logo");
  for (const item of after.menu) {
    const old = before?.menu.find((m) => m.id === item.id);
    if (!old || old.imagePrompt !== item.imagePrompt || old.name !== item.name) targets.push(item.id);
  }
  return targets;
}

export type { MenuItem };
