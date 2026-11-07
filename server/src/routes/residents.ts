import { Hono } from "hono";
import { AskResidentRequest, InterviewAnswer } from "@mise/shared";
import { fixture } from "../fixtures";
import { body } from "../validate";

/** Wave 2 owns this file. Scaffold: the fixture interview answer for any resident. */
export const residents = new Hono();

residents.post("/:id/ask", async (c) => {
  await body(c, AskResidentRequest);
  const answer = await fixture("interview", InterviewAnswer);
  return c.json(InterviewAnswer.parse({ ...answer, residentId: c.req.param("id") }));
});
