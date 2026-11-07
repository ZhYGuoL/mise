# Wave 2 (start after the 2:00 PM merge): agents on top of the simulator

Read `CLAUDE.md` and `shared/contracts.ts` first. Branch `lane/f-agents`.
Needs Lanes A and D merged. Owns `server/src/routes/residents.ts`, `server/src/optimize/**`,
`web/src/left/optimize/**`, `web/src/right/interview/**`.

## 1. Optimize: "get me to 120 orders on a Friday" (the demo's wow moment)
- `POST /api/agent/optimize {concept, goal: {metric: "orders"|"revenue", target, scenario}}` streams `AgentEvent`s.
- Loop like a coding agent running tests: read the latest Prediction (objections, stolenFrom,
  bySegment) -> propose 2-3 alternative edit sets -> simulate each (fast: runs=8) -> keep the best ->
  repeat, max ~5 rounds or until the target is hit. Stream each round as `thinking` + `edits` + `prediction`.
- Simple guardrails in code: no price below ~$4, max 3 edits per round, location stays in the sim
  area. The final edit set is presented with `approval-card`.
- In the left pane, "Optimize" is a `/` command in the prompt bar (`/optimize orders 120 friday`).

## 2. Resident interviews
- `POST /api/residents/:id/ask {concept, scenario, question}` -> `InterviewAnswer`.
- Server recomputes that resident's utility terms for the concept and their actual choice, then the
  LLM answers in first person **using only those terms** plus the persona. The reason it gives must be
  the real reason the model decided. Return the `breakdown` so the UI can show it next to the answer
  (Beautiful UI `context-cards`).
- Opens from a selected resident in the right pane.

## Done when
- `/optimize orders 120 friday` on the fixture concept reaches or approaches the target in under ~60 s
  and every round is visible.
- Asking 3 different residents "why didn't you order?" gives 3 different, faithful answers.
