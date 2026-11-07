# Lane A status

- Works: `?replay=1` plays the fixture session (typing, steps, v1, approval card), and Apply makes v2 through the real apply path. The live loop works against a local fake model: create, 3 follow-up edits in a row (each one a version plus a simulate call), approval cards, hand edits on dishes, the version rail with p50 orders, and the version diff.
- Not verified: the real model. No `OPENROUTER_API_KEY` exists in any worktree yet, so the 15 s target is untested. Set `MODEL_CHAT=anthropic/claude-sonnet-5.5` (or `anthropic/claude-haiku-5.5` for speed).
- Hardcoded: 8 candidate sites in `server/src/agent/sites.ts`. The coordinates come from real restaurants on the same block. Orders do not move between versions until Lane D merges, because the scaffold `/api/simulate` returns the same fixture. A small spinner sits on a dish card while its photo generates, until Lane B's card states land.
- Contract: `AgentChatRequest` has new optional fields `scenario`, `prediction` and `apply`. The app now starts empty. Add `?seed=1` to keep the fixture concept. Wave 2 can register `/optimize` with `registerCommand()` in `web/src/left/commands.ts`.
