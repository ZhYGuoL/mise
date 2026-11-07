# Lane B status

- Works with the real key: 6 dishes + logo in 8 to 9 s (goal 40 s). Dishes use `google/gemini-3.1-flash-lite-image` (3 to 8 s, $0.034 each), the logo uses `google/gemini-3.1-flash-image` ($0.067) through `MODEL_IMAGE_LOGO`. A full menu costs $0.27. The team key has a $7 total limit, and $0.63 is spent (1:00 PM).
- Cache: the same prompt never generates twice, across concepts too. A reload of the fixture menu made 0 model calls. Regenerate makes a new take that stays after reload. Max 4 model calls at once. A failure returns `{ url: null, status: "failed" }` and the card shows its fallback.
- UI: `DishCard` and `Logo` request their own images, so `LeftPane` needs no change. States: empty, generating (`loading-state`), done (crossfade), failed (retry). `GenerationQueue` (task-rows) and `MenuGrid` are exported but not placed. Lane A decides where. Bench: `/src/generated/preview.html`.
- Contracts (additive): `GenerateStatus`, optional `regenerate` on both requests, optional `status` / `ms` / `error` on both responses. For Lane A: `generateTargets()` in `server/src/generate`, and `useGeneration.getState().ingestAgentEvent(e, concept)` on the web.
- Not built: `/api/generate/menu-card` returns null. Outside this lane: `foundation.css:208` (`h3 { text-wrap: balance }`) stops Tailwind `truncate` on every `h3`.
