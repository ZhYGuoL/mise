/**
 * Lane H. Start from an existing restaurant: query -> one real city restaurant -> a v1 Concept.
 *
 * Real data fills what it can: name, location, cuisine, price tier, hours, rating and reviews.
 * The menu comes from the restaurant's website when code can verify it there ("website"),
 * else MODEL_FAST drafts a likely one ("estimated"). Brand colors and voice are drafted.
 * Each import is cached in data/import/, so a repeat import is instant and free.
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Concept, type ImportRequest, ImportResponse } from "@mise/shared";
import { fixture, isMock, ROOT } from "../fixtures";
import { TYPICAL_DELIVERY_FEE, TYPICAL_SERVICE_PCT } from "../sim/model";
import { type Brand, type DraftItem, draftBrand, extractMenu, MIN_PRICES, MIN_WEBSITE_ITEMS } from "./draft";
import { hoursFor, type HoursSource } from "./hours";
import { fastModel } from "./llm";
import { matchQuery } from "./match";
import { loadPlaces, type Place } from "./places";
import { readSite } from "./website";

export const CACHE_DIR = path.join(ROOT, "data/import");

export class ImportFailure extends Error {
  constructor(
    message: string,
    readonly status: 404 | 502 | 503,
    readonly suggestions: Place[] = [],
  ) {
    super(message);
  }
}

type CacheEntry = {
  placeId: string;
  createdAt: string;
  costUsd: number;
  hoursSource: HoursSource;
  /** website pages read, empty when the menu is estimated */
  pages: string[];
  concept: Concept;
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "restaurant";
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 6);
const cacheFile = (p: Place) => path.join(CACHE_DIR, `${slug(p.restaurant.name)}-${sha(p.restaurant.placeId)}.json`);

async function readCache(p: Place): Promise<CacheEntry | null> {
  const f = Bun.file(cacheFile(p));
  if (!(await f.exists())) return null;
  try {
    const entry = (await f.json()) as CacheEntry;
    return { ...entry, concept: Concept.parse(entry.concept) };
  } catch (err) {
    console.warn(`[import] cache for ${p.restaurant.name} is unreadable, importing again:`, (err as Error).message);
    return null;
  }
}

/** The sim needs at least one main to order. A menu of only sides makes the first item the main. */
function withMain(items: DraftItem[]): DraftItem[] {
  if (items.some((i) => i.category === "main" || i.category === "combo")) return items;
  return items.map((i, k) => (k === 0 ? { ...i, category: "main" } : i));
}

function buildConcept(place: Place, brand: Brand, items: DraftItem[], menuSource: "website" | "estimated", hours: Concept["hours"]): Concept {
  const r = place.restaurant;
  const f = place.facts;
  const address = [f.street, "Pittsburgh", f.postcode ? `PA ${f.postcode}` : "PA"].filter(Boolean).join(", ");
  return Concept.parse({
    id: `${slug(r.name)}-${sha(r.placeId)}`,
    version: 1,
    name: r.name,
    tagline: brand.tagline,
    cuisine: r.cuisine.length ? r.cuisine : ["american"],
    location: { lat: r.lat, lon: r.lon, address, neighborhood: f.neighborhood ?? "Pittsburgh" },
    hours,
    priceTier: Math.min(4, Math.max(1, Math.round(r.priceTier ?? 2))),
    // What delivery apps charge around here. The sim scores fees against these, so an unchanged import is neutral.
    deliveryFee: TYPICAL_DELIVERY_FEE,
    serviceFeePct: TYPICAL_SERVICE_PCT,
    menu: withMain(items).map((it, i) => ({ ...it, id: `m${i + 1}`, imageUrl: null })),
    brand: { logoUrl: null, logoPrompt: brand.logoPrompt || undefined, colors: brand.colors, voice: brand.voice },
    promos: [],
    existing: { placeId: r.placeId, name: r.name, rating: r.rating, reviews: r.reviews, menuSource, websiteUrl: f.website },
  });
}

