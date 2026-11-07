# Lane H: Start from an existing restaurant

Read `CLAUDE.md` and `shared/contracts.ts` first. Branch `lane/h-existing`.
Owns: `server/src/import/**`, `server/src/routes/import.ts` (new), `web/src/left/import/**`, plus small
hooks in `web/src/left/` (entry point, agent tool) and `web/src/right/panels/HourChart.tsx` (overlay only).
Lane D is adding the simulator side at the same time (see "Split with lane D").

## Goal
Besides inventing a restaurant, the owner can start from a real one: "Noodlehead", "Fujiya Ramen",
or a pasted Google Maps link. It loads as a Concept, the simulated city treats it as that real
place, and the owner can ask "what if I stayed open till 2" or run `/optimize` on their actual business.

The demo moment: pick a real Pittsburgh restaurant the judges know, and the hourly chart shows the
simulated day next to Google's real busy curve for that place.

## Behavior
1. Entry points: an "Existing restaurant" option on the empty state, and `/import <name or Maps URL>`
   in the prompt bar (`registerCommand()` in `web/src/left/commands.ts`). Autocomplete over
   `GET /api/city/restaurants` (192 real places).
2. `POST /api/import { query }` -> `{ concept }`:
   - Match the query to a city restaurant (name fuzzy match, or the place id / coordinates in a Maps URL).
     No match -> return a clear error the UI shows. Do not invent a restaurant that is not in the data.
   - Fill the Concept from real data: name, location, cuisine, hours (from popular-times open hours or
     cuisine defaults), price tier, rating and reviews go in `concept.existing`.
   - Menu: if the restaurant has a website (OSM `website` tag or the Google data), fetch it and have
     `MODEL_FAST` extract up to 8 real items with prices -> `menuSource: "website"`. Otherwise
     `MODEL_FAST` drafts a likely menu from cuisine and price tier -> `menuSource: "estimated"`.
   - Brand colors and voice: drafted by `MODEL_FAST`. Logo and dish photos use lane B's normal
     generation (cached).
3. The canvas shows the real name with a small "Existing" tag and a "menu estimated" tag when the
   menu is drafted. Owner can edit any item by hand as usual.
4. `HourChart`: when `prediction.observedByHour` exists, draw Google's curve as a thin neutral line,
   scaled so its peak matches the simulated p50 peak (it is relative busyness, not orders), labeled
   "Google busy". Show `observedCorrelation` as one small number next to the legend.

## Split with lane D
Lane D implements, in the simulator: when `concept.existing` is set, replace that place instead of
adding a competitor, and return `observedByHour` + `observedCorrelation`. Until D merges, the
simulator will double-count the place; that is fine for building the UI. Do not edit `server/src/sim/**`.

## Budget
The key has a $7 total limit. One import should cost under $0.05 (one or two `MODEL_FAST` calls,
photos cached). Log the cost per import like the other routes do.

## Done when
`/import Noodlehead` produces a valid Concept with a real location and a menu tagged with its source,
the canvas renders it with photos, and (after D merges) the hour chart shows the Google overlay.
Status in `docs/status/H.md`, 3-5 lines.
