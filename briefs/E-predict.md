# Lane E: Prediction pane (right side)

Read `CLAUDE.md` and `shared/contracts.ts` first. Branch `lane/e-predict`.

## You own
`web/src/right/**`.

## What it is
The "run" output of Cursor-for-restaurants. A dark map of the real neighborhood with the city
living on it, plus the numbers that matter, readable in two seconds from across a judging table.

## Layout (top to bottom)
1. **Map** (MapLibre GL + deck.gl, OpenFreeMap dark basemap, no key), centered on Oakland/Shadyside.
   - Real restaurants as small dots (`/api/city/restaurants`), the concept as one larger accent dot.
   - Residents as faint dots (`/api/city/residents?sample=3000`).
   - **Time-lapse of the simulated day** from `prediction.orderFlows`: each order is a short arc from
     the resident's home to the restaurant, concept orders in the accent color, others muted. A scrubber
     and a play button (one simulated day in ~12 s). The clock is visible. This is the demo's main visual.
   - `stolenFrom` restaurants get a thin line to the concept with the number lost.
2. **Headline numbers** using Beautiful UI `insight-cards`: orders (p10 to p90, p50 large), revenue,
   avg ticket, market share. Ranges, never single fake-precise numbers.
3. **Orders by hour** chart with the p10 to p90 band shaded and p50 as a line.
4. **Why people said no**: objections as a ranked list (`pct` + label), and who ordered (`bySegment`).
5. **Scenario controls**: day, weather, event. Changing one re-runs the simulation.
6. **Version compare**: when the store has more than one version, show the delta vs the previous
   version on the headline numbers (+18 orders) so every agent edit visibly moves something.
- While a simulation runs: Beautiful UI `loading-state`, and keep the previous numbers visible, dimmed.
- Clicking a resident dot or a sampled resident selects it (`selectedResidentId` in the store). Wave 2
  will open the interview from there; for now show their persona and home.

## Build against fixtures first
Everything renders from `data/fixtures/prediction.json`, `restaurants.json`, `residents.sample.json`.
Real data arrives through the same API calls later; nothing in your code should change.

## Done when
- The time-lapse plays smoothly with the fixture.
- Switching scenario shows the loading state and re-renders.
- Screenshot at 1440px looked at, `docs/status/E.md` written (3-5 lines).
