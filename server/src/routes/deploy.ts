import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";

/**
 * "Deploy to DoorDash": Aside opens DoorDash's real merchant sign-up page in the owner's browser and
 * fills it from the concept (store name, address, business type). It never submits: the owner adds
 * contact details and clicks the button themselves. Deterministic script, no model call, ~5-8 s.
 */
export const deploy = new Hono();

const ASIDE = process.env.ASIDE_BIN || path.join(os.homedir(), ".local/bin/aside");
const SIGNUP = "https://merchants.doordash.com/en-us/products/marketplace";

function script(name: string, address: string) {
  const v = JSON.stringify({ name, address, url: SIGNUP });
  return `
const v = ${v};
const p = await openTab(v.url);
try { await p.bringToFront(); } catch (e) {}
const name = p.locator('input[name="company"]');
await name.waitFor({ timeout: 15000 });
await name.scrollIntoViewIfNeeded();
await name.fill(v.name);
const addr = p.locator('input[name="address2"]');
await addr.click();
await addr.pressSequentially(v.address, { delay: 15 });
let picked = null;
for (let i = 0; i < 12 && !picked; i++) {
  await new Promise(r => setTimeout(r, 250));
  picked = await p.evaluate(() => {
    const opts = [...document.querySelectorAll('li, [role="option"], div')].filter(x => x.offsetParent && x.childElementCount <= 3 && /, USA$/.test(x.textContent.trim()) && /Pittsburgh|PA/.test(x.textContent));
    const e = opts.pop(); if (!e) return null; const t = e.textContent.trim(); e.click(); return t;
  });
}
await p.locator('select').filter({ hasText: 'Select your business type' }).first().selectOption('Restaurant');
const out = await p.evaluate(() => ({ name: document.querySelector('input[name=company]').value, address: document.querySelector('input[name=address2]').value }));
console.log('__RESULT__' + JSON.stringify({ ...out, picked: !!picked, url: p.url() }));
`;
}

deploy.post("/doordash", async (c) => {
  const body = await c.req.json().catch(() => null);
  const concept = body?.concept;
  if (!concept?.name || !concept?.location?.address) return c.json({ ok: false, error: "missing concept name or address" }, 400);
  const t0 = Date.now();
  const res = await new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const child = spawn(ASIDE, ["repl", script(concept.name, concept.location.address)], { env: process.env });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const kill = setTimeout(() => child.kill("SIGTERM"), 60000);
    child.on("close", (code) => { clearTimeout(kill); resolve({ code: code ?? 1, out, err }); });
    child.on("error", (e) => { clearTimeout(kill); resolve({ code: 1, out, err: String(e) }); });
  });
  const m = res.out.match(/__RESULT__(\{.*\})/);
  if (!m) return c.json({ ok: false, error: (res.err || res.out).slice(-400), ms: Date.now() - t0 }, 502);
  return c.json({ ok: true, ms: Date.now() - t0, filled: JSON.parse(m[1]) });
});
