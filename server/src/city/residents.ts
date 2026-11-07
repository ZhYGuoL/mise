/**
 * Generate the simulated residents with a fixed seed.
 * Phase 1: a hand-set mix per area. Phase 3 swaps this for US Census ACS tract data.
 */
import type { Resident, Restaurant, Segment } from "@mise/shared";
import { CUISINE_LABEL, CUISINES, type Cuisine } from "./cuisine";
import { clamp, hash, normal, pick, pickIndex, rng, round } from "./rng";
import { RADIUS_KM, SCALE, distanceKm, dietOk, placeModel, placeTerms, sumTerms } from "../sim/model";

/* ───────── areas ───────── */

export type Area = {
  id: string;
  /** Plain name used in labels, e.g. "too far for Shadyside residents". */
  name: string;
  lat: number;
  lon: number;
  /** spread in degrees (1 sd) */
  sdLat: number;
  sdLon: number;
  people: number;
  /** undergrad, grad_student, young_professional, family, other */
  mix: [number, number, number, number, number];
  school?: "Pitt" | "CMU";
};

export const AREAS: Area[] = [
  { id: "zone:central-oakland", name: "Central Oakland", lat: 40.4378, lon: -79.9575, sdLat: 0.0028, sdLon: 0.0042, people: 2100, mix: [0.68, 0.17, 0.07, 0.02, 0.06], school: "Pitt" },
  { id: "zone:pitt-campus", name: "Pitt campus", lat: 40.4428, lon: -79.9565, sdLat: 0.0012, sdLon: 0.0028, people: 900, mix: [0.97, 0.03, 0, 0, 0], school: "Pitt" },
  { id: "zone:cmu-campus", name: "CMU campus", lat: 40.4452, lon: -79.9418, sdLat: 0.0012, sdLon: 0.0026, people: 600, mix: [0.95, 0.05, 0, 0, 0], school: "CMU" },
  { id: "zone:north-oakland", name: "North Oakland", lat: 40.4505, lon: -79.9505, sdLat: 0.0028, sdLon: 0.0045, people: 1400, mix: [0.3, 0.38, 0.2, 0.04, 0.08] },
  { id: "zone:south-oakland", name: "South Oakland", lat: 40.4312, lon: -79.9575, sdLat: 0.0022, sdLon: 0.0035, people: 800, mix: [0.45, 0.15, 0.1, 0.1, 0.2], school: "Pitt" },
  { id: "zone:shadyside", name: "Shadyside", lat: 40.4545, lon: -79.934, sdLat: 0.0035, sdLon: 0.0065, people: 2000, mix: [0.08, 0.2, 0.52, 0.1, 0.1] },
  { id: "zone:squirrel-hill-north", name: "Squirrel Hill North", lat: 40.4438, lon: -79.9245, sdLat: 0.0035, sdLon: 0.006, people: 1300, mix: [0.04, 0.16, 0.18, 0.5, 0.12] },
  { id: "zone:east-liberty", name: "East Liberty", lat: 40.4612, lon: -79.925, sdLat: 0.0025, sdLon: 0.005, people: 900, mix: [0.04, 0.09, 0.37, 0.22, 0.28] },
];

export const AREA_NAME: Record<string, string> = Object.fromEntries(AREAS.map((a) => [a.id, a.name]));

const SEGMENTS: Segment[] = ["undergrad", "grad_student", "young_professional", "family", "other"];

/** Nobody lives in Schenley Park. */
const inPark = (lat: number, lon: number) => lat < 40.4398 && lon > -79.9525 && lon < -79.932;

/* ───────── backgrounds: names, food and diet ───────── */

type Background = "us" | "east_asian" | "south_asian" | "middle_east" | "latin";
const BACKGROUNDS: Background[] = ["us", "east_asian", "south_asian", "middle_east", "latin"];

const BACKGROUND_MIX: Record<Segment, number[]> = {
  undergrad: [0.55, 0.25, 0.1, 0.04, 0.06],
  grad_student: [0.35, 0.3, 0.25, 0.04, 0.06],
  young_professional: [0.7, 0.12, 0.08, 0.05, 0.05],
  family: [0.7, 0.12, 0.08, 0.04, 0.06],
  other: [0.78, 0.06, 0.04, 0.05, 0.07],
};

