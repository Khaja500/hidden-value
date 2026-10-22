# Decisions

Non-obvious choices made while building Hidden Value, with the reason for each.

## Tooling

- **TypeScript 6.0.3**, not 7.x: `typescript-eslint` 8.72 supports TypeScript `<6.1.0` only.
- **Node 24 in CI** (current LTS); local development used Node 26.
- **Hash routing without a router library**: eight routes do not need react-router; a 30-line hook keeps the bundle small and refreshes work on GitHub Pages.
- **Fonts are bundled with `@fontsource`** rather than loaded from a CDN, so the site works offline and makes no third-party requests.

## Game rules (details the spec leaves open)

- **Bot trade size** is drawn uniformly from 1–3 for every bot, noise or informed, capped by the quoted size. Size therefore carries no information, and the belief model uses only the side (buy / sell / pass).
- **Noise bots** buy with probability 0.4, sell with 0.4 and pass with 0.2, regardless of price. If the side they want is not quoted (MM at its limit) they pass.
- **Informed bots** see 1 or 2 cards (probability ½ each), chosen uniformly from all 5 positions, so they can overlap with the player's card or with already-revealed cards. They value the asset at E[V | public reveals ∪ their cards] and buy if that is above the ask, sell if below the bid, else pass. They ignore order flow.
- **Bot arrivals are pre-drawn** from a seed-derived stream with a fixed number of draws per step. The same seed then gives the same bots whatever the player does, which the luck-adjusted skill score needs, and an α sweep reuses the same random numbers (common random numbers).
- **Card positions:** the player's private card is position 0 (and 1 in Easy). Reveals come from the other positions in a seeded random order.

## Belief model

- **Informed-trader lookup table:** an informed valuation depends only on (number of distinct known cards n, their sum S), so `VAL[n·66 + S]` is precomputed. For each particle, the 15 possible informed card subsets (5 singles at weight 0.1, 10 pairs at 0.05) map to table keys. P(informed buys | particle) is the weighted share of keys whose valuation exceeds the ask.
- **Reveals:** particles that disagree with a revealed card are redrawn from the deck given everything known. Each is weighted by the likelihood of the whole trade history, which makes it exact importance sampling. It is then combined with the surviving particles in proportion to each group's effective sample size. This avoids the collapse a plain reweighting would cause (about 12 in 13 particles disagree with any given reveal).
- **Glosten–Milgrom quotes** come from per-key weight accumulators, sorted by valuation, so E[V | buy at a] for any a is a binary search plus a difference of cumulative sums. The fixed point a = E[V | buy at a] is found by iterating from μ.
- **Hard-mode player model:** the MM treats each player trade as informed with β = 0.5: P(trade | V) = 0.5 · 0.5 + 0.5 · 1[player's valuation beats the quote]. Player passes are ignored.
- **Measured speed (M1 laptop, Node):** a trade update takes a median 0.4 ms and a reveal 9 ms with 5,000 particles (`npx tsx scripts/bench.ts`).
- **Tests:** the calibration test uses 2,000 particles to keep CI fast; the site uses 5,000. With 10 independent 95% intervals, one miss happens by chance about 40% of the time, so the test allows at most 1 of 10 buckets outside its interval. The 30 ms budget is checked as a median after warm-up, and CI runners get 3× the budget.
