/**
 * Mise shared contracts.
 *
 * Every lane imports from this file. Lanes may ADD optional fields.
 * Never rename or remove anything: other lanes depend on it.
 *
 * Two core shapes:
 *   1. Concept     - the restaurant being designed (the "code" in Cursor terms)
 *   2. Prediction  - what the simulated city says will happen (the "test run")
 */
import { z } from "zod";

/* ───────────── primitives ───────────── */

export const Day = z.enum([
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
]);
export type Day = z.infer<typeof Day>;

/** "HH:MM" 24h. close may be past midnight, e.g. open "17:00" close "02:00". */
export const TimeHM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const LatLon = z.object({ lat: z.number(), lon: z.number() });

export const DietTag = z.enum([
  "vegetarian", "vegan", "halal", "gluten_free", "spicy", "late_night",
]);

export const Segment = z.enum([
  "undergrad", "grad_student", "young_professional", "family", "other",
]);
export type Segment = z.infer<typeof Segment>;

/* ───────────── 1. Concept ───────────── */

export const MenuItem = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  price: z.number().nonnegative(),
  category: z.enum(["main", "side", "drink", "dessert", "combo"]),
  tags: z.array(DietTag).default([]),
  imagePrompt: z.string().optional(),
  imageUrl: z.string().nullable().default(null),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const Promo = z.object({
  id: z.string(),
  description: z.string(),
  discountPct: z.number().min(0).max(100).optional(),
  appliesTo: z.array(z.string()).optional(), // MenuItem ids; empty/undefined = whole menu
  days: z.array(Day).optional(),
  hours: z.tuple([TimeHM, TimeHM]).optional(),
});

export const Concept = z.object({
  id: z.string(),
  version: z.number().int().nonnegative(),
  name: z.string(),
  tagline: z.string(),
  /** lowercase snake tokens, e.g. ["korean", "fried_chicken"]. Sim matches on these. */
  cuisine: z.array(z.string()).min(1),
  location: LatLon.extend({
    address: z.string(),
    neighborhood: z.string(),
  }),
  /** null = closed that day */
  hours: z.record(Day, z.object({ open: TimeHM, close: TimeHM }).nullable()),
  priceTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  deliveryFee: z.number().nonnegative(),
  serviceFeePct: z.number().min(0).max(40),
  menu: z.array(MenuItem).min(1),
  brand: z.object({
    logoUrl: z.string().nullable().default(null),
    logoPrompt: z.string().optional(),
    colors: z.object({ primary: z.string(), background: z.string(), ink: z.string() }),
    voice: z.string(),
  }),
  promos: z.array(Promo).default([]),
});
export type Concept = z.infer<typeof Concept>;

/**
 * Every change the agent makes to a Concept is an RFC 6902 JSON Patch op
 * plus a human reason. The UI renders these as Cursor-style diffs.
 */
export const ConceptEdit = z.object({
  op: z.enum(["add", "remove", "replace"]),
  path: z.string(), // e.g. "/menu/0/price"
  value: z.unknown().optional(),
  previous: z.unknown().optional(), // filled by the server so the diff can show old -> new
  reason: z.string(),
});
export type ConceptEdit = z.infer<typeof ConceptEdit>;

/* ───────────── scenario ───────────── */

export const Scenario = z.object({
  day: Day,
  weather: z.enum(["clear", "rain", "snow"]).default("clear"),
  event: z.enum(["none", "exam_week", "home_game", "move_in"]).default("none"),
  runs: z.number().int().min(1).max(100).default(20),
  seed: z.number().int().optional(),
});
export type Scenario = z.infer<typeof Scenario>;

/* ───────────── 2. Prediction ───────────── */

export const Band = z.object({ p10: z.number(), p50: z.number(), p90: z.number() });

export const ObjectionCode = z.enum([
  "too_expensive", "fee_too_high", "too_far", "no_diet_option",
  "wrong_cuisine", "closed_when_hungry", "unknown_new_place",
]);

