import { Hono } from "hono";
import { Prediction, SimulateRequest } from "@mise/shared";
import { fixture, isMock } from "../fixtures";
import { body } from "../validate";
import { simulate as runSimulation } from "../sim/simulate";
import { loadStatic } from "../sim/static";

/** Lane D. POST /api/simulate {concept, scenario} -> Prediction. */
export const simulate = new Hono();

// Build distances and utilities at boot, so the first demo click is fast.
if (!isMock()) void loadStatic().catch((err) => console.error("[sim] city failed to load", err));

async function fromFixture(concept: SimulateRequest["concept"], scenario: SimulateRequest["scenario"], note: string) {
  const prediction = await fixture("prediction", Prediction);
  return Prediction.parse({
    ...prediction,
    conceptId: concept.id,
    conceptVersion: concept.version,
    scenario,
    calibration: { heldOutCorrelation: null, note },
  });
}

simulate.post("/", async (c) => {
  const { concept, scenario } = await body(c, SimulateRequest);
  if (isMock()) return c.json(await fromFixture(concept, scenario, "fixture data, not a real simulation"));
  try {
    return c.json(Prediction.parse(await runSimulation(concept, scenario)));
  } catch (err) {
    // The demo must not break. Say loudly that this is the fixture.
    console.error("[sim] simulation failed, serving the fixture", err);
    return c.json(await fromFixture(concept, scenario, "simulation failed, fixture data"));
  }
});
