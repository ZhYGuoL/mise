import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { AskResidentRequest, InterviewAnswer, type Concept, type Resident, type Scenario } from "@mise/shared";
import { fixture, isMock } from "../fixtures";
import { completeJson, fastModel } from "../optimize/llm";
import { explainResident, type ResidentDecision } from "../sim/explain";
import { loadStatic } from "../sim/static";
import { body } from "../validate";

/**
 * Wave 2. POST /api/residents/:id/ask {concept, scenario, question} -> InterviewAnswer.
 * Code recomputes the resident's utility terms and their real choice. The model only puts
 * those terms into first-person words, and code checks that the answer names the deciding reason.
 */
export const residents = new Hono();

type Code = NonNullable<ResidentDecision["reason"]>;

/** Words an answer must use when this is the deciding reason. */
const REASON_WORDS: Record<Code, RegExp> = {
  too_far: /far|long|wait|minute|min\b|time|quick|fast|close|distance/i,
  too_expensive: /price|budget|expensive|cost|\$|pricey|cheap|afford|money/i,
  fee_too_high: /fee|delivery|charge|cost/i,
  no_diet_option: /vegan|vegetarian|halal|gluten|diet|can't eat|cannot eat|nothing i can|options?/i,
  wrong_cuisine: /taste|craving|mood|feel like|felt like|want|rather|prefer|food|pizza|burger|sushi|chicken|korean/i,
  closed_when_hungry: /closed|open|hours|late|o'clock|\d ?(am|pm)/i,
  unknown_new_place: /new|never|heard|rating|stars|review|favorite|usual|trust|know|regular|go-to/i,
};

const hourText = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);

/** The term that decided it: the hard block, else the biggest term on the side that won. */
function decidingTerm(d: ResidentDecision): { factor: string; value: number } | null {
  const terms = d.breakdown.filter((t) => t.factor !== "total");
  if (d.blocked) return terms[0] ?? null;
  const sorted = [...terms].sort((a, b) => (d.wouldOrderFromConcept ? b.value - a.value : a.value - b.value));
  return sorted[0] ?? null;
}

/** The reason code that matches the deciding term, for the wording check. */
function decidingCode(d: ResidentDecision, factor: string): Code | null {
  if (d.blocked) return d.blocked;
  if (/^taste/.test(factor)) return "wrong_cuisine";
  if (/^price/.test(factor)) return "too_expensive";
  if (/^delivery fees/.test(factor)) return "fee_too_high";
  if (/^delivery time/.test(factor)) return "too_far";
  if (/^new place/.test(factor)) return "unknown_new_place";
  if (/main|diet/.test(factor)) return "no_diet_option";
  return null;
}

/** Their best other option. The decision names it only when they picked it, so read it from the terms too. */
const againstOf = (d: ResidentDecision) =>
  d.choseInstead ?? d.breakdown.map((t) => /^new place vs (.+?), /.exec(t.factor)?.[1]).find(Boolean) ?? null;

function facts(res: Resident, concept: Concept, scenario: Scenario, d: ResidentDecision) {
  const deciding = decidingTerm(d);
  const against = againstOf(d);
  const terms = d.breakdown
    .filter((t) => t.factor !== "total")
    .map((t) => `  ${t.value >= 0 ? "+" : ""}${t.value.toFixed(2)}  ${t.factor}`)
    .join("\n");
  const choice = d.wouldOrderFromConcept
    ? `You ordered from ${concept.name}.`
    : d.choseInstead
      ? `You did NOT order from ${concept.name}. You ordered from ${d.choseInstead} instead.`
      : `You did NOT order from ${concept.name}, and you did not order anywhere.`;
  return {
    deciding,
    text: [
      `You are ${res.name}, ${res.age}, a ${res.segment.replace("_", " ")} living ${res.household === "alone" ? "alone" : `with ${res.household.replace(/_/g, " ")}`}.`,
      `Persona: ${res.persona}`,
      `Budget about $${Math.round(res.budgetPerMeal)} a meal.${res.diet.length ? ` Diet: ${res.diet.join(", ").replace(/_/g, "-")}.` : ""}`,
      "",
      `It is ${scenario.day}${scenario.weather !== "clear" ? `, ${scenario.weather}` : ""}, around ${hourText(d.hour)}, when you usually order delivery.`,
      choice,
      "",
      `What decided it (positive favors ${concept.name}, negative favors ${against ?? "not ordering"}, bigger means it mattered more):`,
      terms,
      d.blocked ? `${concept.name} was never an option: ${deciding?.factor}.` : "",
      deciding ? `Your main reason MUST be: ${deciding.factor}.` : "",
    ]
      .filter((l) => l !== null)
      .join("\n"),
  };
}

