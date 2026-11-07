import { Concept, Day, DietTag } from "@mise/shared";
import type { ToolDef } from "./openrouter";
import { SITES, siteById, toLocation } from "./sites";

const hm = { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" };
const dayHours = {
  anyOf: [{ type: "object", properties: { open: hm, close: hm }, required: ["open", "close"] }, { type: "null" }],
};

const dish = {
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string", description: "one sentence" },
    price: { type: "number" },
    category: { type: "string", enum: ["main", "side", "drink", "dessert", "combo"] },
    tags: { type: "array", items: { type: "string", enum: DietTag.options } },
    imagePrompt: { type: "string" },
  },
  required: ["name", "description", "price", "category", "tags", "imagePrompt"],
};

export const createConceptTool: ToolDef = {
  type: "function",
  function: {
    name: "create_concept",
    description: "Create the first version of the restaurant concept from the owner's idea.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        tagline: { type: "string", description: "under 60 characters" },
        cuisine: { type: "array", items: { type: "string" }, minItems: 1 },
        siteId: { type: "string", enum: SITES.map((s) => s.id) },
        hours: { type: "object", properties: Object.fromEntries(Day.options.map((d) => [d, dayHours])), required: Day.options },
        priceTier: { type: "integer", enum: [1, 2, 3, 4] },
        deliveryFee: { type: "number" },
        serviceFeePct: { type: "number" },
        menu: { type: "array", items: dish, minItems: 5, maxItems: 8 },
        brand: {
          type: "object",
          properties: {
            colors: {
              type: "object",
              properties: { primary: { type: "string" }, background: { type: "string" }, ink: { type: "string" } },
              required: ["primary", "background", "ink"],
            },
            voice: { type: "string" },
            logoPrompt: { type: "string" },
          },
          required: ["colors", "voice", "logoPrompt"],
        },
        promos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              discountPct: { type: "number" },
              days: { type: "array", items: { type: "string", enum: Day.options } },
              hours: { type: "array", items: hm, minItems: 2, maxItems: 2 },
            },
            required: ["description"],
          },
        },
      },
      required: ["name", "tagline", "cuisine", "siteId", "hours", "priceTier", "deliveryFee", "serviceFeePct", "menu", "brand"],
    },
  },
};

export const editConceptTool: ToolDef = {
  type: "function",
  function: {
    name: "edit_concept",
    description: "Change the current concept with JSON Patch ops. Code validates and versions them.",
    parameters: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["add", "remove", "replace"] },
              path: { type: "string" },
              value: {},
              reason: { type: "string" },
            },
            required: ["op", "path", "reason"],
          },
        },
      },
      required: ["edits"],
    },
  },
};

export const generateImagesTool: ToolDef = {
  type: "function",
  function: {
    name: "generate_images",
    description: 'Make new photos. Targets are "logo" or menu item ids like "m3".',
    parameters: {
      type: "object",
      properties: { targets: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["targets"],
    },
  },
};

export const simulateTool: ToolDef = {
  type: "function",
  function: {
    name: "simulate",
    description: "Run the simulated city for the current concept on another day, weather or event.",
    parameters: {
      type: "object",
      properties: {
        day: { type: "string", enum: Day.options },
        weather: { type: "string", enum: ["clear", "rain", "snow"] },
        event: { type: "string", enum: ["none", "exam_week", "home_game", "move_in"] },
      },
      required: ["day"],
    },
  },
};

export const runOptimizeTool: ToolDef = {
  type: "function",
  function: {
    name: "run_optimize",
    description:
      "Start the optimize loop: it tries edit sets against the simulated city, round by round, until the number reaches the target, then shows the owner one set to approve. Use it when the owner asks to reach or raise orders or revenue.",
    parameters: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["orders", "revenue"] },
        target: {
          type: "number",
          description: "Daily p50 to reach: orders per day, or revenue in USD. If the owner names no number, use about 1.3 times the current p50.",
        },
        day: { type: "string", enum: Day.options, description: "The day the owner named. Leave it out to use the day the owner is looking at." },
      },
      required: ["metric", "target"],
    },
  },
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "concept";

/** create_concept arguments -> a validated v1 Concept. Code fills ids, version, location and image slots. */
export function buildConcept(args: unknown): { ok: true; concept: Concept } | { ok: false; error: string } {
  const a = (args ?? {}) as Record<string, unknown>;
  const site = typeof a.siteId === "string" ? siteById(a.siteId) : undefined;
  if (!site) return { ok: false, error: `siteId must be one of: ${SITES.map((s) => s.id).join(", ")}` };
  const brand = (a.brand ?? {}) as Record<string, unknown>;
  const menu = Array.isArray(a.menu) ? a.menu : [];
  const promos = Array.isArray(a.promos) ? a.promos : [];
  const draft = {
    id: `${slug(String(a.name ?? ""))}-${Math.random().toString(36).slice(2, 6)}`,
    version: 1,
    name: a.name,
    tagline: a.tagline,
    cuisine: a.cuisine,
    location: toLocation(site),
    hours: a.hours,
    priceTier: a.priceTier,
    deliveryFee: a.deliveryFee,
    serviceFeePct: a.serviceFeePct,
    menu: menu.map((m, i) => ({ tags: [], ...(m as object), id: `m${i + 1}`, imageUrl: null })),
    brand: { ...brand, logoUrl: null },
    promos: promos.map((p, i) => ({ ...(p as object), id: `p${i + 1}` })),
  };
  const parsed = Concept.safeParse(draft);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((x) => `/${x.path.join("/")}: ${x.message}`).join("; ");
    return { ok: false, error: `not a valid concept: ${issues}` };
  }
  return { ok: true, concept: parsed.data };
}
