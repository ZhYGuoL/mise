/**
 * Build the Restaurant[] city list from data/raw/.
 * 192 OpenStreetMap places. 79 of them also have Google rating, reviews and popular times.
 */
import path from "node:path";
import type { Day, Restaurant } from "@mise/shared";
import { DEFAULT_TIER, normalizeCuisine, normalizeCuisines, type Cuisine } from "./cuisine";

const DAYS: Day[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type OsmPlace = {
  osm_id: string;
  name: string;
  amenity: "restaurant" | "fast_food";
  cuisine: string | null;
  lat: number;
  lon: number;
};

type GooglePlace = OsmPlace & {
  place_id: string;
  g_name: string;
  g_lat: number;
  g_lon: number;
  rating: number | null;
  reviews: number | null;
  category: string | null;
  has_popular_times: boolean;
  popular_times: Record<string, Record<string, number>> | null;
};

/** Tags that describe a side or a drink, not what the place is. Used only when nothing else matches. */
const WEAK = new Set(["smoothie", "salad", "fries", "beef", "soup", "tea", "coffee", "juice", "meat", "ice_cream", "bubble_tea", "dessert", "gelato", "coffee_shop", "bakery"]);

/** OSM places with no cuisine tag. Read from the name by hand. */
const BY_NAME: Record<string, Cuisine[]> = {
  "Teriyaki Express": ["japanese"],
  "Murray Ave. Grill": ["american", "breakfast"],
  "Pittsburgh Popcorn Company": ["dessert"],
  "Campus Deli": ["sandwich"],
  "Pamela's Diner": ["breakfast", "american"],
  "Trapuzzano Italian Chophouse": ["italian", "american"],
  "Butterjoint": ["american"],
  "Fet-Fisk": ["european", "seafood"],
  "Pleasure Bar": ["italian"],
  "Chick-n Grille": ["fried_chicken"],
  "Yue Bai Wei": ["chinese"],
  "St. Clair Social": ["american"],
  "Roots Natural Kitchen": ["healthy"],
  "Spirits and Tales": ["american"],
  "Pitt's Halal Brothers": ["mediterranean"],
  "Caribbean Village Fusion": ["caribbean"],
  "Pasha Mediterranean restaurant": ["mediterranean"],
  "The Colombian Spot": ["latin"],
  "MilkShake Factory Oakland": ["dessert"],
  "Smashed Waffles": ["breakfast", "dessert"],
  "G's on Liberty": ["american"],
};

/** Name words that say the cuisine louder than the tags do. */
const NAME_WORDS: [RegExp, Cuisine][] = [
  [/halal|gyro|kebab|shawarma|mediterranean/i, "mediterranean"],
  [/pizz/i, "pizza"],
  [/sushi|ramen|bento|teriyaki/i, "japanese"],
  [/taco|taqueria|burrito|mexican/i, "mexican"],
  [/chick|wing/i, "fried_chicken"],
  [/india|masala|chaat|tamarind/i, "indian"],
  [/bagel|diner|crepe|crêpe|waffle/i, "breakfast"],
  [/burger|hamburger/i, "burger"],
  [/sub|deli|hoagie/i, "sandwich"],
  [/thai/i, "thai"],
  [/noodle/i, "asian"],
];

/** Places we know are full-service or pricey. Everything else is guessed from category and amenity. */
const TIER_BY_NAME: Record<string, 1 | 2 | 3> = {
  Casbah: 3, "Muddy Waters Oyster Bar": 3, "Fet-Fisk": 3, "Spirits and Tales": 3, Mola: 3,
  "Trapuzzano Italian Chophouse": 3, "Alta Via Pizzeria": 2, Girasole: 3, Butterjoint: 2,
  "Union Grill": 2, "Paris 66": 2, "Pleasure Bar": 2, "St. Clair Social": 2, "Shady Grove": 2,
  "Silk Elephant": 2, "Urban Tap": 2, "Mad Mex": 2, "Condado Tacos": 2, "Kahuna": 2,
};

const CHEAP_CATEGORY = /fast food|pizza|sandwich|bagel|coffee|cafe|frozen yogurt|popcorn|chicken|hamburger|takeout|soup|creperie|noodle shop/i;
const PRICEY_CATEGORY = /oyster|scandinavian|new american|gastropub|steak/i;

function cuisinesFor(place: OsmPlace, category: string | null): Cuisine[] {
  if (BY_NAME[place.name]) return BY_NAME[place.name]!;
  const out: Cuisine[] = [];
  const push = (c: Cuisine | null) => c && !out.includes(c) && out.push(c);
  for (const [re, c] of NAME_WORDS) if (re.test(place.name)) push(c);
  if (category) push(normalizeCuisine(category.replace(/\b(restaurant|shop|store|bar|takeout|authentic)\b/gi, "").trim()));
  const tags = (place.cuisine ?? "").split(";").filter(Boolean);
  for (const t of normalizeCuisines(tags.filter((t) => !WEAK.has(t)))) push(t);
  if (out.length === 0) for (const t of normalizeCuisines(tags)) push(t);
  if (out.length === 0) push(place.amenity === "fast_food" ? "burger" : "american");
  return out.slice(0, 3);
}

function tierFor(place: OsmPlace, category: string | null, cuisine: Cuisine[]): 1 | 2 | 3 {
  if (TIER_BY_NAME[place.name]) return TIER_BY_NAME[place.name]!;
  if (category && PRICEY_CATEGORY.test(category)) return 3;
  if (place.amenity === "fast_food") return 1;
  if (category && CHEAP_CATEGORY.test(category)) return 1;
  return DEFAULT_TIER[cuisine[0]!];
}

function popularTimesFor(g: GooglePlace): Restaurant["popularTimes"] {
  if (!g.has_popular_times || !g.popular_times) return null;
  const out = {} as Record<Day, Record<string, number>>;
  for (const day of DAYS) out[day] = { ...(g.popular_times[day] ?? {}) };
  return out;
}

export async function buildRestaurants(rawDir: string): Promise<Restaurant[]> {
  const osm = (await Bun.file(path.join(rawDir, "all_restaurants_osm.json")).json()) as { restaurants: OsmPlace[] };
  const google = (await Bun.file(path.join(rawDir, "restaurants_popular_times.json")).json()) as { restaurants: GooglePlace[] };
  const byOsm = new Map(google.restaurants.map((g) => [g.osm_id, g]));

  return osm.restaurants.map((place): Restaurant => {
    const g = byOsm.get(place.osm_id);
    const category = g?.category ?? null;
    const cuisine = cuisinesFor(place, category);
    return {
      placeId: g?.place_id ?? place.osm_id,
      name: place.name,
      lat: g?.g_lat ?? place.lat,
      lon: g?.g_lon ?? place.lon,
      cuisine,
      category,
      rating: g?.rating ?? null,
      reviews: g?.reviews ?? null,
      priceTier: tierFor(place, category, cuisine),
      popularTimes: g ? popularTimesFor(g) : null,
    };
  });
}