const NAMES: Record<Background, string[]> = {
  us: ["Emma", "Olivia", "Ava", "Sophia", "Mia", "Liam", "Noah", "Ethan", "Mason", "Jacob", "Madison", "Hannah", "Tyler", "Ryan", "Kayla", "Jordan", "Taylor", "Marcus", "Jasmine", "Brianna", "Darnell", "Andre", "Keisha", "Connor", "Megan", "Sarah", "Rachel", "Kevin", "Brian", "Lauren", "Ashley", "Nicole", "Jake", "Zach", "Caleb", "Grace", "Chloe", "Abby", "Logan", "Owen", "Henry", "Nora", "Claire", "Eli", "Maya", "Ben", "Sam", "Max", "Leah", "Anna", "Dylan", "Gabe", "Jenna", "Kyle", "Sean", "Erin", "Molly", "Danny", "Joe", "Frank", "Linda", "Carol", "Denise", "Gary", "Rick", "Pat", "Deb", "Tom", "Mike", "Lisa", "Karen", "Steve", "Jim", "Tasha", "Malik", "Imani", "DeShawn", "Aaliyah", "Quinn", "Riley"],
  east_asian: ["Wei", "Jun", "Yuki", "Haruto", "Min-jun", "Seo-yeon", "Ji-woo", "Jiayi", "Xinyi", "Hao", "Yiming", "Mei", "Lin", "Yuna", "Sora", "Kenji", "Hana", "Eun-ji", "Tae-yang", "Zhihan", "Ruoxi", "Yifan", "Zixuan", "Kai", "Jia", "Shu", "Hyun", "Minh", "Linh", "Bao", "Thao", "Jae", "Ming", "Xiao", "Rin"],
  south_asian: ["Priya", "Arjun", "Ananya", "Rohan", "Aditi", "Vikram", "Sneha", "Rahul", "Kavya", "Nikhil", "Isha", "Aarav", "Meera", "Siddharth", "Divya", "Karan", "Pooja", "Varun", "Riya", "Aditya", "Neha", "Farhan", "Ayesha", "Tanvir", "Sana", "Imran"],
  middle_east: ["Omar", "Layla", "Yusuf", "Fatima", "Ahmed", "Noor", "Karim", "Zainab", "Hassan", "Mariam", "Ali", "Sara", "Bilal", "Amira", "Tariq", "Rania"],
  latin: ["Sofia", "Mateo", "Valentina", "Diego", "Camila", "Santiago", "Lucia", "Javier", "Isabella", "Carlos", "Gabriela", "Andres", "Daniela", "Luis", "Elena", "Rafael"],
};

type Some<T> = { [K in keyof T]?: number };

const SEGMENT_TASTE: Record<Segment, Some<Record<Cuisine, number>>> = {
  undergrad: { pizza: 0.6, fried_chicken: 0.6, burger: 0.4, chinese: 0.3, mexican: 0.4, sandwich: 0.3, japanese: 0.3, korean: 0.3, cafe: 0.3, dessert: 0.2, thai: 0.2, taiwanese: 0.2, indian: 0.1, mediterranean: 0.3, breakfast: 0.2, italian: 0.1, american: 0.1, seafood: -0.4, european: -0.5 },
  grad_student: { thai: 0.4, indian: 0.3, chinese: 0.4, japanese: 0.4, mediterranean: 0.4, mexican: 0.3, pizza: 0.3, korean: 0.3, healthy: 0.2, vietnamese: 0.3, fried_chicken: 0.2, burger: 0.1, cafe: 0.2, european: -0.2 },
  young_professional: { healthy: 0.5, mediterranean: 0.5, thai: 0.4, japanese: 0.5, mexican: 0.4, italian: 0.4, american: 0.3, burger: 0.2, pizza: 0.1, vietnamese: 0.3, korean: 0.3, indian: 0.3, seafood: 0.2, european: 0.2 },
  family: { pizza: 0.7, italian: 0.5, american: 0.5, chinese: 0.4, mexican: 0.4, burger: 0.3, sandwich: 0.3, breakfast: 0.3, fried_chicken: 0.3, japanese: 0.2, thai: 0.1, korean: -0.1, healthy: 0.1, european: -0.1 },
  other: { american: 0.5, pizza: 0.5, chinese: 0.3, sandwich: 0.4, burger: 0.4, italian: 0.3, mexican: 0.2, fried_chicken: 0.3, breakfast: 0.3, seafood: 0.2, korean: -0.2, european: -0.2 },
};