const fallbackBrand = (place: Place): Brand => ({
  tagline: `${place.restaurant.name} in ${place.facts.neighborhood ?? "Pittsburgh"}`,
  voice: "Warm, plain and quick.",
  logoPrompt: "",
  colors: { primary: "#B0452F", background: "#FAF7F2", ink: "#1A1A1A" },
});

async function build(place: Place): Promise<CacheEntry> {
  const r = place.restaurant;
  if (!fastModel()) throw new ImportFailure(`${r.name} is not imported yet, and MODEL_FAST is not set.`, 503);

  const site = place.facts.website ? await readSite(place.facts.website) : null;
  const canExtract = !!site && site.prices >= MIN_PRICES;
  const [extracted, drafted] = await Promise.all([
    canExtract
      ? extractMenu(place, site!).catch((err) => {
          console.warn(`[import] menu extraction for ${r.name} failed:`, (err as Error).message);
          return null;
        })
      : null,
    draftBrand(place, site).catch((err) => {
      console.warn(`[import] brand draft for ${r.name} failed:`, (err as Error).message);
      return null;
    }),
  ]);

  const fromSite = !!extracted && extracted.items.length >= MIN_WEBSITE_ITEMS;
  const items = fromSite ? extracted!.items : (drafted?.items ?? []);
  if (!items.length) throw new ImportFailure(`Could not get a menu for ${r.name}. Try again.`, 502);

  const { hours, source: hoursSource } = hoursFor(r, place.facts.openingHours);
  const concept = buildConcept(place, drafted?.brand ?? fallbackBrand(place), items, fromSite ? "website" : "estimated", hours);
  const costUsd = (extracted?.costUsd ?? 0) + (drafted?.costUsd ?? 0);

  const menuNote = fromSite
    ? `website, ${items.length} items from ${new URL(site!.pages[0]!).hostname}${extracted!.dropped ? `, ${extracted!.dropped} not on the page and dropped` : ""}`
    : `estimated${site ? ` (${site.prices} prices on the site${extracted ? `, ${extracted.items.length} verified` : ""})` : place.facts.website ? " (site did not load)" : " (no website)"}`;
  console.log(`[import] ${r.name}: menu ${menuNote}, hours ${hoursSource}, $${costUsd.toFixed(4)}`);

  return {
    placeId: r.placeId,
    createdAt: new Date().toISOString(),
    costUsd,
    hoursSource,
    pages: fromSite ? site!.pages : [],
    concept,
  };
}

const inflight = new Map<string, Promise<CacheEntry>>();

export async function importRestaurant(req: ImportRequest): Promise<ImportResponse> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const places = await loadPlaces();
  const match = await matchQuery(req.query, places, req.placeId);
  if (!match.ok) throw new ImportFailure(match.error, 404, match.suggestions);
  const place = match.place;

  const cached = await readCache(place);
  if (cached) {
    console.log(`[import] ${place.restaurant.name}: cached, $0, ${ms()} ms`);
    return ImportResponse.parse({ concept: cached.concept, cached: true, costUsd: 0, ms: ms(), hoursSource: cached.hoursSource });
  }
  if (isMock()) {
    console.warn(`[import] MOCK=1 and ${place.restaurant.name} is not cached: serving the fixture`);
    return ImportResponse.parse({ ...(await fixture("import", ImportResponse)), cached: true, costUsd: 0, ms: ms() });
  }

  const key = place.restaurant.placeId;
  let job = inflight.get(key);
  if (!job) {
    job = build(place).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  const entry = await job;
  await mkdir(CACHE_DIR, { recursive: true });
  await Bun.write(cacheFile(place), JSON.stringify(entry, null, 1) + "\n");
  console.log(`[import] ${place.restaurant.name}: done in ${ms()} ms, $${entry.costUsd.toFixed(4)}`);
  return ImportResponse.parse({ concept: entry.concept, cached: false, costUsd: entry.costUsd, ms: ms(), hoursSource: entry.hoursSource });
}
