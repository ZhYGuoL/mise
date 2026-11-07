import {
  type AgentChatRequest,
  type AgentEvent,
  type Concept,
  type ConceptEdit,
  Day,
  OptimizeGoal,
  type Prediction,
  Scenario,
} from "@mise/shared";
import { complete, type Message, type ToolCall, type ToolChoice } from "./openrouter";
import { applyEdits, imageTargets, needsApproval } from "./patch";
import { summarizePrediction, systemPrompt } from "./prompt";
import { generate, simulate } from "./services";
import { matchQuery } from "../import/match";
import { loadPlaces, toImportPlace } from "../import/places";
import {
  buildConcept,
  createConceptTool,
  editConceptTool,
  generateImagesTool,
  importRestaurantTool,
  runOptimizeTool,
  simulateTool,
} from "./tools";

export type Send = (e: AgentEvent) => Promise<void>;

const DEFAULT_SCENARIO: Scenario = { day: "Friday", weather: "clear", event: "none", runs: 20 };
const MAX_STEPS = 6;
const MAX_REJECTS = 3;

const TOOL_LABEL: Record<string, string> = {
  create_concept: "Drafting the concept",
  edit_concept: "Writing edits",
  generate_images: "Queueing photos",
  run_optimize: "Setting the goal",
  import_restaurant: "Finding the restaurant",
};

type State = {
  created: boolean;
  edited: boolean;
  rejects: number;
  nudged: boolean;
  optimizing: boolean;
  /** Lane H: import_restaurant ran this turn. A miss must not be nudged into create_concept. */
  importTried: boolean;
  /** Lane H: a real restaurant matched. The client runs the import, so the turn ends here. */
  importing: boolean;
};

/** One request to /api/agent/chat. Holds the working concept and prediction while the turn runs. */
class Turn {
  concept: Concept | null;
  prediction: Prediction | null;
  scenario: Scenario;
  private images: Promise<void>[] = [];

  constructor(
    req: AgentChatRequest,
    private send: Send,
    private signal: AbortSignal,
  ) {
    this.concept = req.concept;
    this.prediction = req.prediction ?? null;
    this.scenario = req.scenario ?? DEFAULT_SCENARIO;
  }

  async simulate(scenario = this.scenario) {
    if (!this.concept) throw new Error("no concept to simulate");
    await this.send({ type: "simulating", scenario });
    const p = await simulate(this.concept, scenario, this.signal);
    this.prediction = p;
    this.scenario = scenario;
    await this.send({ type: "prediction", prediction: p });
    return p;
  }

  /** Photos run in the background. The turn can finish while they are still on their way. */
  startImages(targets: string[]) {
    const concept = this.concept;
    if (!concept) return;
    for (const target of targets) {
      this.images.push(
        (async () => {
          await this.send({ type: "generating", target });
          const url = await generate(concept, target, this.signal);
          if (!url) return;
          if (this.concept && target === "logo") this.concept.brand.logoUrl = url;
          const item = this.concept?.menu.find((m) => m.id === target);
          if (item) item.imageUrl = url;
          await this.send({ type: "generated", target, url });
        })().catch(() => {}),
      );
    }
  }

  settleImages() {
    return Promise.allSettled(this.images);
  }

  /** Owner-approved or hand-made edits. Code applies them, then the city re-runs. */
  async applyOwnerEdits(edits: ConceptEdit[]) {
    if (!this.concept) throw new Error("there is no concept to edit");
    const before = this.concept;
    const res = applyEdits(before, edits);
    if (!res.ok) throw new Error(res.error);
    this.concept = res.concept;
    await this.send({ type: "concept", concept: res.concept });
    this.startImages(imageTargets(before, res.concept));
    await this.simulate();
  }

