/**
 * Lane B: dish photos and the logo.
 *
 * Files: data/generated/<conceptId>/<target>-<hash>.<ext>, served at /generated/<conceptId>/<file>.
 * The hash covers model, aspect ratio, prompt and take, so the same prompt never generates twice.
 * A take is one attempt at a prompt. "Regenerate" makes take n+1, and takes.json remembers
 * which take is current, so a reload shows the latest one.
 *
 * Lane A's agent can import generateDish / generateLogo / generateTargets directly.
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Concept, GenerateStatus } from "@mise/shared";
import { HTTPException } from "hono/http-exception";
import { GENERATED_DIR, isMock } from "../fixtures";
import { type AspectRatio, generateImage, ImageError } from "./openrouter";
import { dishPrompt, logoPrompt } from "./prompts";

export type GenerateResult = { url: string | null; status: GenerateStatus; ms: number; error?: string };

const MAX_PARALLEL = 4;
const TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS || 35_000);
/** A failure faster than this is likely transient (429, 5xx, empty reply), so it gets one retry. */
const RETRY_IF_FAILED_WITHIN_MS = 12_000;
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/* ───────────── concurrency: max 4 OpenRouter calls at once, FIFO ───────────── */

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active < MAX_PARALLEL) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve)); // the finishing call hands its slot over
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

/* ───────────── takes.json: which take of each prompt is current ───────────── */

const takes = new Map<string, Record<string, number>>();

async function readTakes(dir: string): Promise<Record<string, number>> {
  if (!takes.has(dir)) {
    const file = Bun.file(path.join(dir, "takes.json"));
    takes.set(dir, (await file.exists()) ? await file.json().catch(() => ({})) : {});
  }
  return takes.get(dir)!;
}

async function writeTake(dir: string, baseHash: string, take: number) {
  const map = await readTakes(dir);
  map[baseHash] = take;
  await Bun.write(path.join(dir, "takes.json"), JSON.stringify(map, null, 2));
}

/* ───────────── core ───────────── */

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "x";
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

async function findFile(dir: string, stem: string): Promise<string | null> {
  for (const ext of Object.values(EXTENSIONS)) {
    const file = path.join(dir, `${stem}.${ext}`);
    if (await Bun.file(file).exists()) return file;
  }
  return null;
}

/** The hash covers the whole prompt, so a file with the same hash in another concept's folder is the same image. */
async function findAnywhere(hash: string): Promise<string | null> {
  const glob = new Bun.Glob(`*/*-${hash}.{${Object.values(EXTENSIONS).join(",")}}`);
  for await (const rel of glob.scan({ cwd: GENERATED_DIR, onlyFiles: true })) return path.join(GENERATED_DIR, rel);
  return null;
}

const urlFor = (file: string) => `/generated/${path.relative(GENERATED_DIR, file).split(path.sep).join("/")}`;

const inflight = new Map<string, Promise<GenerateResult>>();

type Job = {
  conceptId: string;
  target: string; // "logo" or a MenuItem id
  prompt: string;
  aspectRatio: AspectRatio;
  model: string | undefined;
  regenerate: boolean;
};

async function run(job: Job): Promise<GenerateResult> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  if (!job.model) return { url: null, status: "off", ms: ms() };

  const dir = path.join(GENERATED_DIR, safe(job.conceptId));
  const target = safe(job.target);
  const baseHash = sha([job.model, job.aspectRatio, job.prompt].join("\n"));
  const hashFor = (take: number) => (take === 0 ? baseHash : sha(`${baseHash}#${take}`));
  const stemFor = (take: number) => `${target}-${hashFor(take)}`;

  const current = (await readTakes(dir))[baseHash] ?? 0;
  const currentFile = (await findFile(dir, stemFor(current))) ?? (current === 0 ? await findAnywhere(baseHash) : null);
  if (currentFile && !job.regenerate) return { url: urlFor(currentFile), status: "cached", ms: ms() };

  const off = isMock() || !process.env.OPENROUTER_API_KEY;
  if (off) return { url: currentFile ? urlFor(currentFile) : null, status: "off", ms: ms() };

  const take = currentFile ? current + 1 : current;
  const stem = stemFor(take);
  const key = path.join(dir, stem);
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async (): Promise<GenerateResult> => {
    try {
      const image = await withSlot(async () => {
        const attempt = () =>
          generateImage({ model: job.model!, prompt: job.prompt, aspectRatio: job.aspectRatio, timeoutMs: TIMEOUT_MS });
        const t0 = performance.now();
        try {
          return await attempt();
        } catch (err) {
          if (err instanceof ImageError && err.permanent) throw err;
          if (performance.now() - t0 > RETRY_IF_FAILED_WITHIN_MS) throw err;
          console.warn(`[generate] ${job.conceptId}/${job.target} retry after: ${(err as Error).message}`);
          return await attempt();
        }
      });
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${stem}.${EXTENSIONS[image.mime] ?? "png"}`);
      await Bun.write(file, image.bytes);
      await writeTake(dir, baseHash, take);
      const cost = image.costUsd === null ? "" : ` $${image.costUsd.toFixed(4)}`;
      console.log(
        `[generate] ${job.conceptId}/${job.target} ${job.model} ${ms()}ms ${Math.round(image.bytes.length / 1024)}KB${cost}`,
      );
      return { url: urlFor(file), status: "generated", ms: ms() };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[generate] ${job.conceptId}/${job.target} failed after ${ms()}ms: ${error}`);
      // A failed regenerate keeps the current take on screen.
      return { url: currentFile ? urlFor(currentFile) : null, status: "failed", ms: ms(), error };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

/* ───────────── public API ───────────── */

export function generateDish(concept: Concept, itemId: string, opts: { regenerate?: boolean } = {}) {
  const item = concept.menu.find((m) => m.id === itemId);
  if (!item) throw new HTTPException(404, { message: `no menu item "${itemId}" in concept "${concept.id}"` });
  return run({
    conceptId: concept.id,
    target: item.id,
    prompt: dishPrompt(concept, item),
    aspectRatio: "4:3",
    model: process.env.MODEL_IMAGE || undefined,
    regenerate: !!opts.regenerate,
  });
}

export function generateLogo(concept: Concept, opts: { regenerate?: boolean } = {}) {
  return run({
    conceptId: concept.id,
    target: "logo",
    prompt: logoPrompt(concept),
    aspectRatio: "1:1",
    model: process.env.MODEL_IMAGE_LOGO || process.env.MODEL_IMAGE || undefined,
    regenerate: !!opts.regenerate,
  });
}

/** For the agent's generate_images tool. Targets are "logo" or MenuItem ids. All run at once, 4 at a time. */
export async function generateTargets(concept: Concept, targets: string[]): Promise<Record<string, GenerateResult>> {
  const results = await Promise.all(
    targets.map((t) =>
      Promise.resolve()
        .then(() => (t === "logo" ? generateLogo(concept) : generateDish(concept, t)))
        .catch((err): GenerateResult => ({ url: null, status: "failed", ms: 0, error: (err as Error).message })),
    ),
  );
  return Object.fromEntries(targets.map((t, i) => [t, results[i]]));
}
