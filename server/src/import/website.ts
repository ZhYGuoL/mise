/**
 * Lane H. Read a restaurant's own website: the home page and up to two menu pages it links to.
 * Returns the lines that carry prices (with the lines just above them, where the dish names are),
 * so the model reads a short menu and not a whole page of navigation.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const PAGE_TIMEOUT_MS = 6000;
const MAX_HTML = 2_000_000;
/** About 2,500 tokens: enough for a full menu, cheap for MODEL_FAST. */
export const MAX_TEXT = 9000;

/** "$7", "$ 15.75", "~ $5.5", or a bare "14.00". */
const PRICE = /\$\s?\d{1,3}(?:\.\d{1,2})?|\b\d{1,3}\.\d{2}\b/g;
/** A line that ends in a bare price, "Spinach Artichoke Dip 9", or is only a price, "9". */
const TRAILING = /(?:[a-z)]\s+|^)\$?\d{1,3}(?:\.\d{1,2})?\s*$/i;

/** How many prices one line holds. */
export function pricesIn(line: string): number {
  const n = line.match(PRICE)?.length ?? 0;
  return n || (TRAILING.test(line) ? 1 : 0);
}

/** Every number in the text that could be a price, as numbers: "$5.5" and "5.50" are both 5.5. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{1,2})?)(?![\d.]*\d)/g)].map((m) => Number(m[1]));
}

export type Site = {
  /** pages read, home page first */
  pages: string[];
  title: string | null;
  description: string | null;
  /** <meta name="theme-color">, a real brand color when the site sets one */
  themeColor: string | null;
  /** price lines and their context, menu pages first */
  menuText: string;
  prices: number;
  /** the opening text of the home page, for the brand draft */
  intro: string;
};

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", rsquo: "'", lsquo: "'", ndash: "-", mdash: "-", hellip: "...", dollar: "$" };

function decode(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|p|div|li|h[1-6]|tr|td|th|section|article|header|footer|ul|ol|dt|dd)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|td|th|section|article|span|a|dt|dd)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const meta = (html: string, name: string) =>
  new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i").exec(html)?.[1] ??
  new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, "i").exec(html)?.[1] ??
  null;

async function fetchHtml(url: string): Promise<{ url: string; html: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    return { url: res.url || url, html: (await res.text()).slice(0, MAX_HTML) };
  } catch {
    return null;
  }
}

const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
const ASSET = /\.(css|js|png|jpe?g|gif|svg|webp|ico|xml|json|pdf|mp4|woff2?)(\?|$)/i;

/** Links on the home page that look like the food menu, best first. Same site only: ordering platforms render in JS. */
function menuLinks(html: string, base: string): string[] {
  const out = new Map<string, number>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]!;
    const label = htmlToText(m[2]!).toLowerCase();
    if (!/menu/i.test(href) && !/\bmenus?\b/.test(label)) continue;
    let url: URL;
    try {
      url = new URL(decode(href), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || ASSET.test(url.pathname) || host(url.toString()) !== host(base)) continue;
    url.hash = "";
    const key = url.toString();
    if (key === base || key === `${base}/`) continue;
    let score = 1;
    if (/food|dinner|lunch|main|full/i.test(key + label)) score += 1;
    if (/drink|bar|wine|beer|cocktail|catering|kids|happy|brunch|dessert|gift/i.test(key + label)) score -= 1;
    out.set(key, Math.max(out.get(key) ?? -9, score));
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

/** Keep each price line and the two lines above it, where the dish name and description sit. */
function priceWindows(text: string): { text: string; prices: number } {
  const lines = text.split("\n");
  const keep = new Set<number>();
  let prices = 0;
  lines.forEach((line, i) => {
    const n = pricesIn(line);
    if (!n || line.length > 400) return;
    prices += n;
    for (let k = Math.max(0, i - 2); k <= i; k++) keep.add(k);
  });
  return { text: [...keep].sort((a, b) => a - b).map((i) => lines[i]).join("\n"), prices };
}

export async function readSite(website: string): Promise<Site | null> {
  const start = website.startsWith("http") ? website : `https://${website}`;
  const home = await fetchHtml(start);
  if (!home) return null;

  const links = menuLinks(home.html, home.url).slice(0, 2);
  const menus = (await Promise.all(links.map(fetchHtml))).filter((p): p is { url: string; html: string } => !!p);

  const homeText = htmlToText(home.html);
  const parts = [...menus.map((p) => priceWindows(htmlToText(p.html))), priceWindows(homeText)];
  let menuText = "";
  for (const p of parts) {
    if (!p.prices || menuText.includes(p.text)) continue;
    menuText += (menuText ? "\n\n" : "") + p.text;
  }
  menuText = menuText.slice(0, MAX_TEXT);

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(home.html)?.[1];
  const theme = meta(home.html, "theme-color");
  return {
    pages: [home.url, ...menus.map((p) => p.url)],
    title: title ? decode(title).replace(/\s+/g, " ").trim() : null,
    description: meta(home.html, "description") ?? meta(home.html, "og:description"),
    themeColor: theme && /^#[0-9a-f]{3,8}$/i.test(theme.trim()) ? theme.trim() : null,
    menuText,
    prices: menuText.split("\n").reduce((sum, line) => sum + pricesIn(line), 0),
    intro: homeText.slice(0, 700),
  };
}
