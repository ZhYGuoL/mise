/**
 * Image models follow color names better than hex codes, so prompts give both:
 * "tomato red (#E4472B)". The name is the nearest entry in this list, by distance in CIE Lab.
 */
const NAMED: [string, string][] = [
  ["pure white", "#FFFFFF"],
  ["warm cream", "#FFF8F0"],
  ["ivory", "#FFFFF0"],
  ["bone", "#E9E4D8"],
  ["sand beige", "#E2CFAE"],
  ["kraft tan", "#C8A97E"],
  ["light gray", "#D9D9D9"],
  ["warm gray", "#9E958C"],
  ["slate gray", "#5E6770"],
  ["charcoal", "#36383B"],
  ["near black", "#1A1A1A"],
  ["espresso brown", "#3B2A20"],
  ["chocolate brown", "#5C3A21"],
  ["caramel", "#B5722F"],
  ["mustard yellow", "#D9A521"],
  ["butter yellow", "#F6E27F"],
  ["lemon yellow", "#F4E04D"],
  ["tangerine orange", "#F28C28"],
  ["burnt orange", "#C55A11"],
  ["coral", "#F27E63"],
  ["tomato red", "#E4472B"],
  ["fire-engine red", "#D7261E"],
  ["cherry red", "#B0102C"],
  ["burgundy", "#6E1E2B"],
  ["blush pink", "#F4C7C3"],
  ["hot pink", "#E8457C"],
  ["plum", "#6B2D5C"],
  ["lavender", "#B9A7D6"],
  ["violet", "#6B4BA8"],
  ["navy blue", "#1F2D52"],
  ["cobalt blue", "#2453B8"],
  ["sky blue", "#8EC3EB"],
  ["teal", "#1F7A7A"],
  ["mint green", "#B6E2C8"],
  ["sage green", "#9CAF88"],
  ["olive green", "#6B6B2A"],
  ["kelly green", "#2E9E4F"],
  ["forest green", "#1F4D33"],
];

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const NAMED_LAB = NAMED.map(([name, hex]) => [name, rgbToLab(hexToRgb(hex)!)] as const);

/** "tomato red (#E4472B)". An unreadable value comes back as given. */
export function describeColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const lab = rgbToLab(rgb);
  let best = NAMED_LAB[0];
  let bestD = Infinity;
  for (const entry of NAMED_LAB) {
    const d = (entry[1][0] - lab[0]) ** 2 + (entry[1][1] - lab[1]) ** 2 + (entry[1][2] - lab[2]) ** 2;
    if (d < bestD) [best, bestD] = [entry, d];
  }
  return `${best[0]} (${hex.toUpperCase()})`;
}
