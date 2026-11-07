/**
 * The small cuisine vocabulary the simulator matches on.
 * Restaurants, residents and concepts all map their tokens into this list.
 */

export const CUISINES = [
  "american", "burger", "pizza", "sandwich", "breakfast", "fried_chicken",
  "chinese", "taiwanese", "japanese", "korean", "thai", "vietnamese", "asian",
  "indian", "mediterranean", "mexican", "latin", "caribbean", "italian",
  "healthy", "cafe", "dessert", "seafood", "european",
] as const;
export type Cuisine = (typeof CUISINES)[number];

const VOCAB = new Set<string>(CUISINES);

/** Raw token (OSM tag, Google category word, concept token) -> vocabulary token. */
const ALIASES: Record<string, Cuisine> = {
  diner: "breakfast", bagel: "breakfast", brunch: "breakfast", crepe: "breakfast", creperie: "breakfast",
  waffle: "breakfast", waffles: "breakfast", pancake: "breakfast",
  hamburger: "burger", burgers: "burger", hot_dog: "burger", hotdog: "burger",
  chicken: "fried_chicken", wings: "fried_chicken", chicken_wings: "fried_chicken", fried_food: "fried_chicken",
  fingers: "fried_chicken", chicken_fingers: "fried_chicken", nashville: "fried_chicken", fried: "fried_chicken",
  sub: "sandwich", subs: "sandwich", deli: "sandwich", hoagie: "sandwich", sandwiches: "sandwich",
  sichuan: "chinese", szechuan: "chinese", hunan: "chinese", cantonese: "chinese", dim_sum: "chinese",
  dumpling: "chinese", dumplings: "chinese", hot_pot: "chinese", xian: "chinese", "烧烤店": "chinese", skewers: "chinese",
  sushi: "japanese", ramen: "japanese", teriyaki: "japanese", bento: "japanese", izakaya: "japanese", udon: "japanese",
  matcha: "cafe",
  korean_bbq: "korean", kbbq: "korean", bibimbap: "korean", tteokbokki: "korean",
  lao: "thai", laotian: "thai",
  pho: "vietnamese", banh_mi: "vietnamese",
  noodle: "asian", noodles: "asian", malaysian: "asian", filipino: "asian", pan_asian: "asian",
  asian_fusion: "asian", fusion: "asian", indonesian: "asian", curry: "indian",
  nepali: "indian", pakistani: "indian", bangladeshi: "indian", bengali: "indian", south_indian: "indian", chaat: "indian",
  greek: "mediterranean", lebanese: "mediterranean", middle_eastern: "mediterranean", turkish: "mediterranean",
  kebab: "mediterranean", falafel: "mediterranean", shawarma: "mediterranean", gyros: "mediterranean", gyro: "mediterranean",
  arab: "mediterranean", syrian: "mediterranean", moroccan: "mediterranean", halal: "mediterranean",
  persian: "mediterranean", israeli: "mediterranean", afghan: "mediterranean",
  tacos: "mexican", taco: "mexican", burrito: "mexican", burritos: "mexican", tex_mex: "mexican", tex: "mexican",
  peruvian: "latin", colombian: "latin", latin_american: "latin", cuban: "latin", venezuelan: "latin",
  salvadoran: "latin", brazilian: "latin", arepa: "latin", arepas: "latin", empanadas: "latin",
  jamaican: "caribbean", haitian: "caribbean", puerto_rican: "caribbean", dominican: "caribbean",
  pasta: "italian", chophouse: "italian",
  salad: "healthy", poke: "healthy", juice: "healthy", smoothie: "healthy", bowl: "healthy", bowls: "healthy",
  vegan: "healthy", vegetarian: "healthy", grain_bowl: "healthy",
  coffee: "cafe", coffee_shop: "cafe", tea: "cafe", bubble_tea: "cafe", boba: "cafe", bakery: "cafe",
  ice_cream: "dessert", gelato: "dessert", donut: "dessert", donuts: "dessert", frozen_yogurt: "dessert",
  popcorn: "dessert", milkshake: "dessert", desserts: "dessert", cake: "dessert", cookies: "dessert",
  fish: "seafood", oyster: "seafood", oysters: "seafood", fish_and_chips: "seafood", cajun: "seafood",
  french: "european", scandinavian: "european", german: "european", polish: "european", spanish: "european",
  british: "european", irish: "european",
  gastropub: "american", new_american: "american", steak: "american", steakhouse: "american", bbq: "american",
  barbecue: "american", soul_food: "american", southern: "american", meat: "american", beef: "american",
  soup: "american", fries: "american",
};

/** Normalize one raw token. Unknown tokens return null. */
export function normalizeCuisine(raw: string): Cuisine | null {
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (VOCAB.has(t)) return t as Cuisine;
  if (ALIASES[t]) return ALIASES[t];
  // "korean_fried_chicken" -> try each part, longest match first
  const parts = t.split("_");
  for (let n = parts.length - 1; n >= 1; n--) {
    for (let i = 0; i + n <= parts.length; i++) {
      const sub = parts.slice(i, i + n).join("_");
      if (VOCAB.has(sub)) return sub as Cuisine;
      if (ALIASES[sub]) return ALIASES[sub];
    }
  }
  return null;
}

