# Mise

Cursor for restaurants. Ideate a restaurant with an agent, generate its brand, menu and food photos,
and see how it would do in a simulated Pittsburgh before spending a dollar.

Built solo at NOVA 2026 (ScottyLabs, CMU). Hacking 11:00 AM to 5:00 PM ET, Sat Nov 7 2026.

## Priority order (every agent follows this)
1. **Product works end to end**: type an idea -> concept + photos -> simulate -> map + numbers move.
2. **Demo polish**: the time-lapse, diffs, the optimize loop.
3. **Rigor, only if time**: census data, calibration, critic passes.

## Run order
1. **Scaffold (alone):** `cd ~/github/mise && claude`, then: `Read briefs/00-scaffold.md and do it.`
2. **OpenRouter key into `~/github/mise/.env`** when the team email arrives.
3. **Wave 1, four agents in parallel**, each in its own worktree:

```bash
cd ~/github/mise
[ -f .env ] || cp .env.example .env
i=1
for L in a-ideation b-generation d-sim e-predict; do
  git worktree add ../mise-$L lane/$L
  # .env is gitignored, so worktrees do not get it. Each lane gets its own port pair.
  grep -vE '^(WEB_)?PORT=' .env > ../mise-$L/.env
  printf 'PORT=886%s\nWEB_PORT=526%s\n' $i $i >> ../mise-$L/.env
  (cd ../mise-$L && bun install)
  i=$((i+1))
done
# one terminal tab per lane:
cd ../mise-a-ideation   && claude "Read CLAUDE.md, then briefs/A-ideation.md, and do it."
cd ../mise-b-generation && claude "Read CLAUDE.md, then briefs/B-generation.md, and do it."
cd ../mise-d-sim        && claude "Read CLAUDE.md, then briefs/D-sim.md, and do it."
cd ../mise-e-predict    && claude "Read CLAUDE.md, then briefs/E-predict.md, and do it."
```

Lane ports: A on 5261, B on 5262, D on 5263, E on 5264 (API on 8861 to 8864). `main` stays on 5173 and 8787.

4. **2:00 PM merge** into `main` (D, then B, then A and E). Start Wave 2: `briefs/F-wave2-agents.md`.
5. **3:30 PM merge, feature freeze.** Run the demo 3 times, record a backup video. Phase 3 rigor only now.
6. **Wave 3 only if time:** `briefs/G-wave3-room-test.md`.

## Who owns what
| Path | Owner |
|---|---|
| `shared/contracts.ts` | shared (add optional fields only) |
| `data/raw/` | real Pittsburgh restaurant data, collected Nov 7 |
| `data/fixtures/` | sample data for every endpoint |
| `web/src/left/`, `server/src/agent/` | Lane A |
| `web/src/generated/`, `server/src/generate/` | Lane B |
| `server/src/{sim,city}/`, `data/city/` | Lane D |
| `web/src/right/` | Lane E |
