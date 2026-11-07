import { Hono } from "hono";
import { Prediction, SimulateRequest } from "@mise/shared";
import { fixture } from "../fixtures";
import { body } from "../validate";

/** Lane D owns this file. Scaffold: the fixture prediction, stamped with the request's concept and scenario. */
export const simulate = new Hono();

simulate.post("/", async (c) => {
  const { concept, scenario } = await body(c, SimulateRequest);
  const prediction = await fixture("prediction", Prediction);
  return c.json(
    Prediction.parse({ ...prediction, conceptId: concept.id, conceptVersion: concept.version, scenario }),
  );
});