export const Prediction = z.object({
  conceptId: z.string(),
  conceptVersion: z.number().int(),
  scenario: Scenario,
  orders: Band,              // whole day
  revenue: Band,             // whole day, USD, after promos, before fees
  avgTicket: z.number(),
  marketSharePct: z.number(), // share of all delivery orders in the sim area that day
  byHour: z.array(Band.extend({ hour: z.number().int().min(0).max(23) })),
  bySegment: z.array(z.object({ segment: Segment, orders: z.number(), sharePct: z.number() })),
  stolenFrom: z.array(z.object({
    placeId: z.string(), name: z.string(), lat: z.number(), lon: z.number(),
    ordersLost: z.number(),
  })),
  objections: z.array(z.object({
    code: ObjectionCode,
    label: z.string(),        // plain words, e.g. "too far from Forbes"
    pct: z.number(),          // % of residents who considered it and said no for this reason
    segment: Segment.optional(),
  })),
  /** sample of individual orders for the map animation, at most 600 */
  orderFlows: z.array(z.object({
    residentId: z.string(),
    from: LatLon,             // resident home
    hour: z.number().int(),
    minute: z.number().int(),
    restaurant: z.enum(["concept", "other"]),
    placeId: z.string().optional(),
  })),
  sampleResidentIds: z.array(z.string()),
  calibration: z.object({
    heldOutCorrelation: z.number().nullable(),
    note: z.string(),
  }),
  computedMs: z.number(),
});
export type Prediction = z.infer<typeof Prediction>;

/* ───────────── city ───────────── */

export const Restaurant = z.object({
  placeId: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  cuisine: z.array(z.string()),
  category: z.string().nullable(),
  rating: z.number().nullable(),
  reviews: z.number().nullable(),
  priceTier: z.number().nullable(),
  /** popularTimes[day][hour] = Google relative busyness 0-100, null if unknown */
  popularTimes: z.record(Day, z.record(z.string(), z.number())).nullable(),
});
export type Restaurant = z.infer<typeof Restaurant>;

export const Resident = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().int(),
  segment: Segment,
  household: z.enum(["alone", "roommates", "partner", "family_with_kids"]),
  incomeBand: z.enum(["<25k", "25-50k", "50-100k", "100k+"]),
  tractId: z.string(),
  home: LatLon,
  diet: z.array(DietTag),
  budgetPerMeal: z.number(),
  /** utility weights. Sim uses these. LLM only seeds them once. */
  weights: z.object({
    price: z.number(),      // negative: per $ over budget
    time: z.number(),       // negative: per minute of delivery
    rating: z.number(),     // positive: per star above 4.0
    habit: z.number(),      // positive: bonus for favorites
    novelty: z.number(),    // positive or negative: appetite for new places
    cuisine: z.record(z.string(), z.number()),
  }),
  ordersPerWeek: z.number(),
  favorites: z.array(z.string()), // placeIds
  persona: z.string(),              // 1-2 sentences, flavor only
});
export type Resident = z.infer<typeof Resident>;

export const InterviewAnswer = z.object({
  residentId: z.string(),
  answer: z.string(),
  wouldOrderFromConcept: z.boolean(),
  choseInstead: z.string().nullable(),
  /** the actual utility terms behind the decision. The answer must be faithful to these. */
  breakdown: z.array(z.object({ factor: z.string(), value: z.number() })),
});

