# Lane B status

- Image generation WORKS (12:58 PM): `google/gemini-3.1-flash-image`, one dish in 9.7 s, $0.067 per image. The team key has a $7 total limit, so one full menu (7 images) costs about $0.47. The cache matters.
- Works against a local fake OpenRouter (same code path): `POST /api/generate/dish` and `/logo`, cache by prompt hash across concepts (a repeat is `cached` in 0 ms), max 4 calls at once, regenerate makes a new take that stays after reload, a failure returns `{ url: null, status: "failed" }`. 7 targets took 11 s at 4 s per image.
- UI: `DishCard` and `Logo` request their own images, so `LeftPane` needs no change. States: empty, generating (`loading-state`), done (crossfade), failed (retry). `GenerationQueue` (task-rows) and `MenuGrid` are exported but not placed. Lane A decides where.
- Contracts (additive): `GenerateStatus`, optional `regenerate` on both requests, optional `status` / `ms` / `error` on both responses. For Lane A: `generateTargets()` in `server/src/generate`, and `useGeneration.getState().ingestAgentEvent(e, concept)` on the web.
- Not built: `/api/generate/menu-card` still returns null. Outside this lane: `foundation.css:208` (`h3 { text-wrap: balance }`) stops Tailwind `truncate` on every `h3`.
