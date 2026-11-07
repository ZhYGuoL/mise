/** Dev check: run the optimize loop on the fixture concept and print each event. `bun --env-file=../.env src/optimize/try.ts orders 120` */
import { AgentEvent, Concept } from "@mise/shared";
import { runOptimize } from "./loop";
const concept = Concept.parse(await Bun.file(new URL("../../../data/fixtures/concept.json", import.meta.url).pathname).json());
const metric = (process.argv[2] ?? "orders") as "orders";
const target = Number(process.argv[3] ?? 120);
const t0 = performance.now();
await runOptimize({ concept, goal: { metric, target, scenario: { day: "Friday", weather: "clear", event: "none", runs: 20 } } }, async (e) => {
  AgentEvent.parse(e);
  const t = ((performance.now() - t0) / 1000).toFixed(1).padStart(5);
  const o = "optimize" in e && e.optimize ? `r${e.optimize.round}${e.optimize.candidate !== undefined ? "c" + e.optimize.candidate : ""}${e.optimize.final ? " FINAL" : ""}` : "";
  if (e.type === "prediction") console.log(t, o, "prediction", e.prediction.orders, "rev", e.prediction.revenue.p50);
  else if (e.type === "edits") console.log(t, o, "edits", e.optimize?.title ?? "", e.needsApproval, JSON.stringify(e.edits.map((x) => [x.op, x.path, x.value, x.previous, x.reason])));
  else if (e.type === "simulating") {}
  else console.log(t, o, JSON.stringify(e));
});
