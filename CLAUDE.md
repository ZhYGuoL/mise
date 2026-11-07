# Mise: rules for every agent in this repo

Mise is "Cursor for restaurants", built solo at NOVA 2026 (ScottyLabs GenAI hackathon, CMU).
Left pane: an agent ideates a restaurant with the owner and generates the brand, menu and food photos.
Right pane: a simulated Pittsburgh (real restaurants, ~10,000 simulated residents) predicts how
the restaurant will do, and explains why.

Hard deadline: hacking ends **5:00 PM ET, Sat Nov 7 2026**. Merge checkpoints at **2:00 PM** and **3:30 PM**.
Judging is a 5-minute live demo in front of a panel. A demo that works every time beats a feature that works sometimes.

## Your lane

You were started with one brief in `briefs/`. Do that lane only.

- Edit only the folders your brief says you own. If you need something from another lane, use the
  fixture in `data/fixtures/` and keep going. Never wait on another lane.
- `shared/contracts.ts`: you may **add optional fields**. Never rename or remove anything, since other
  lanes depend on it. Note any addition in your status file.
- Work on branch `lane/<letter>-<name>`. Commit small and often. Zhiyuan merges at checkpoints.
- When your lane depends on an endpoint that is not built, call it anyway and fall back to the
  fixture. `MOCK=1` in `.env` forces every endpoint to serve fixtures.

## Stack (do not change)

- `web/`: Vite + React + TypeScript + Tailwind v4 + shadcn. Port 5173, proxies `/api` to 8787.
- `server/`: Bun + Hono + TypeScript. Port 8787.
- `shared/contracts.ts`: zod schemas imported by both sides. Validate every request and response with them.
- Map: MapLibre GL + deck.gl. Basemap from OpenFreeMap (no key).
- LLM and image calls: OpenRouter, key in `.env` as `OPENROUTER_API_KEY`. Model ids come from env
  vars (`MODEL_CHAT`, `MODEL_FAST`, `MODEL_IMAGE`), never hardcoded. Check what exists with
  `GET https://openrouter.ai/api/v1/models`.

## Rules from the organizers

- The OpenRouter key powers **app features only**. It must never be used to run a coding agent.
  You (the coding agent) run on Zhiyuan's own Claude subscription.
- Never commit `.env` or any key. OpenRouter scans GitHub and disables leaked keys instantly.
- Pre-existing project code must be disclosed at judging. Do not copy code from Zhiyuan's other repos.
  Libraries and registry components are fine.

## UI rules (Zhiyuan's standing review rules, apply to every pixel)

- Components: **Beautiful UI** (shadcn registry, see `docs/beautiful-ui.md`) for every agent surface.
  Use the `fluid-functionalism` skill for motion, type and spacing. Use `mal-gg-design` for dense
  data tables if you need one. Do not invent a new visual language.
- Flat colors only. No gradients, no glows, no drop-shadow decoration.
- No explainer text in the UI. Never write sentences that describe how the product works
  ("Powered by a discrete choice model..."). Title, value, status word. Nothing else.
- Every animation must have a cause the viewer can name (a new order, an edit, a finished run).
  If you cannot name the cause, delete the animation.
- Label data directly. Numbers in tabular figures. Ranges shown as ranges (p10 to p90), never one fake-precise number.
- Real content only. Never lorem ipsum. Use the fixtures, which are a coherent restaurant world.

## Priority order

1. **Product works end to end.** Visible, clickable, demoable. This is the only goal until it is true.
2. **Demo polish.** Motion with a cause, tight copy, the wow moments.
3. **Rigor, only after the 3:30 PM freeze and only if the product is solid**: tests, calibration,
   critic passes, sourcing. Do not start Phase 3 work early.

No test suites, no critic sub-agents, no refactors during phases 1-2. A hardcoded value that makes the
demo work is fine; note it in your status file.

## How you report

- Run it and look at it. For UI work, take a screenshot (`webapp-testing` skill or Aside via `aside-qa`).
- Be honest about what is faked: "works with fixture, real model not wired" is useful; "done" when
  it is not is harmful.
- Keep `docs/status/<lane>.md` to 3-5 lines: what works, what is faked, what is broken.
