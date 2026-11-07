# Lane B: Generation (photos, logo, menu card)

Read `CLAUDE.md` and `shared/contracts.ts` first. Branch `lane/b-generation`.

## You own
`server/src/routes/generate.ts`, `server/src/generate/**`, `web/src/generated/**`, `data/generated/` (gitignored output).

## FIRST 15 MINUTES: find out if image generation works at all
The organizers' guide marks image generation through OpenRouter as "sometimes supported". Before
building anything else:
1. List models from `GET https://openrouter.ai/api/v1/models` whose `architecture.output_modalities`
   includes `image`.
2. Generate one food photo with the best candidate through the team key. Record model id, latency, cost if shown.
3. Write the result in `docs/status/B.md` immediately, and set `MODEL_IMAGE` in `.env.example` as a comment.
If none works, say so in the status file in the first line, then fall back to a designed card
(see below) and keep going. Do not burn more than 20 minutes on this.

## Behavior
- `POST /api/generate/dish {concept, itemId}` -> `{ imageUrl }`. Prompt built from the item's
  `imagePrompt` (or name + description) plus a fixed house style so every dish looks like the same
  restaurant shot them: same surface, same light, same angle, same packaging. Pull color cues from `brand.colors`.
- `POST /api/generate/logo {concept}` -> `{ logoUrl }`. Flat, 2 colors from the brand, wordmark or simple mark.
  Zhiyuan's creative rule: the best marks fuse two ideas into one form (FedEx arrow). Try for that,
  never caption the trick.
- Save outputs to `data/generated/<conceptId>/<target>-<hash>.png`, serve at `/generated/...`.
  Cache by prompt hash so the same dish never regenerates twice. Generate in parallel, max 4 at once.
- Fallback card when generation fails or is off: a flat color card in brand colors with the dish name
  in the type system. It must look intentional, not broken.

## Web components (replace the stubs)
- `DishCard`: photo (or fallback), name, price, diet tags. States: empty, generating (Beautiful UI
  `loading-state`), done, failed. Regenerate button.
- `Logo`.
- Generation queue using Beautiful UI `task-rows` (running / done / failed per target).

## Done when
- All 6 dishes + logo for `data/fixtures/concept.json` generate (or fall back cleanly) in under ~40 s total.
- Same request twice hits the cache.
- Screenshot of the menu grid looked at, `docs/status/B.md` written (3-5 lines).
