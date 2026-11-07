# Lane D, round 2: existing restaurants, then calibration

Read `CLAUDE.md` and `shared/contracts.ts` first (new optional fields: `Concept.existing`,
`Prediction.observedByHour`, `Prediction.observedCorrelation`). Stay on `lane/d-sim`, run
`git merge main` first. You own `server/src/sim/**`, `server/src/city/**`, `data/city/**`,
`scripts/calibrate/**`, `docs/calibration.md`.

## Part 1 (do first, ~20-30 min): an existing restaurant replaces itself
Lane H is building "start from an existing restaurant". When `concept.existing.placeId` is set:
- Remove that real place from the competitor set for this run (no double-counting).
- The concept uses the real `rating` and `reviews`, and no "unknown new place" penalty.
- Residents who had that place as a favorite keep their habit bonus for the concept.
- `stolenFrom` compares against a baseline where the real place exists as it is today, so edits show
  "what changes vs today", not "vs no restaurant".
- If the place has Google popular times, return `observedByHour` for `scenario.day` (0-100) and
  `observedCorrelation` = Pearson correlation between simulated p50 orders by hour and that curve,
  over the hours the place is open.
- Add sanity checks: importing a real place unchanged gives roughly its baseline orders; its
  `stolenFrom` is near zero.
Commit, then tell Zhiyuan Part 1 is ready to merge.

## Part 2: calibration (the answer to "how do you know it's accurate?")
- Data: `data/raw/popular_times_long.csv` (64 places with hourly curves, relative to each place's own
  weekly peak; foot traffic, not delivery) and review counts as a rough proxy for each place's share.
- Tune the per-segment hour curves and the weight scales so the baseline city reproduces the hourly
  **shape** of each place. Fit on ~80% of places, hold out ~20% (fixed split by seed).
- Report: per-place correlation on the held-out set, the median, and how it compares to a naive
  baseline (every place gets the city-wide average curve). Beating the naive baseline is the claim;
  if it does not, say so plainly.
- Put the held-out median in every Prediction's `calibration.heldOutCorrelation` and a short note.
- `docs/calibration.md`: method in 5 lines, the numbers, one chart (PNG) of sim vs Google for 3
  held-out places, and the honest limits (foot traffic vs delivery, hand-set population).
- Keep `/api/simulate` under ~1 s for 20 runs. Re-run the sanity checks after tuning; they must still pass.

## Done when
Part 1 merged-ready and checked; Part 2 numbers in `docs/calibration.md` and in predictions.
Update `docs/status/D.md`.
