import path from "node:path";
import type { z } from "zod";

/** Repo root, resolved from this file so it works from any cwd. */
export const ROOT = path.resolve(import.meta.dir, "../..");
export const FIXTURES_DIR = path.join(ROOT, "data/fixtures");
export const GENERATED_DIR = path.join(ROOT, "data/generated");

/** MOCK=1 forces every endpoint to serve its fixture. */
export const isMock = () => process.env.MOCK === "1";

const cache = new Map<string, unknown>();

/** Read data/fixtures/<name>.json, validate it with the schema, cache it. */
export async function fixture<S extends z.ZodType>(name: string, schema: S): Promise<z.infer<S>> {
  if (!cache.has(name)) {
    const raw = await Bun.file(path.join(FIXTURES_DIR, `${name}.json`)).json();
    cache.set(name, schema.parse(raw));
  }
  return structuredClone(cache.get(name)) as z.infer<S>;
}