const BACKGROUND_TASTE: Record<Background, Some<Record<Cuisine, number>>> = {
  us: { american: 0.2, burger: 0.2, sandwich: 0.1 },
  east_asian: { chinese: 0.9, taiwanese: 0.9, japanese: 0.6, korean: 0.7, cafe: 0.4, asian: 0.4, vietnamese: 0.3, thai: 0.2, pizza: -0.2, american: -0.3, sandwich: -0.3 },
  south_asian: { indian: 1.2, mediterranean: 0.4, thai: 0.3, chinese: 0.2, burger: -0.2, american: -0.3, seafood: -0.2 },
  middle_east: { mediterranean: 1.2, fried_chicken: 0.3, indian: 0.3, burger: 0.2 },
  latin: { mexican: 0.7, latin: 1.0, caribbean: 0.3 },
};

const DIET_ODDS: Record<Background, { vegetarian: number; vegan: number; halal: number; gluten_free: number }> = {
  us: { vegetarian: 0.06, vegan: 0.03, halal: 0.01, gluten_free: 0.03 },
  east_asian: { vegetarian: 0.04, vegan: 0.02, halal: 0.01, gluten_free: 0.02 },
  south_asian: { vegetarian: 0.3, vegan: 0.05, halal: 0.18, gluten_free: 0.02 },
  middle_east: { vegetarian: 0.04, vegan: 0.02, halal: 0.75, gluten_free: 0.02 },
  latin: { vegetarian: 0.04, vegan: 0.02, halal: 0, gluten_free: 0.03 },
};

/* ───────── segment parameters ───────── */

type Dist = [mean: number, sd: number, lo: number, hi: number];
const SEG: Record<Segment, {
  age: [number, number];
  household: [Resident["household"], number][];
  income: [Resident["incomeBand"], number][];
  budget: Dist; price: Dist; time: Dist; rating: Dist; habit: Dist; novelty: Dist;
  ordersPerWeek: number;
}> = {
  undergrad: {
    age: [18, 22], household: [["roommates", 0.75], ["alone", 0.25]], income: [["<25k", 0.92], ["25-50k", 0.08]],
    budget: [16, 2.5, 11, 24], price: [-0.15, 0.035, -0.26, -0.07], time: [-0.035, 0.012, -0.08, -0.012],
    rating: [0.45, 0.12, 0.1, 0.9], habit: [1.0, 0.25, 0.3, 1.8], novelty: [0.45, 0.3, -0.4, 1.2], ordersPerWeek: 2.4,
  },
  grad_student: {
    age: [22, 32], household: [["roommates", 0.55], ["alone", 0.3], ["partner", 0.15]], income: [["<25k", 0.4], ["25-50k", 0.6]],
    budget: [18, 2.5, 12, 26], price: [-0.12, 0.03, -0.22, -0.05], time: [-0.06, 0.018, -0.12, -0.02],
    rating: [0.6, 0.15, 0.2, 1.1], habit: [1.1, 0.25, 0.4, 1.8], novelty: [0.15, 0.3, -0.6, 0.9], ordersPerWeek: 2.2,
  },
  young_professional: {
    age: [23, 36], household: [["alone", 0.45], ["roommates", 0.25], ["partner", 0.3]], income: [["25-50k", 0.15], ["50-100k", 0.65], ["100k+", 0.2]],
    budget: [25, 4, 16, 40], price: [-0.05, 0.015, -0.1, -0.02], time: [-0.07, 0.02, -0.14, -0.025],
    rating: [0.9, 0.2, 0.3, 1.5], habit: [0.9, 0.25, 0.3, 1.6], novelty: [0.3, 0.3, -0.5, 1.0], ordersPerWeek: 2.6,
  },
  family: {
    age: [32, 52], household: [["family_with_kids", 0.85], ["partner", 0.15]], income: [["25-50k", 0.1], ["50-100k", 0.4], ["100k+", 0.5]],
    budget: [20, 3, 13, 30], price: [-0.08, 0.02, -0.15, -0.03], time: [-0.09, 0.02, -0.15, -0.04],
    rating: [0.7, 0.15, 0.3, 1.2], habit: [1.5, 0.25, 0.8, 2.2], novelty: [-0.35, 0.25, -1.0, 0.4], ordersPerWeek: 1.4,
  },
  other: {
    age: [24, 74], household: [["alone", 0.4], ["partner", 0.35], ["roommates", 0.15], ["family_with_kids", 0.1]], income: [["<25k", 0.25], ["25-50k", 0.4], ["50-100k", 0.3], ["100k+", 0.05]],
    budget: [18, 3.5, 11, 30], price: [-0.1, 0.025, -0.19, -0.04], time: [-0.05, 0.015, -0.1, -0.015],
    rating: [0.55, 0.15, 0.1, 1.0], habit: [1.4, 0.3, 0.6, 2.2], novelty: [-0.25, 0.3, -0.9, 0.6], ordersPerWeek: 1.1,
  },
};

