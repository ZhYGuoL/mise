// Builds web/public/landing/data.js for the landing page from the repo's own data.
// Run: bun scripts/build-landing-data.ts
import { readFileSync, writeFileSync } from "node:fs";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const R = read("data/city/restaurants.json");
const Z = read("data/city/residents.json");
const p = read("data/fixtures/prediction.json");
const c = read("data/fixtures/concept.json");

// Every restaurant, and every 4th resident home, so the map stays light.
const rs = R.map((x: any) => [+x.lat.toFixed(5), +x.lon.toFixed(5)]);
const zs = Z.filter((_: any, i: number) => i % 4 === 0).map((x: any) => [x.home.lat, x.home.lon]);

// Order trips: [fromLat, fromLon, hour, toConcept, toLat, toLon]
const flows = p.orderFlows.map((f: any) => {
  const r = f.placeId ? R.find((x: any) => x.placeId === f.placeId) : null;
  return [f.from.lat, f.from.lon, f.hour + f.minute / 60, f.restaurant === "concept" ? 1 : 0, r?.lat ?? null, r?.lon ?? null];
});

const out = {
  rs, zs, flows,
  loc: [c.location.lat, c.location.lon],
  byHour: p.byHour.map((h: any) => [h.p10, h.p50, h.p90]),
  orders: p.orders, revenue: p.revenue, share: p.marketSharePct,
  menu: c.menu.map((m: any) => ({ n: m.name, p: m.price, d: m.description })),
  name: c.name, tagline: c.tagline,
  objections: p.objections,
  stolen: p.stolenFrom.map((s: any) => [s.name, s.ordersLost]),
};

writeFileSync("web/public/landing/data.js", "window.MISE=" + JSON.stringify(out) + ";");
console.log(`landing data: ${rs.length} restaurants, ${zs.length} homes, ${flows.length} trips`);
