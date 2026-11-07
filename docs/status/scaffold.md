# Scaffold status

- Works: `bun run dev` starts server (:8787) and web (:5173). Every endpoint in `shared/contracts.ts` answers with its fixture, validated by zod. The page renders both panes from fixtures.
- Faked: everything. `/api/generate/*` returns null URLs (fallback cards). `/api/agent/optimize` replays the fixture session. `/api/residents/:id/ask` serves the new `data/fixtures/interview.json`.
- Added to `shared/contracts.ts` (additive only): request and response schemas for every endpoint (`AgentChatRequest`, `SimulateRequest`, `GenerateDishResponse`, and so on).
- Added `server/src/routes/optimize.ts` so Wave 2 owns the optimize route without touching Lane A's `agent.ts`.
- Fixed: the upstream Beautiful UI `foundation.json` has an orphan `}` near line 427 that breaks the CSS parse. Removed in `web/src/app/beautifui/foundation.css`.
