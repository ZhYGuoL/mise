# Mise

Cursor for restaurants. Describe a restaurant idea in chat, and Mise drafts the concept (name, menu, prices, logo, dish photos), then predicts how it would do in a simulated Pittsburgh before you spend a dollar.

Built at NOVA 2026 (ScottyLabs, CMU), Sat Nov 7 2026.

## What it does

- **Ideate in chat.** An agent turns a rough idea into a full concept and edits it on request. Every edit is a versioned diff you can review.
- **Generate the brand.** Logo and a photo for every dish, generated from the concept.
- **Simulate a Friday.** 10,000 simulated residents across Pittsburgh neighborhoods choose between your place and 192 real restaurants, hour by hour. You get orders by hour with a p10 to p90 range, revenue, market share, a time-lapse map, and the top reasons people chose somewhere else.
- **Ask a resident why.** Click anyone on the map and ask why they did or didn't order. The answer comes from the same factors the simulator used.
- **Optimize toward a goal.** "Get me to 120 orders on Friday" runs rounds of candidate edits, simulates each, and proposes the best set for approval.
- **Start from a real restaurant.** `/import Noodlehead` loads an existing place (menu from its website when available), simulates it as itself, and overlays Google's real busy curve on the prediction.

## Is the simulator any good?

We calibrated it against Google "popular times" for 64 real restaurants in the area, fitting on 51 and testing on 13 it never saw. On the held-out places, the median correlation with the real hourly shape is **0.54**, against **0.44** for a naive city-average curve and 0.32 before calibration. It beats the naive curve on 9 of 13. Details and the worst cases are in [`docs/calibration.md`](docs/calibration.md).

## Run it

Requires [Bun](https://bun.sh) and an OpenRouter key.

```bash
bun install
cp .env.example .env   # add OPENROUTER_API_KEY and model ids
bun run dev            # web on :5173, API on :8787
```

Open `http://localhost:5173/?seed=1` for a pre-filled sample concept. Set `MOCK=1` to run without a key.

## Stack

TypeScript end to end: Bun + Hono server, Vite + React web, MapLibre + deck.gl map, zod contracts in `shared/`. Models via OpenRouter. UI components from the Beautiful UI and shadcn registries.

## Data

Restaurant list from OpenStreetMap and Google Maps, plus hand-collected Google popular times, gathered Nov 7 2026 (`data/raw/`). Resident segments are hand-set by neighborhood, not census data yet.

## How it was built

Built in parallel lanes with coding agents, one git worktree per lane. The original plan and lane briefs are in [`docs/build-plan.md`](docs/build-plan.md) and [`briefs/`](briefs/).