/* ───────────── API surface ─────────────
 * All under /api. Server is Bun + Hono on :8787. Web is Vite on :5173 (proxy /api).
 *
 * POST /api/agent/chat         body { messages, concept }        -> SSE AgentEvent stream   (Lane A)
 * POST /api/generate/dish      body { concept, itemId }           -> { imageUrl }            (Lane B)
 * POST /api/generate/logo      body { concept }                   -> { logoUrl }             (Lane B)
 * POST /api/generate/menu-card body { concept }                   -> { imageUrl }            (Lane B, optional)
 * GET  /api/city/restaurants                                      -> Restaurant[]           (Lane C)
 * GET  /api/city/residents?sample=N                               -> Resident[]             (Lane C)
 * POST /api/simulate           body { concept, scenario }         -> Prediction             (Lane D)
 * POST /api/residents/:id/ask  body { concept, scenario, question}-> InterviewAnswer        (Wave 2)
 * POST /api/agent/optimize     body { concept, goal }             -> SSE AgentEvent stream  (Wave 2)
 *
 * Any endpoint not built yet MUST return the matching file in data/fixtures/.
 */

export const AgentEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("thinking"), label: z.string(), detail: z.string().optional() }),
  z.object({ type: z.literal("edits"), edits: z.array(ConceptEdit), needsApproval: z.boolean() }),
  z.object({ type: z.literal("concept"), concept: Concept }),
  z.object({ type: z.literal("generating"), target: z.string() }), // "logo" | itemId
  z.object({ type: z.literal("generated"), target: z.string(), url: z.string() }),
  z.object({ type: z.literal("simulating"), scenario: Scenario }),
  z.object({ type: z.literal("prediction"), prediction: Prediction }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

/* ───────────── request / response bodies (added by scaffold) ─────────────
 * Additive only. One schema per endpoint body so web and server validate the same shape.
 */

export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const AgentChatRequest = z.object({
  messages: z.array(ChatMessage),
  concept: Concept.nullable(),
  /** Lane A: the scenario the right pane shows, so the agent simulates the same day. */
  scenario: Scenario.optional(),
  /** Lane A: the latest prediction for `concept`, so the agent can cite objections. */
  prediction: Prediction.nullable().optional(),
  /** Lane A: edits the owner accepted or made by hand. Code applies them, no model call. */
  apply: z.array(ConceptEdit).optional(),
});
export type AgentChatRequest = z.infer<typeof AgentChatRequest>;

export const OptimizeGoal = z.object({
  metric: z.enum(["orders", "revenue"]),
  target: z.number(),
  scenario: Scenario,
});
export type OptimizeGoal = z.infer<typeof OptimizeGoal>;

export const AgentOptimizeRequest = z.object({ concept: Concept, goal: OptimizeGoal });
export type AgentOptimizeRequest = z.infer<typeof AgentOptimizeRequest>;

export const GenerateDishRequest = z.object({ concept: Concept, itemId: z.string() });
export type GenerateDishRequest = z.infer<typeof GenerateDishRequest>;
/** null = not generated (generation off or failed). The UI shows the fallback card. */
export const GenerateDishResponse = z.object({ imageUrl: z.string().nullable() });
export type GenerateDishResponse = z.infer<typeof GenerateDishResponse>;

export const GenerateLogoRequest = z.object({ concept: Concept });
export type GenerateLogoRequest = z.infer<typeof GenerateLogoRequest>;
export const GenerateLogoResponse = z.object({ logoUrl: z.string().nullable() });
export type GenerateLogoResponse = z.infer<typeof GenerateLogoResponse>;

export const GenerateMenuCardRequest = z.object({ concept: Concept });
export type GenerateMenuCardRequest = z.infer<typeof GenerateMenuCardRequest>;
export const GenerateMenuCardResponse = z.object({ imageUrl: z.string().nullable() });
export type GenerateMenuCardResponse = z.infer<typeof GenerateMenuCardResponse>;

export const SimulateRequest = z.object({ concept: Concept, scenario: Scenario });
export type SimulateRequest = z.infer<typeof SimulateRequest>;

export const AskResidentRequest = z.object({
  concept: Concept,
  scenario: Scenario,
  question: z.string(),
});
export type AskResidentRequest = z.infer<typeof AskResidentRequest>;
export type InterviewAnswer = z.infer<typeof InterviewAnswer>;