/* ───────── personas, from templates ───────── */

const GRAD_FIELDS = ["robotics", "chemistry", "public health", "computer science", "bioengineering", "economics", "history", "physics", "materials science", "neuroscience"];
const YP_JOBS = ["Nurse at UPMC", "Software engineer", "Research coordinator", "Product designer", "Lab tech at Pitt", "High school teacher", "Consultant", "Physical therapist", "Data analyst", "Pharmacist", "Bartender", "Grant writer"];
const OTHER_ROLES = ["Line cook", "Night-shift nurse", "Bus driver", "Grocery store manager", "Hospital custodian", "Barber", "Office manager", "Rideshare driver", "Mail carrier", "Home health aide"];
const RETIRED_ROLES = ["Retired teacher", "Retired steelworker", "Retired nurse", "Retired bus driver", "Retired librarian"];
const YEAR = (age: number) => (age <= 18 ? "First-year" : age === 19 ? "Sophomore" : age === 20 ? "Junior" : "Senior");
const KIDS = ["one kid", "two kids", "three kids"];

function whoSentence(seg: Segment, age: number, household: Resident["household"], area: Area, u: () => number): string {
  const where = area.name;
  switch (seg) {
    case "undergrad": {
      const school = area.school ?? (u() < 0.5 ? "Pitt" : "CMU");
      const home = area.id.endsWith("campus") ? "in a dorm" : household === "alone" ? `in a ${where} studio` : `with roommates in ${where}`;
      return `${YEAR(age)} at ${school}, lives ${home}.`;
    }
    case "grad_student": {
      const school = area.school ?? (u() < 0.5 ? "Pitt" : "CMU");
      const home = household === "partner" ? `with a partner in ${where}` : household === "alone" ? `alone in ${where}` : `shares a place in ${where}`;
      return `${pick(GRAD_FIELDS, u())} PhD student at ${school}, ${home}.`.replace(/^./, (c) => c.toUpperCase());
    }
    case "young_professional": {
      const home = household === "partner" ? `lives with a partner` : household === "alone" ? `lives alone` : `has roommates`;
      return `${pick(YP_JOBS, u())} in ${where}, ${home}.`;
    }
    case "family":
      return household === "family_with_kids"
        ? `Parent of ${pick(KIDS, u())} in ${where}, both parents work.`
        : `Lives with a partner in ${where}, orders for two.`;
    default:
      return `${pick(age >= 62 ? RETIRED_ROLES : OTHER_ROLES, u())} in ${where}.`;
  }
}

function habitSentence(r: Omit<Resident, "id" | "persona">, seg: Segment): string {
  const p = SEG[seg];
  // How far each trait sits from the segment average, in sds. The loudest one becomes the persona.
  const z = {
    price: (p.price[0] - r.weights.price) / p.price[1],
    time: (p.time[0] - r.weights.time) / p.time[1],
    rating: (r.weights.rating - p.rating[0]) / p.rating[1],
    habit: (r.weights.habit - p.habit[0]) / p.habit[1],
    novelty: (r.weights.novelty - p.novelty[0]) / p.novelty[1],
  };
  const top = (Object.entries(z) as [keyof typeof z, number][]).sort((a, b) => b[1] - a[1])[0]!;
  const fav = Object.entries(r.weights.cuisine).sort((a, b) => b[1] - a[1])[0];
  const loves = fav && fav[1] > 0.8 ? ` Could eat ${CUISINE_LABEL[fav[0] as Cuisine]} every week.` : "";
  const diet = r.diet.length ? ` ${r.diet[0] === "gluten_free" ? "Gluten-free" : r.diet[0]![0]!.toUpperCase() + r.diet[0]!.slice(1)}, so checks every menu for a real main.` : "";
  const trait =
    top[1] < 0.6 ? (r.weights.novelty > 0.3 ? "Happy to try new places." : "Has a short list of usual spots.")
    : top[0] === "price" ? `Watches every dollar, budget about $${Math.round(r.budgetPerMeal)} a meal.`
    : top[0] === "time" ? "Hates waiting. Anything over 30 minutes loses."
    : top[0] === "rating" ? "Reads the reviews first and skips anything under 4 stars."
    : top[0] === "habit" ? "Orders from the same few places on repeat."
    : "Tries every new place in its first week.";
  return trait + (diet || loves);
}

/* ───────── generator ───────── */

