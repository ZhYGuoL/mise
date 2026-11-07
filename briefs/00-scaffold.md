# Brief 00: Scaffold (run this FIRST, alone, aim for ~10-15 min)

Read `CLAUDE.md` first.

## Goal
A running monorepo so four lane agents can start at once without touching each other's files.
`bun run dev` from the root starts web and server, the page shows the two-pane layout, and every API
endpoint answers with its fixture. Speed over polish.

## Build
1. Root `package.json` with Bun workspaces (`web`, `server`, `shared`), `dev` script runs both. `zod` in `shared`.
2. `server/`: Bun + Hono on :8787. Route files `server/src/routes/{agent,generate,city,simulate,residents}.ts`,
   each returning its fixture from `data/fixtures/`. Serve `data/generated/` at `/generated`.
3. `web/`: Vite + React + TS + Tailwind v4 + shadcn. Proxy `/api` and `/generated` to :8787.
   Install Beautiful UI `foundation` and the components in `docs/beautiful-ui.md`.
4. `web/src/App.tsx`: header (concept name + version), `web/src/left/LeftPane.tsx` (Lane A),
   `web/src/right/RightPane.tsx` (Lane E). Zustand store `web/src/state/store.ts`: `concept`,
   `versions[]` (concept + prediction), `prediction`, `scenario`, `selectedResidentId`.
5. `web/src/api.ts`: one typed function per endpoint.
6. Stubs Lane B will replace: `web/src/generated/{DishCard,Logo}.tsx`.
7. `.env.example` (`OPENROUTER_API_KEY=`, `MODEL_CHAT=`, `MODEL_FAST=`, `MODEL_IMAGE=`), `.gitignore`
   covering `.env*` except the example, `node_modules`, `data/generated/`.
8. git init, commit on `main`, branches `lane/a-ideation`, `lane/b-generation`, `lane/d-sim`, `lane/e-predict`.

## Done when
`bun run dev` works and the page renders both panes with fixture data. Committed. Print the exact
commands to start a lane in a fresh worktree.
