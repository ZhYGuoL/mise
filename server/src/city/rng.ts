/** Small seeded random tools. Same seed, same city, same simulation. */

/** 32-bit string hash (FNV-1a). */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x7c; // separator so ("ab","c") != ("a","bc")
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: fast seeded uniform in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic uniform in [0, 1) from a key. Use for fixed per-entity traits. */
export function unit(...parts: (string | number)[]): number {
  return rng(hash(...parts))();
}

/** Standard normal from two uniforms (Box-Muller). */
export function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Poisson sample (Knuth). Fine for small lambda. */
export function poisson(rand: () => number, lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = rand();
  while (p > limit) {
    k++;
    p *= rand();
  }
  return k;
}

/** Pick an index from non-negative weights with one uniform. */
export function pickIndex(weights: ArrayLike<number>, u: number): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i]!;
  let target = u * total;
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i]!;
    if (target < 0) return i;
  }
  return weights.length - 1;
}

export function pick<T>(items: readonly T[], u: number): T {
  return items[Math.min(items.length - 1, Math.floor(u * items.length))]!;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits;
