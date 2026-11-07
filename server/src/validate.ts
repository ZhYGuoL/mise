import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

/** Parse the JSON body with a contract schema. Bad input is a 400 with the zod issues. */
export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => {
    throw new HTTPException(400, { message: "body is not valid JSON" });
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HTTPException(400, { message: JSON.stringify(parsed.error.issues) });
  }
  return parsed.data;
}
