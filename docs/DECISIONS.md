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

## Noise traders are price-sensitive (spec detail, decided in step 4)

The spec says noise bots "see only public cards" but not how they react to prices. If they trade whatever the price, the most profitable spread is infinitely wide. The naive MM's fixed spread of 6 would then out-earn any principled market maker. The learned MM would just learn "quote as wide as possible", and the research question about adverse-selection widening would be meaningless.

So each noise trader also has a **price tolerance τ ~ Exponential(mean 2)** and trades only if the price is at most τ worse than the public-card expected value: P(noise buy at ask) = 0.4 · exp(−max(0, ask − public EV)/2). The chance depends on public information only, so it is the same for every hidden-card assignment. The belief model includes it, with the noise share evaluated at the quote actually faced.

I chose τ̄ by simulation (300 bot-only games per cell; MM P&L per game, `npx tsx scripts/quickcheck.ts`):

| τ̄          | α = 0.2 naive / analytical | α = 0.3     | α = 0.5      | analytical spread at α = 0.3   |
| ---------- | -------------------------- | ----------- | ------------ | ------------------------------ |
| 1.5        | 7.3 / 12.8                 | 1.1 / 12.9  | −12.6 / 10.3 | 7.0 (too wide to play against) |
| 2 (chosen) | 18.1 / 23.4                | 10.6 / 22.9 | −5.6 / 22.2  | 5.9                            |
| 3          | 37.3 / 18.7                | 29.0 / 19.4 | 8.2 / 16.6   | 3.6 (naive wins up to α = 0.4) |

The τ̄ = 2 analytical figures use the chosen γ = 0.01, c = 3.

## Analytical market maker

- **γ = 0.01, c_risk = 3.** With γ = 0.005 and c = 2 the analytical MM only tied the naive MM at α = 0.2. Its spread sat below the profit-maximising width, because Glosten–Milgrom spreads alone earn zero expected profit against bots. γ = 0.01 with c = 3 beats naive at every α ≥ 0.2 and has the lowest P&L variance of the settings tried (stronger skew keeps inventory small). The γ sweep on the Research page explores the trade-off.
- **"Fair value change"** is measured from the fair value at the end of the previous round (the prior, 35, in round 1). The reveal, bot order flow and (Hard) player trades each get the sum of the μ changes they caused, so the reasons telescope exactly to the total change.
- **Minimum-spread widening is folded into "rounding"**, so the named components plus rounding still equal the posted prices.
- **"Add up exactly"** is tested to 1e-9: the parts are floating-point numbers, and a + (b − a) is not always bit-identical to b.
- **Counterfactuals:** "if inventory were 0" reuses the current beliefs, since inventory never affects beliefs; "if the last two trades had not happened" rebuilds the MM from the event log without them. Both are checked against independent replays through `replayCounterfactual`. Each counterfactual carries a machine-readable `change` field for that check.
- **Glosten–Milgrom is computed against the bot-trader model**, even for the quote the player faces next in Hard mode. In Hard mode the player's trades move the MM's beliefs but do not widen its spread.

## Advisor (step 5)

- **Final parameters: θ = 0.15, p_min = 0.65, k = 50.** Grid search over θ ∈ {0.05, 0.15, 0.3}, p_min ∈ {0.52, 0.58, 0.65}, k ∈ {25, 50, 100} on 300 validation-seed games per cell and difficulty (2,000 particles; same seeds for every cell, so comparisons are paired). The surface is flat in θ, because the probability condition binds first. p_min = 0.65 beat 0.58 at every difficulty with fewer, better trades and lower variance (summed mean P&L 47.8 vs 44.5). k = 50 and k = 100 tied (most recommended sizes hit the cap of 3 either way), so the smaller k keeps sizes sensitive to the edge. Full grid: `public/research/advisor-tuning.json`.
- **Held-out results** (2,000 test-seed games per difficulty, 5,000 particles; `npm run sim -- --exp advisor`): Easy +17.5 ± 1.8, Medium +12.0 ± 1.3, Hard +7.4 ± 0.9 mean P&L per game (95% CI), about 1–2 trades per game. All three are above zero, as the spec requires.
- **Seeds:** validation seeds are `hash("validation", i)` and test seeds `hash("test", i)`, so tuning never sees the reported games.
- **Two filters:** the Advisor runs one filter with the player's private card(s) and one without, so the private-card effect in the explanation is a real recompute with that information removed. The order-flow effect is (without private) − (public cards only, closed form). The rest of the gap to the MM's mid is shown as the MM's own positioning, and the parts sum exactly to the gap. Public cards shift both estimates equally, so they are reported as context instead of as a share of the gap.
- **The MM's inventory is public:** it is minus the takers' net buying in the trade feed. The Advisor may use it in explanations ("it is short 4 units, from the trade feed").
- **Seeds for the Advisor's filters** are derived from the player's private cards only, never from the game seed (which would determine the deal).
- **Last-round closing** recommends selling a long position when the bid is above the estimate (or buying back a short when the ask is below it), even when the edge is below the normal threshold.
- **Hard-mode warning** fires after 2 or more consecutive same-side player trades and reports how far the MM's mid has moved since the first of them.

