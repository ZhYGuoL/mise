import { Hono } from "hono";
import { Resident, Restaurant } from "@mise/shared";
import { z } from "zod";
import { loadCity } from "../city/load";
import { fixture, isMock } from "../fixtures";

/** Lane D. The simulated city: 192 real restaurants and 10,000 generated residents. */
export const city = new Hono();

city.get("/restaurants", async (c) => {
  if (isMock()) return c.json(await fixture("restaurants", z.array(Restaurant)));
  return c.json((await loadCity()).restaurants);
});

/** ?sample=N returns the first N residents. The file is pre-shuffled, so any prefix is a fair spread of the city. */
city.get("/residents", async (c) => {
  const residents = isMock() ? await fixture("residents.sample", z.array(Resident)) : (await loadCity()).residents;
  const sample = Number(c.req.query("sample") ?? residents.length);
  return c.json(residents.slice(0, Number.isFinite(sample) ? Math.max(0, Math.floor(sample)) : residents.length));
});
