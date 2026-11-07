# Lane A status

- Works with the real model (`anthropic/claude-sonnet-5.5`): an idea becomes a valid v1 in 11 to 13 s. Follow-up edits take 3 to 5 s. Three edits in a row each made a version and a simulate call. Approval cards, hand edits on dishes, the version rail with p50 orders and the version diff all work in the browser. `?replay=1` plays the fixture session with no model.
- Cost: the team key has a $7 limit, and $0.88 was used by 12:51. Each agent turn costs about 5 to 15 cents.
- Hardcoded: 8 candidate sites in `server/src/agent/sites.ts`, with coordinates from real restaurants on the same block. Orders do not move between versions until Lane D merges, because the scaffold `/api/simulate` returns the same fixture. A small spinner sits on a dish card while its photo generates, until Lane B's card states land.
- Contract: `AgentChatRequest` has new optional fields `scenario`, `prediction` and `apply`. The app now starts empty. Add `?seed=1` to keep the fixture concept. Wave 2 can register `/optimize` with `registerCommand()` in `web/src/left/commands.ts`.