## Design plan (step 6)

No `frontend-design` skill was available in this environment, so this plan is written from scratch.

**Idea: the trading pit's paper.** Open-outcry pits ran on paper order tickets, chalk price boards and playing-card-sized trading cards. The site borrows those materials rather than a generic dark dashboard.

- **Palette (light, "ticket stock"):** paper `#f2ebdd` background, card-white `#fbf8f1` surfaces, ink `#1c2230` text, graphite `#5b6272` secondary text, rule lines `#d9cfbc`. Accent brass `#a87a1e` marks _your_ things (private cards, your trades, your position).
- **Palette (dark, "after hours"):** pit-board `#11161f` background, `#1a212d` surfaces, chalk `#ece6d8` text, brass `#d6a84a`.
- **Buy / sell:** buy (lift the ask) is cobalt `#2456b3` with ▲ and the word BUY; sell (hit the bid) is vermilion `#b8412b` with ▼ and the word SELL. Blue and orange-red stay distinguishable under the common colour-vision deficiencies, and colour is never the only cue: every buy/sell element also carries its arrow, its label and its position (BID always left, ASK always right).
- **Type:** _Fraunces_ (variable serif) for the wordmark, headings and card ranks: it has the engraved, slightly old-exchange feel. _IBM Plex Sans_ for interface text. _IBM Plex Mono_ for every price and quantity, right-aligned with tabular figures so prices never jump. All self-hosted via `@fontsource`.
- **Motifs:** panels look like order tickets (perforated top edge, small stamped uppercase labels); the quote board looks like a pit price board with big mono digits; cards are real card faces (rank + suit corners), with hidden cards shown as a patterned back.
- **Motion:** a price change briefly highlights the new number (220 ms); trades slide into the feed. All motion is off under `prefers-reduced-motion`.
- **Layout (Play):** top bar (round, step, difficulty, mode, countdown); left column cards; centre quote board and order buttons; right column Advisor and belief histogram; bottom trade feed and position. On phones the columns stack, and the quote board and order buttons stick to the bottom of the screen.

## Review, Tutorial, Practice, Daily (step 7)

