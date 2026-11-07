# Lane A: Ideation agent (left pane)

Read `CLAUDE.md` and `shared/contracts.ts` first. Branch `lane/a-ideation`.

## You own
`web/src/left/**`, `server/src/routes/agent.ts`, `server/src/agent/**`.

## What it is
The owner types an idea ("late-night Korean fried chicken near CMU, cheap") and the agent turns it into
a full `Concept`, then keeps editing it with them. This is the Cursor part: the concept is the code,
the agent proposes edits, the owner sees diffs and accepts them, every accepted version is kept.

## Behavior
- `POST /api/agent/chat` streams `AgentEvent`s over SSE. Uses OpenRouter (`MODEL_CHAT`) with tool calling.
- Tools the model can call:
  - `create_concept(brief)` -> full Concept (first turn only). Location must be a real address in
    Oakland, Shadyside, Squirrel Hill North or East Liberty, with real lat/lon.
  - `edit_concept(edits: ConceptEdit[])` -> server applies JSON Patch, fills `previous`, bumps
    `version`, validates with zod. Invalid edits are rejected back to the model, never applied.
  - `generate_images(targets)` -> calls Lane B's endpoints (fixture fallback), emits `generating` / `generated`.
  - `simulate(scenario)` -> calls `/api/simulate` (fixture fallback), emits `simulating` / `prediction`.
- After every accepted edit, the agent runs `simulate` so the right pane updates. The owner should
  feel a loop: say something, see the diff, see the number move.
- Edits that change price, location or cuisine set `needsApproval: true` and wait for the owner.
  Small copy edits apply directly.
- The agent reads the latest Prediction (objections, stolenFrom, bySegment) when proposing changes,
  and cites it in plain words ("31% said too far").
- The model reads and writes; code decides. Validation, patch application and versioning are code.

## UI (Beautiful UI)
- `chat-composer` + `prompt-bar` for the conversation, `streaming-text` for replies,
  `thinking-state` for steps, `tool-chips` for each edit (path + `+/-`), `diff-table` for the full
  diff of a version, `approval-card` for edits that need a yes.
- Above the chat: the concept canvas. Name, tagline, logo, and a menu grid using Lane B's
  `DishCard` (stub until Lane B merges). Clicking a menu item opens it for editing by hand; a manual
  edit is also a `ConceptEdit` and creates a version.
- Version rail, like git log: v1, v2, v3 with each version's p50 orders next to it. Click to view.

## Build against fixtures first
`data/fixtures/agent-events.json` is a full scripted session. Make the UI render it perfectly
(replay it with realistic timing) before wiring the model. That replay also becomes the demo fallback
if the network dies on stage: `?replay=1` plays it.

## Done when
- Typing an idea produces a valid Concept from the real model in under ~15 s, rendered with diffs.
- Three follow-up edits in a row work, each producing a version and a simulate call.
- `?replay=1` plays the fixture session end to end.
- Screenshot looked at, `docs/status/A.md` written (3-5 lines).
