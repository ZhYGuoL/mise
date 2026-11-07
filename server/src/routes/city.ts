import { Hono } from "hono";
import { Resident, Restaurant } from "@mise/shared";
import { z } from "zod";
import { fixture } from "../fixtures";

/** Lane D owns this file. Scaffold: serves the fixtures. */
export const city = new Hono();

city.get("/restaurants", async (c) => {
  return c.json(await fixture("restaurants", z.array(Restaurant)));
});

city.get("/residents", async (c) => {
  const residents = await fixture("residents.sample", z.array(Resident));
  const sample = Number(c.req.query("sample") ?? residents.length);
  return c.json(residents.slice(0, Number.isFinite(sample) ? Math.max(0, sample) : residents.length));
});
