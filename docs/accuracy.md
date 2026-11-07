# How we checked that Mise's numbers hold up

Run Nov 7 2026, about 4:10 PM, on `main`. Every number here comes from a script in this repo, and every check can be rerun.

## 1. The simulator matches real restaurants it never saw

Details in [`calibration.md`](calibration.md). We fit the simulator to Google popular times for 51 restaurants and tested it on 13 it never saw (split fixed by seed).

| Model | Median r on 13 held-out places |
|---|---|
| Mise, calibrated | **0.54** |
| Same city-average curve for every place | 0.44 |
| Mise before calibration | 0.32 |

It beats the city-average curve on 9 of 13. Not fitted: simulated weekly volume ranks places like their Google review counts do (Spearman 0.45, 64 places).

## 2. It behaves the way a city should: 26 checks, all pass

`bun server/src/sim/sanity.ts`

- Direction: cheaper means more undergrad orders, pricier means fewer, farther from campus means fewer, free delivery means more, closing early means fewer, Monday is below Friday, a launch promo means more, a vegan main means fewer diet objections.
- Text does not move numbers: editing the tagline gives identical orders.
- No double counting: importing a real restaurant unchanged reproduces its own orders (Noodlehead 45 vs 46 today, CHiKN 69 vs 66, Pizza Palermo 55 vs 53, Sushi Fuku 10 vs 9) and takes about zero customers from itself.
- One story everywhere: for sampled residents, the resident list, the map and the interview all agree on what they ordered.
- Speed: 100 runs finish under 3 s (2.0 s here).

## 3. Enough runs that the headline doesn't wobble

`bun scripts/verify/seed-stability.ts` (sample concept, Friday p50 orders across 10 seeds)

| Runs per prediction | Range of p50 across 10 seeds | Spread | Time per prediction |
|---|---|---|---|
| 20 | 45 to 57 | 12 | 0.4 s |
| 100 | 45 to 51 | 6 | 1.4 s |
| 200 | 47 to 53 | 6 | 2.2 s |

At 20 runs the default seed happened to land high (57). We moved the default to 100 runs: the spread halves, and 200 runs buys nothing more. The sample concept now reads about 50 orders.

Each run draws a city-wide demand level and how fast people discover a new place, then every resident's orders. The p10 to p90 range covers those, so it's the spread of plausible Fridays, not a confidence interval on the model itself.

## 4. Before and after are compared on the same days

Every order uses a fixed number of random draws whatever the concept is, so a concept and its edited version face the same simulated residents on the same simulated days. A difference between them comes from the edit, not from luck.

## 5. Optimize results are checked on days the search never saw

The search tries several edit sets and keeps the best score. Picking the best of several noisy scores runs high (the winner's curse). So the number the owner sees is a fresh check: 100 runs on a different seed, the owner's concept and the edited one on the same days.

`bun --env-file=.env scripts/verify/optimize-holdout.ts orders 90` (goal: 90 orders on Friday)

- The optimizer kept one edit: a 20% first-order discount for opening week.
- Its fresh check reported 48 to 81 orders, and said it **did not reach** 90.
- In the app, the same goal ran 2 rounds. The search scored its pick at 91; the fresh check said 79, and the card says "Closest 79" instead of "Reached".
- On 10 more fresh seeds: the edited concept beat the original on **10 of 10**, median **49.5 to 83**, worst case 73. It reached 90 on 1 of 10.

Before this fix, the same goal showed "Reached 91" from the search's own score.

## 6. The model proposes, code decides

- The language model only proposes edits. The simulator scores every one.
- Code clamps every proposal: at most 3 edits per set, no dish below $4 or 60% of the owner's price, discounts up to 30%, delivery fee up to $5.99, sites only inside the simulated area.
- An edit is kept only if it beats the current version by at least 1 order (or 1% of revenue).
- Nothing changes until the owner approves it.

## 7. Interviews are built from the simulator's own numbers

A resident's answer is generated from the exact terms the simulator used for their choice (taste, price vs budget, fees, delivery time, new place vs rating). Code checks the answer names the deciding reason. If it doesn't, it retries once, then falls back to a plain template.

## Limits we know about

- Google shows how busy a place is, not delivery orders. We match the shape of the day, not volume.
- Price and fee sensitivity are hand-set from typical delivery-app behavior, not fitted. That's why a 20% promo moves orders this much, and it's the first thing real order data should fix.
- The resident mix per neighborhood is hand-set, not Census.
- 13 held-out places is a small test. The worst one, Prince of India, runs a lunch buffet, and nothing in the model knows about buffets.
- The optimize loop stops when its search score hits the target, and the fresh check can come in lower. It says so instead of claiming the goal.