/** Normalize a list, dedupe, keep order. */
export function normalizeCuisines(raw: string[]): Cuisine[] {
  const out: Cuisine[] = [];
  for (const r of raw) {
    const c = normalizeCuisine(r);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Plain display word for objection labels. */
export const CUISINE_LABEL: Record<Cuisine, string> = {
  american: "American", burger: "burgers", pizza: "pizza", sandwich: "sandwiches", breakfast: "breakfast",
  fried_chicken: "fried chicken", chinese: "Chinese", taiwanese: "Taiwanese", japanese: "Japanese",
  korean: "Korean", thai: "Thai", vietnamese: "Vietnamese", asian: "noodles", indian: "Indian",
  mediterranean: "Mediterranean", mexican: "Mexican", latin: "Latin food", caribbean: "Caribbean",
  italian: "Italian", healthy: "salads and bowls", cafe: "boba and coffee", dessert: "dessert",
  seafood: "seafood", european: "bistro food",
};

/** Share of places of each cuisine that have a real option for each diet. Used to seed competitor menus. */
export const DIET_SUPPORT: Record<Cuisine, { vegetarian: number; vegan: number; halal: number; gluten_free: number }> = {
  american: { vegetarian: 0.6, vegan: 0.25, halal: 0.05, gluten_free: 0.35 },
  burger: { vegetarian: 0.55, vegan: 0.3, halal: 0.1, gluten_free: 0.3 },
  pizza: { vegetarian: 0.95, vegan: 0.3, halal: 0.05, gluten_free: 0.4 },
  sandwich: { vegetarian: 0.7, vegan: 0.3, halal: 0.05, gluten_free: 0.25 },
  breakfast: { vegetarian: 0.9, vegan: 0.25, halal: 0.05, gluten_free: 0.35 },
  fried_chicken: { vegetarian: 0.2, vegan: 0.05, halal: 0.25, gluten_free: 0.15 },
  chinese: { vegetarian: 0.8, vegan: 0.55, halal: 0.05, gluten_free: 0.25 },
  taiwanese: { vegetarian: 0.6, vegan: 0.35, halal: 0.03, gluten_free: 0.2 },
  japanese: { vegetarian: 0.65, vegan: 0.4, halal: 0.05, gluten_free: 0.4 },
  korean: { vegetarian: 0.5, vegan: 0.3, halal: 0.05, gluten_free: 0.3 },
  thai: { vegetarian: 0.9, vegan: 0.7, halal: 0.1, gluten_free: 0.6 },
  vietnamese: { vegetarian: 0.7, vegan: 0.5, halal: 0.05, gluten_free: 0.6 },
  asian: { vegetarian: 0.75, vegan: 0.5, halal: 0.08, gluten_free: 0.3 },
  indian: { vegetarian: 0.98, vegan: 0.75, halal: 0.6, gluten_free: 0.7 },
  mediterranean: { vegetarian: 0.95, vegan: 0.8, halal: 0.85, gluten_free: 0.6 },
  mexican: { vegetarian: 0.9, vegan: 0.6, halal: 0.05, gluten_free: 0.7 },
  latin: { vegetarian: 0.6, vegan: 0.3, halal: 0.05, gluten_free: 0.6 },
  caribbean: { vegetarian: 0.5, vegan: 0.3, halal: 0.1, gluten_free: 0.5 },
  italian: { vegetarian: 0.9, vegan: 0.35, halal: 0.03, gluten_free: 0.45 },
  healthy: { vegetarian: 1, vegan: 0.9, halal: 0.2, gluten_free: 0.9 },
  cafe: { vegetarian: 0.95, vegan: 0.6, halal: 0.1, gluten_free: 0.4 },
  dessert: { vegetarian: 1, vegan: 0.3, halal: 0.2, gluten_free: 0.3 },
  seafood: { vegetarian: 0.3, vegan: 0.1, halal: 0.15, gluten_free: 0.6 },
  european: { vegetarian: 0.8, vegan: 0.4, halal: 0.03, gluten_free: 0.5 },
};

/** Price tier guess for a cuisine when we have no Google price. */
export const DEFAULT_TIER: Record<Cuisine, 1 | 2 | 3> = {
  american: 2, burger: 1, pizza: 1, sandwich: 1, breakfast: 1, fried_chicken: 1, chinese: 2,
  taiwanese: 2, japanese: 2, korean: 2, thai: 2, vietnamese: 2, asian: 2, indian: 2,
  mediterranean: 2, mexican: 1, latin: 2, caribbean: 2, italian: 2, healthy: 2, cafe: 1,
  dessert: 1, seafood: 3, european: 3,
};

/** Per-person menu price (before fees) for a price tier. */
export const TIER_PRICE: Record<number, number> = { 1: 11, 2: 16, 3: 27, 4: 42 };