- **Game logs store only config + actions** (plus the result). The Review rebuilds everything by replaying the game in the Web Worker, which is deterministic, so it shows exactly what happened, including MM explanations with counterfactuals. This keeps localStorage small: 20 logs fit easily.
- **Bot types are revealed in the Review** ("an informed trader who knew 8♠ bought 2"). After settlement every card is public, so this is no leak, and it shows what the MM was guarding against.
- **Hints:** in Practice the belief histogram and estimate are always visible (they are "your belief"), while the BUY/SELL/HOLD recommendation is shown only when asked; each ask counts as one hint. Daily (ranked) shows neither, and gives no post-trade verdicts (they come from the Advisor's estimate).
- **Daily challenge:** the Medium table, with the seed `hash("hidden-value-daily", UTC date)`. The leaderboard is per browser; the first attempt is marked as the ranked score, because replays know the cards.
- **Tutorial deal:** seed 1757224188, found by searching for a deal where you hold a King, the Advisor says BUY on the first step, and the reveals go both ways (Q, then 5 and 4). All tip text is filled in from the live game state, so it stays true whatever the player does.
- **Focus after mouse clicks:** order buttons drop focus after a mouse click (`event.detail > 0`). Otherwise Space, the pass shortcut, would re-press the focused Buy button. Keyboard activation keeps focus.
- **Pages show the game only while it is running or just finished there.** Coming back to Play / Daily / Tutorial after a finished game shows the picker, leaderboard or lessons again.

## Simulations and Research page (step 8)

- **All reported numbers use test seeds** (`hash("test", i)`), with the same deals for every cell of a sweep, so differences between market makers are paired comparisons. Runs: `npm run sim -- --exp <calibration|alpha|gamma|mismatch|ablations|attribution|faithfulness|advisor>`. Each writes JSON to `public/research/` and runs on all cores via worker threads.
- **P&L attribution** splits each trade's P&L exactly into spread captured against the MM's own fair value at the time, plus value drift against that fair value, booked by counterparty: informed bots ("adverse selection"), noise bots ("inventory drift") and the player.
- **Findings the conclusions report as they are, even where they cut against the design:**
  - Underestimating α by 50% _raises_ the analytical MM's profit, and overestimating it cuts profit sharply. The Glosten–Milgrom spread is a zero-profit spread, and the risk half-spread sits on top of it, so the total spread is already on the wide side of profit-maximising.
  - γ = 0.02 earns slightly more than the game's γ = 0.01 with less risk, but quotes an 8.0 spread instead of 5.7. The game keeps 0.01 for playability, and the Research page says so.
  - For the analytical MM the noise-trade "inventory drift" is significantly positive (+5.9 ± 3.3 per game). Its skew attracts noise flow on the other side after informed or player trades move its inventory, which partly hedges adverse selection. For the naive MM it is indistinguishable from zero.
- **Conclusions are generated from the JSON**, so re-running an experiment cannot leave stale numbers in the text.
- **Chart colours:** the series palette (naive green, analytical cobalt, learned brass) passed the dataviz skill's validator on all pairs, in light and dark mode against the site's surfaces. Every chart has a table-view twin, and tooltips never gate a value.
- **Sandbox** runs in the Web Worker with 2,000 particles per filter for speed, on numbered "deal sets" so two runs with different settings see the same deals.

## Learned market maker (step 9)

- **Features (normalised to about −1…1):** (public EV − 35)/8, cards revealed/3, inventory/10, inventory × public variance/650, bot imbalance over the last 3 and 8 arrivals (÷3, ÷8), (round − 1)/3, (step − 1)/7. Outputs: centre offset from the public EV, and half-spread = 0.25 + softplus(raw). Order-flow features count bot trades only, as in training; the player's trades still move inventory.
- **Training:** Cross-Entropy Method with diagonal Gaussians: 64 candidates per iteration, top 10 kept, 60 iterations, extra exploration noise decaying over the first 75% of iterations. Each candidate plays the same 400 fresh bot-only games per iteration, across α ∈ {5, 15, 25, 35, 45}%. Objective: mean P&L − λ · time-averaged squared inventory, **λ = 0.1** (about a 10% penalty at typical inventories). 3 seeds per variant; the best on 2,000 validation games is kept. Each game takes about 0.08 ms with no particle filter, so the whole run takes about 3.5 minutes on 7 cores.
- **Result:** linear 29.5 vs MLP 29.8 validation objective. **The MLP is Expert mode's market maker.** The policy does not know α (it is not a feature) and has to cope with any share of informed traders.
- **Deployed weights** go to `src/agents/learned-weights.json` (bundled with the site; Vite cannot import from `public/`). The full training record goes to `public/models/learned-mm.json` (curves, validation scores, analysis). `npm run train -- --analyse-only` recomputes the analysis without retraining.
- **Explanations:** Expert reviews show a linear model distilled from the MLP over about 6,000 visited states, with its fidelity (R² 0.98 for the centre, 0.93 for the half-spread). "Cards revealed" is always "round − 1", so the distilled weights (and permutation importances) of those two cannot be separated; predictions are unaffected.
- **Analysis choices:** permutation importance is the mean absolute change in the policy's output when one feature column is shuffled. "Flow-following" is measured along realistic paths, where each net bot buy also moves inventory by −2 (the mean bot size). The holding-inventory-fixed partial dependence alone suggests the opposite, because the two features are correlated; the Research page shows both and explains why.
- **What the learned MM did and did not rediscover** (reported as found): inventory skew yes (stronger than the analytical rule late in the game, and saturating); spread narrowing as cards are revealed yes; Glosten–Milgrom-style widening on one-sided flow **no**: its spread is asymmetric (wider after net selling, narrower after net buying), and it protects itself by moving its centre instead.
- **Held-out results with the learned MM** (test seeds): bots only, it earns +30.4 to +31.4 per game at every α from 0 to 50%, more than both hand-built market makers at every α, with a nearly constant spread of about 5.95. In the attribution run it earns +27.2 ± 3.3 on the noise-trade inventory term (analytical: +5.9): its strong skew turns noise flow into a hedge. The Advisor bot still makes +9.9 ± 1.3 per game against it in Expert mode.