export type GenerateOptions = {
  seed?: number;
  areas?: Area[];
  /** Override the segment mix for every area (Wave 3 room test). */
  mix?: Area["mix"];
  restaurants: Restaurant[];
};

const pickWeighted = <T>(items: [T, number][], u: number) => items[pickIndex(items.map((i) => i[1]), u)]![0];
const draw = (rand: () => number, [mean, sd, lo, hi]: Dist) => clamp(mean + sd * normal(rand), lo, hi);

export function generateResidents(opts: GenerateOptions): Resident[] {
  const seed = opts.seed ?? 20261107;
  const areas = opts.areas ?? AREAS;
  const places = opts.restaurants.map((r) => ({ r, m: placeModel(r) }));
  const rand = rng(seed);
  const people: Omit<Resident, "id">[] = [];

  for (const area of areas) {
    const mix = opts.mix ?? area.mix;
    for (let i = 0; i < area.people; i++) {
      const seg = SEGMENTS[pickIndex(mix, rand())]!;
      const p = SEG[seg];
      const bg = BACKGROUNDS[pickIndex(BACKGROUND_MIX[seg], rand())]!;

      let lat = 0, lon = 0;
      do {
        lat = area.lat + area.sdLat * normal(rand);
        lon = area.lon + area.sdLon * normal(rand);
      } while (inPark(lat, lon));

      const age = Math.floor(p.age[0] + (p.age[1] - p.age[0] + 1) * Math.pow(rand(), seg === "other" ? 1 : 1.3));
      const household = pickWeighted(p.household, rand());
      const incomeBand = pickWeighted(p.income, rand());

      const odds = DIET_ODDS[bg];
      const diet: Resident["diet"] = [];
      const yp = seg === "young_professional" ? 1.4 : 1;
      if (rand() < odds.vegan * yp) diet.push("vegan");
      else if (rand() < odds.vegetarian * yp) diet.push("vegetarian");
      if (rand() < odds.halal) diet.push("halal");
      if (rand() < odds.gluten_free * (seg === "family" ? 1.6 : 1)) diet.push("gluten_free");

      const cuisine: Record<string, number> = {};
      for (const c of CUISINES) {
        const w = (SEGMENT_TASTE[seg][c] ?? 0) + (BACKGROUND_TASTE[bg][c] ?? 0) + 0.55 * normal(rand);
        if (Math.abs(w) >= 0.15) cuisine[c] = round(w, 2);
      }

      const ordersPerWeek = round(clamp(p.ordersPerWeek * Math.exp(0.5 * normal(rand) - 0.125), 0.2, 9), 1);

      const base = {
        name: pick(NAMES[bg], rand()),
        age,
        segment: seg,
        household,
        incomeBand,
        tractId: area.id,
        home: { lat: round(lat, 5), lon: round(lon, 5) },
        diet,
        budgetPerMeal: round(draw(rand, p.budget), 0),
        weights: {
          price: round(draw(rand, p.price), 3),
          time: round(draw(rand, p.time), 3),
          rating: round(draw(rand, p.rating), 2),
          habit: round(draw(rand, p.habit), 2),
          novelty: round(draw(rand, p.novelty), 2),
          cuisine,
        },
        ordersPerWeek,
        favorites: [] as string[],
      };

      // Favorites: three nearby places this person already likes, drawn from their own utility.
      const scored = places
        .map(({ r, m }) => {
          const km = distanceKm(base.home.lat, base.home.lon, r.lat, r.lon);
          if (km > RADIUS_KM || !dietOk(base, m.diet)) return null;
          return { id: r.placeId, w: Math.exp(SCALE * sumTerms(placeTerms(base as Resident, m, km, false))) };
        })
        .filter((x): x is { id: string; w: number } => x !== null);
      for (let k = 0; k < 3 && scored.length > 0; k++) {
        const idx = pickIndex(scored.map((s) => s.w), rand());
        base.favorites.push(scored[idx]!.id);
        scored.splice(idx, 1);
      }

      const sub = rng(hash(seed, area.id, i));
      const persona = `${whoSentence(seg, age, household, area, sub)} ${habitSentence(base, seg)}`;
      people.push({ ...base, persona });
    }
  }

  // Shuffle so any prefix (?sample=N) is a fair spread of the whole city, then number them.
  const shuffle = rng(hash(seed, "shuffle"));
  for (let i = people.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    [people[i], people[j]] = [people[j]!, people[i]!];
  }
  return people.map((p, i) => ({ id: `r${String(i).padStart(5, "0")}`, ...p }));
}