const SYSTEM = `You voice one simulated resident of Pittsburgh in an interview about a new delivery restaurant.
Answer the question in first person, in their voice, in 1 to 3 short sentences (max 55 words).
Use ONLY the facts given: the choice they made and the terms that decided it. Lead with the main reason you are told.
Never invent dishes, prices, events or feelings that are not in the facts. Do not quote the numbers as utilities.
You may say minutes, dollars, star ratings and restaurant names from the facts.
If the question asks what would change their mind, name the main reason as the thing that must change.
Reply with JSON only: {"answer": "..."}`;

/** No model: the deciding term in plain words. */
function templateAnswer(concept: Concept, d: ResidentDecision, deciding: { factor: string } | null, code: Code | null): string {
  const f = deciding?.factor ?? "";
  const alt = d.choseInstead ?? "nothing";
  const lead = d.wouldOrderFromConcept ? `I ordered from ${concept.name}.` : `I went with ${alt} instead.`;
  const taste = /vs (.+) at /.exec(f)?.[1];
  const time = /(\d+) min vs (\d+) min/.exec(f);
  const why: Record<Code, string> = {
    wrong_cuisine: d.wouldOrderFromConcept ? "It was what I was craving." : `I was more in the mood for ${taste ?? "something else"}.`,
    too_expensive: d.wouldOrderFromConcept ? "The price worked for me." : "It came out over my budget.",
    fee_too_high: d.wouldOrderFromConcept ? "The fees were fair." : "The delivery fees put me off.",
    too_far: time ? `Delivery would take ${time[1]} minutes, against ${time[2]}.` : "It was too far.",
    unknown_new_place: d.wouldOrderFromConcept ? "I like trying new places." : `${concept.name} is new to me, and I know ${alt}.`,
    no_diet_option: `There is ${f.replace(/^no /, "no ")}, so it was never an option.`,
    closed_when_hungry: "It was closed when I wanted to order.",
  };
  return `${lead} ${code ? why[code] : ""}`.trim();
}

residents.post("/:id/ask", async (c) => {
  const { concept, scenario, question } = await body(c, AskResidentRequest);
  const id = c.req.param("id");
  if (isMock()) {
    const answer = await fixture("interview", InterviewAnswer);
    return c.json(InterviewAnswer.parse({ ...answer, residentId: id }));
  }

  const decision = await explainResident(concept, scenario, id);
  if (!decision) throw new HTTPException(404, { message: `no resident ${id}` });
  const res = (await loadStatic()).residents.find((r) => r.id === id)!;
  const { deciding, text } = facts(res, concept, scenario, decision);
  const code = deciding ? decidingCode(decision, deciding.factor) : null;

  let answer: string | null = null;
  if (fastModel()) {
    // One retry if the answer does not name the deciding reason. Then the plain template.
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      try {
        const out = (await completeJson({
          system: SYSTEM,
          user: `${text}\n\nQuestion from the owner: "${question.slice(0, 300)}"`,
          maxTokens: 300,
          temperature: attempt === 0 ? 0.7 : 0.3,
          timeoutMs: 12_000,
          signal: c.req.raw.signal,
          tag: "interview",
        })) as { answer?: unknown };
        const a = typeof out.answer === "string" ? out.answer.trim() : "";
        if (a && (!code || REASON_WORDS[code].test(a))) answer = a;
        else console.warn(`[interview] ${id}: answer does not name "${code}", retrying: ${a.slice(0, 120)}`);
      } catch (err) {
        console.warn("[interview] model failed:", err instanceof Error ? err.message : err);
        break;
      }
    }
  }

  return c.json(
    InterviewAnswer.parse({
      residentId: id,
      answer: answer ?? templateAnswer(concept, decision, deciding, code),
      wouldOrderFromConcept: decision.wouldOrderFromConcept,
      choseInstead: decision.choseInstead,
      breakdown: decision.breakdown,
      hour: decision.hour,
      deciding: deciding?.factor,
      against: againstOf(decision),
    }),
  );
});