  async agent(history: AgentChatRequest["messages"]) {
    const messages: Message[] = [{ role: "system", content: systemPrompt(this.concept, this.prediction) }, ...cleanHistory(history)];
    const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
    await this.send({ type: "thinking", label: "Reading the request", detail: lastUser.slice(0, 140) });

    const state: State = { created: false, edited: false, rejects: 0, nudged: false, optimizing: false, importTried: false, importing: false };
    let namesShown = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      const finished = state.created || state.edited;
      const tools = this.concept
        ? [editConceptTool, generateImagesTool, simulateTool, runOptimizeTool, importRestaurantTool]
        : [createConceptTool, importRestaurantTool];
      // Some models (Claude Sonnet 5.5) reject a forced tool_choice. Offer only create_concept and nudge once instead.
      const toolChoice: ToolChoice = this.concept && finished ? "none" : "auto";

      const res = await complete({
        messages,
        tools,
        toolChoice,
        signal: this.signal,
        onText: (delta) => this.send({ type: "text", delta }),
        onToolStart: async (name) => {
          const label = TOOL_LABEL[name];
          if (label) await this.send({ type: "thinking", label });
        },
        // While the concept streams in, show the name and each dish as soon as it is written.
        onToolArgs: async (name, partial) => {
          if (name !== "create_concept") return;
          const names = [...partial.matchAll(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
          for (; namesShown < names.length; namesShown++) {
            const n = names[namesShown].replace(/\\"/g, '"');
            await this.send({ type: "thinking", label: n, detail: namesShown === 0 ? "name" : "dish" });
          }
        },
      });
      if (res.toolCalls.length === 0) {
        if (!this.concept && !state.nudged && !state.importTried) {
          state.nudged = true;
          messages.push({ role: "assistant", content: res.content || "(no reply)" });
          messages.push({ role: "user", content: "Call create_concept now with the complete concept." });
          continue;
        }
        break;
      }

      messages.push({ role: "assistant", content: res.content || null, tool_calls: res.toolCalls });
      for (const call of res.toolCalls) {
        const result = await this.handle(call, state).catch((err) => `Failed: ${err instanceof Error ? err.message : err}`);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
      // The optimize run takes over the turn in the client. No closing reply, so the rounds start at once.
      if (state.optimizing) break;
      // Lane H: the client imports the restaurant (after a yes, if it replaces a concept), then asks the rest.
      if (state.importing) break;
    }
  }

  private async handle(call: ToolCall, state: State): Promise<string> {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      return "Rejected: the arguments are not valid JSON. Call the tool again.";
    }

    switch (call.function.name) {
      case "create_concept": {
        if (this.concept) return "A concept already exists. Use edit_concept.";
        const built = buildConcept(args);
        if (!built.ok) {
          state.rejects++;
          return `Rejected, nothing was created: ${built.error}. Fix it and call create_concept again.`;
        }
        this.concept = built.concept;
        state.created = true;
        await this.send({ type: "concept", concept: built.concept });
        this.startImages(imageTargets(null, built.concept));
        const p = await this.simulate();
        return `Created v1 "${built.concept.name}" at ${built.concept.location.address}.\nPrediction:\n${summarizePrediction(p)}\nNow reply to the owner in at most two short sentences, under 40 words.`;
      }

      case "edit_concept": {
        if (!this.concept) return "There is no concept yet. Call create_concept.";
        if (state.edited) return "You already changed the concept this turn. Reply to the owner.";
        const edits = Array.isArray(args.edits) ? (args.edits as ConceptEdit[]) : [];
        const res = applyEdits(this.concept, edits);
        if (!res.ok) {
          state.rejects++;
          if (state.rejects >= MAX_REJECTS) state.edited = true;
          return `Rejected, nothing changed: ${res.error}`;
        }
        state.edited = true;
        if (needsApproval(res.edits)) {
          await this.send({ type: "edits", edits: res.edits, needsApproval: true });
          return "The owner now sees an approval card with these edits. Reply in one sentence under 30 words: what you propose and the prediction number behind it. Do not mention approval, waiting or re-running the prediction.";
        }
        const before = this.concept;
        const prevP50 = this.prediction?.orders.p50;
        await this.send({ type: "edits", edits: res.edits, needsApproval: false });
        this.concept = res.concept;
        await this.send({ type: "concept", concept: res.concept });
        this.startImages(imageTargets(before, res.concept));
        const p = await this.simulate();
        const delta = prevP50 === undefined ? "" : `\nChange in p50 orders: ${Math.round(p.orders.p50 - prevP50)}.`;
        return `Applied as v${res.concept.version}.\nNew prediction:\n${summarizePrediction(p)}${delta}\nNow reply to the owner in at most two short sentences, under 40 words.`;
      }

      case "generate_images": {
        if (!this.concept) return "There is no concept yet.";
        const valid = new Set(["logo", ...this.concept.menu.map((m) => m.id)]);
        const targets = (Array.isArray(args.targets) ? args.targets : []).filter((t): t is string => valid.has(t as string));
        if (!targets.length) return `No valid targets. Use "logo" or one of: ${[...valid].join(", ")}.`;
        this.startImages(targets);
        return `Started photos for ${targets.join(", ")}. They appear on the menu when ready.`;
      }

      case "simulate": {
        if (!this.concept) return "There is no concept yet.";
        const scenario = Scenario.safeParse({ ...this.scenario, ...args, runs: this.scenario.runs });
        if (!scenario.success) return `Rejected: ${scenario.error.issues.map((x) => x.message).join("; ")}`;
        const p = await this.simulate(scenario.data);
        return `Prediction:\n${summarizePrediction(p)}`;
      }

      case "import_restaurant": {
        if (state.created || state.edited || state.optimizing || state.importing)
          return "You already changed the concept this turn. Reply to the owner.";
        state.importTried = true;
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return "Rejected: query is the restaurant name or Maps link the owner gave.";
        const match = await matchQuery(query, await loadPlaces());
        if (!match.ok) {
          const close = match.suggestions.map((p) => `${p.restaurant.name} (${[p.facts.street, p.facts.neighborhood].filter(Boolean).join(", ")})`);
          if (close.length > 1 && match.error.includes("Pick one"))
            return `${match.error.replace(" Pick one.", "")} Ask the owner which one: ${close.join("; ")}. Do not call create_concept.`;
          return `${match.error}${close.length ? ` Close names in the city: ${close.join("; ")}.` : ""} Tell the owner in one short sentence that it is not in the simulated city. Never invent it, and do not call create_concept unless the owner asks for a new concept.`;
        }
        const place = match.place.restaurant;
        if (this.concept?.existing?.placeId === place.placeId)
          return `${place.name} is already the current concept. Answer the owner on it with the other tools.`;
        state.importing = true;
        const question = typeof args.question === "string" && args.question.trim() ? args.question.trim() : undefined;
        await this.send({ type: "import", place: toImportPlace(match.place), needsApproval: !!this.concept, question });
        return "The import started.";
      }

      case "run_optimize": {
        if (!this.concept) return "There is no concept yet. Call create_concept.";
        if (state.edited || state.optimizing) return "You already changed the concept this turn. Reply to the owner.";
        const day = Day.safeParse(args.day);
        const goal = OptimizeGoal.safeParse({
          metric: args.metric,
          target: Number(args.target),
          scenario: { ...this.scenario, day: day.success ? day.data : this.scenario.day },
        });
        if (!goal.success || !(goal.data.target > 0)) {
          state.rejects++;
          return `Rejected: metric must be "orders" or "revenue" and target a positive number. ${goal.error?.issues.map((x) => x.message).join("; ") ?? ""}`;
        }
        state.optimizing = true;
        await this.send({ type: "optimize", goal: goal.data });
        return "The optimize run started.";
      }

      default:
        return `Unknown tool ${call.function.name}.`;
    }
  }
}

/** Merge same-role neighbours and drop empty turns, so every provider accepts the history. */
function cleanHistory(history: AgentChatRequest["messages"]): Message[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of history) {
    const content = m.content.trim();
    if (!content) continue;
    const last = out.at(-1);
    if (last?.role === m.role) last.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out[0]?.role === "assistant") out.shift();
  return out;
}

export async function runChat(req: AgentChatRequest, send: Send, signal: AbortSignal) {
  const turn = new Turn(req, send, signal);
  try {
    if (req.apply?.length) await turn.applyOwnerEdits(req.apply);
    else await turn.agent(req.messages);
  } catch (err) {
    if (signal.aborted) return;
    await send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
  await send({ type: "done" });
  await turn.settleImages();
}
