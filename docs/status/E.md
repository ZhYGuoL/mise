# Lane E status

- Works with fixtures: dark map with a 12 s time-lapse of `orderFlows` (play, scrubber, clock), lost-order labels, headline numbers with version deltas, hourly band chart, objections, who ordered, sampled residents. Scenario controls re-run the simulation with a loading state. Checked at 1440 px and 1280 px.
- Faked or hardcoded: the day runs 06:00 to 06:00. An "other" order without a `placeId` is drawn to a restaurant near the home, and the resident card says "Another restaurant". The loading state shows for at least 500 ms. If `/api/simulate` fails, the pane shows the fixture with the status word "Fixture".
- Also in the lane: if nothing simulates a new concept version within 400 ms, the pane runs it. Deltas compare the same scenario, so the previous version runs again when its stored prediction is for another scenario.
- Check at merge: Vite pre-bundles `maplibre-gl` v6, which breaks its worker URL. `web/src/right/map/CityMap.tsx` sets the URL through `?worker&url`. The `LoadingState` label shimmer is gradient text, so `web/src/right/map/map.css` flattens it for this pane. No changes to `shared/contracts.ts`.
