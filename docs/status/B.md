# Lane B status

- NOT TESTED against a real image model: no `OPENROUTER_API_KEY` yet (12:50 PM). Candidates: `google/gemini-3.1-flash-image` for dishes, `google/gemini-3-pro-image` for the logo (`MODEL_IMAGE_LOGO`). When the key lands, set `MODEL_IMAGE`, open `/src/generated/preview.html`, and check the 7 images and the total time.
- Works against a local fake OpenRouter (same code path): `POST /api/generate/dish` and `/logo`, cache by prompt hash across concepts (a repeat is `cached` in 0 ms), max 4 calls at once, regenerate makes a new take that stays after reload, a failure returns `{ url: null, status: "failed" }`. 7 targets took 11 s at 4 s per image.
- UI: `DishCard` and `Logo` request their own images, so `LeftPane` needs no change. States: empty, generating (`loading-state`), done (crossfade), failed (retry). `GenerationQueue` (task-rows) and `MenuGrid` are exported but not placed. Lane A decides where.
- Contracts (additive): `GenerateStatus`, optional `regenerate` on both requests, optional `status` / `ms` / `error` on both responses. For Lane A: `generateTargets()` in `server/src/generate`, and `useGeneration.getState().ingestAgentEvent(e, concept)` on the web.
- Not built: `/api/generate/menu-card` still returns null. Outside this lane: `foundation.css:208` (`h3 { text-wrap: balance }`) stops Tailwind `truncate` on every `h3`.
