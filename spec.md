# spec.md — Hidden Value: an explainable market-making card game (website)

> Hand this file to Claude Code together with `plan.md`. This file says **what** to build and **how to know it is correct**. `plan.md` says the order to build it in, in one session.

---

## 1. Overview

**Hidden Value** is a website where you play a trading game against an AI **market maker**.

- The asset is worth the **sum of 5 hidden cards**.
- The market maker always shows a **bid** (the price it will buy at) and an **ask** (the price it will sell at).
- You see a card the market maker doesn't, so sometimes you know better than its prices.
- An **Advisor** tells you, at each moment, whether to **buy at the ask**, **sell at the bid**, or **hold**, how much, and why, with numbers.
- After each game, a **Review** page opens up the market maker's "brain" and explains every price it set.
- A **Research** page shows simulation results: how the market makers and the Advisor perform, and whether their explanations are faithful.

The whole site runs **in the browser** (no server) and is hosted free on **GitHub Pages** from the user's GitHub account.

### Terminology (used everywhere in code and UI)
| Term | Meaning |
|---|---|
| **Bid** | Price the market maker (MM) will **buy** at. You **sell at the bid** ("hit the bid"). |
| **Ask** | Price the MM will **sell** at. You **buy at the ask** ("lift the ask"). |
| **Spread** | Ask − bid. |
| **Fair value (μ)** | Expected value of the asset given some set of information. |
| **Edge** | For a buy: your fair value − ask. For a sell: bid − your fair value. Positive edge = a good trade on average. |
| **Inventory / position (q)** | Net units held. Positive = long, negative = short. |
| **Taker** | Anyone who trades against the MM's quotes (the player and the bot traders). |

### Goals
1. A polished, playable game website with a tutorial, difficulty levels, scoring, and a post-game review.
2. An Advisor whose advice is **correct, explained, and uses only information the player actually has**.
3. A market maker whose every quote breaks down into named, explainable parts.
4. A learned market maker whose behavior is explained, plus simulation results published on the site.
5. Live on GitHub Pages, from a repo in the user's GitHub account, with a clear README.

### Non-goals
- No backend server, user accounts, real money, or real market data.
- No GPU. Training and simulations run with Node on a laptop/CPU.

---

## 2. Game rules

### 2.1 The asset
- Deck: standard 52 cards, values **Ace = 1 … King = 13** (4 of each value).
- **5 cards** are dealt face down. The asset's true value **V = sum of the 5 cards**.
- Prior statistics (shown in the tutorial):
  - E[V] = 35
  - SD(V) ≈ 8.0 (variance = 5 × 14 × 47/51 ≈ 64.5)
  - Range 5 to 65; usually around 27–43.

### 2.2 Who knows what
- **Player:** sees **1 private card** (one of the 5). Easy mode: 2 private cards.
- **Informed bots:** each sees 1–2 of the 5 cards (configurable; may overlap with the player's).
- **Noise bots:** see only public cards.
- **Market maker:** sees only public information: revealed cards and all trades (including the player's). Never any private card.

### 2.3 Rounds
4 rounds, then settlement.

| Round | Public reveal at round start |
|---|---|
| 1 | none |
| 2 | 1 card |
| 3 | 1 card |
| 4 | 1 card |
| Settlement | all 5 cards shown; V computed |

The player's private card(s) are never chosen for a public reveal.

### 2.4 Trading steps within a round
Each round has **8 steps** (configurable). At each step:
1. The MM shows its bid/ask (up to 5 units each side).
2. One **bot trader** arrives (noise with probability 1 − α, informed with probability α) and buys, sells, or passes. The trade appears in the feed (side and size; trader type hidden).
3. The MM updates its beliefs and requotes.
4. The **player may act once**: buy 1–3 at the ask, sell 1–3 at the bid, or pass. The MM requotes.

Pacing:
- **Turn-based (default):** waits for the player each step.
- **Timed:** each step lasts a few seconds (configurable, shown as a countdown); no action counts as a pass.

### 2.5 Limits
- Player position limit **±10**; max **3** units per trade.
- MM hard limit ±25; at the limit it quotes only the side that reduces its position.

### 2.6 Settlement and scoring
- Long units earn (V − purchase price); short units earn (sale price − V).
- **Score = final P&L.**
- **Skill score (luck-adjusted):** the same seed is replayed by the Advisor bot (§5.6). Skill score = player P&L − Advisor-bot P&L. Positive = you beat the Advisor.
- Hints used are recorded next to the score; Ranked allows none.
- **Zero-sum:** player + MM + all bots' P&L sums to exactly 0 every game (required test).

### 2.7 Difficulty levels
| Level | Player private cards | Informed share α | Market maker |
|---|---|---|---|
| Easy | 2 | 10% | **Naive MM:** fixed spread around the public-card average |
| Medium | 1 | 25% | **Analytical MM** (§4.2), ignores the player's trades |
| Hard | 1 | 35% | **Analytical MM** that also learns from the player's trades |
| Expert | 1 | 35% | **Learned MM** (§6) |

### 2.8 Modes
1. **Tutorial:** guided first game with step-by-step pop-ups explaining bid, ask, spread and edge; Advisor always on; fixed seed so the lessons line up.
2. **Practice:** any difficulty; Advisor on demand.
3. **Daily challenge (ranked):** the same seed for everyone that day (seed derived from the date); no Advisor; scores saved to a local leaderboard.
4. **Review:** opens after every game (§7).
5. **Sandbox:** set α, MM type, γ and number of games; run simulations in a Web Worker and see charts.

---

## 3. Belief model (shared by the MM and the Advisor)

A **particle filter** over the hidden cards, in TypeScript.

- Each particle = one assignment of the unknown cards, consistent with what the agent knows (its private cards + public reveals).
- Default 5,000 particles (configurable); resample when effective sample size < 50%. Store particles in typed arrays (`Uint8Array`, `Float64Array`) for speed.
- **On a reveal:** redraw particles inconsistent with the revealed card.
- **On a trade:** multiply each particle's weight by the trade's likelihood given that particle's V:
  - P(buy | V) = (1 − α) · p_noise_buy + α · P(informed trader buys | V)
  - same for sell; pass = remainder
  - "Informed trader buys" = the probability that an informed trader holding 1–2 random cards from that particle would value the asset above the ask. Precompute a lookup table (by V, known-card sum and number of known cards) at startup so updates are fast.
- The agent's α is a **model parameter** (may differ from the game's true α).
- Outputs: **μ**, **Var(V)**, the distribution of V (for the UI histogram), and P(V > x) for any x.
- **Performance:** one update < 30 ms on a laptop in the browser. Heavy work (Sandbox, Advisor-bot replays) runs in a **Web Worker** so the UI never freezes.
- **Calibration requirement:** over 2,000 simulated games, bucketed μ predictions match the mean realized V within 95% CIs; P(V > x) statements are calibrated (reliability chart published on the Research page).

---

## 4. Market makers

Common interface:
```ts
interface MarketMaker {
  onEvent(e: GameEvent): void;              // reveals and trades
  quote(view: PublicView): Quote;           // bid, ask, sizes
  explain(): QuoteExplanation;              // breakdown of the last quote
}
```

### 4.1 Naive MM (Easy)
Center = expected V given public cards; fixed spread 6. Explanation: "Center = average of what's left in the deck; fixed spread of 6."

### 4.2 Analytical MM (Medium/Hard)
Every quote is built from three named components.

**A. Fair value μ** from the belief model, using public info and order flow.

**B. Adverse-selection spread (Glosten–Milgrom).**
- ask_AS = E[V | public info, next taker buys]; bid_AS = E[V | public info, next taker sells]
- Computed by reweighting particles with the buy/sell likelihood. More informed traders → wider spread.
- Worked example (for the tutorial): V ∈ {25, 45} equally likely, α = 0.3. Given a buy, P(V = 45) = (1 + α)/2 = 0.65, so ask = 25 + 20 × 0.65 = 38, bid = 32, spread = α × 20 = 6.

**C. Inventory skew (Avellaneda–Stoikov style).**
- skew = −γ · q · Var(V) (q = MM inventory, γ = risk aversion)
- Long MM → both quotes move down; short MM → both move up.
- Risk half-spread = c_risk · γ · Var(V), shrinking as cards are revealed.

**Final quote:** bid = bid_AS + skew − risk_half_spread (rounded down to the 0.5 tick); ask = ask_AS + skew + risk_half_spread (rounded up); minimum spread 1.0.

**`QuoteExplanation`** (returned with every quote):
```json
{
  "fairValue": 39.1,
  "fairValueChange": {"from": 37.4, "reasons": [
    {"cause": "reveal", "card": "Q", "delta": 1.2},
    {"cause": "orderFlow", "detail": "2 buys in last 3 steps", "delta": 0.5}]},
  "adverseSelection": {"bidOffset": -1.6, "askOffset": 1.6},
  "inventory": {"position": 3, "skew": -0.6},
  "riskHalfSpread": 0.7,
  "rounding": {"bid": -0.1, "ask": 0.2},
  "bid": 36.5, "ask": 41.0,
  "counterfactuals": [
    {"if": "inventory were 0", "bid": 37.0, "ask": 41.5},
    {"if": "the last 2 buys had not happened", "bid": 36.0, "ask": 40.5}]
}
```
Components plus rounding must **add up exactly** to the posted quote (required test). Counterfactual quotes must equal what the MM actually produces when the state is replayed with that change (required test).

Plain-language rendering example:
> Bid 36.5 / Ask 41.0
> • Fair value 39.1, up 1.7: a Queen was revealed (+1.2) and recent buying suggests informed traders (+0.5).
> • I hold 3 units, so I lowered both prices by 0.6 to attract buyers.
> • Spread 4.5 = 3.2 for protection against informed traders + 1.4 for risk, rounded to the tick.

### 4.3 Hard-mode behavior
The MM treats the player as a taker of unknown type, so the player's trades move its beliefs. The Hard tutorial pop-up says: "Your trades reveal information. Trade too eagerly and the market maker's prices move against you."

---

## 5. The Advisor (core feature)

Tells the player **when to buy at the ask, sell at the bid, or hold**, how much, and why.

### 5.1 Information rule (no cheating)
The Advisor's only input is a `PlayerView`: the player's private card(s), public reveals, the trade feed, current quotes, the player's position, and the round/step. It never receives hidden cards, bot types or MM internals.
- Enforced by TypeScript types: `advise(view: PlayerView): Advice`.
- **Required test:** for 500 random game states, change every card the player cannot see (keeping everything visible fixed); the Advisor's output must be identical.

### 5.2 What it computes
With its own particle filter (player's private cards + public info + order flow):
- **Your fair value** μ_p and its SD
- **Buy edge** = μ_p − ask and P(V > ask)
- **Sell edge** = bid − μ_p and P(V < bid)
- **Remaining capacity** under the position limit

### 5.3 Decision rule
- **BUY** if buy edge > θ × SD and P(V > ask) ≥ p_min
- **SELL** if sell edge > θ × SD and P(V < bid) ≥ p_min
- **HOLD** otherwise
- Defaults θ = 0.15, p_min = 0.58; tune by simulation (§8.4) and record final values in `docs/DECISIONS.md`.
- **Size:** clamp(round(k × edge / Var), 1, 3), capped by remaining capacity; tune k.
- **Round 4:** may recommend closing positions whose edge turned negative.
- **Hard mode:** after several same-direction trades by the player, warns that the MM is adjusting to them.

### 5.4 Advice card (what the player sees)
```
▲ BUY 2 at the ask (39.0)
Your estimate: 42.3 ± 5.1
Edge: +3.3 per unit, 74% chance V ends above 39

Why
• Your private King lifts your estimate 3.4 above the market maker's view.
• Revealed cards so far are about average.
• The market maker raised both prices after recent buys, so it is probably short.
Risk: if V ends at 33, you lose 6 per unit.
Position after trade: +4 (limit 10)
```
HOLD cards explain why: "Ask 38.0 vs your estimate 37.6: buying loses 0.4 per unit on average. Bid 33.0: selling gives up 4.6. No good trade right now."

### 5.5 Explanation rules
- Every number shown comes from computation; text is generated from templates filled with computed values.
- "Why" bullets come from an **attribution** of the gap between the player's estimate and the MM's mid-price into private-card, public-card and order-flow effects, each computed by recomputing μ_p with that information removed. Parts add up to the total gap (any residual shown as "other").

### 5.6 Advisor bot
An automated player that always follows the Advisor. Used for the skill score and for proving the Advisor is profitable (§8.4).

### 5.7 Post-trade feedback
After each player trade, a one-line verdict based only on information at that moment: "Good trade: +2.1 expected edge" or "Negative edge: you paid 1.5 more than your estimate." True outcomes appear only in Review.

---

## 6. Learned market maker (Expert) and its explanations

To keep everything in one TypeScript codebase and trainable on a CPU, the learned MM is a **small policy trained by simulation**, then explained.

### 6.1 Policy
- **Inputs (features):** public expected V, number of revealed cards, MM inventory q, q × public variance, order-flow imbalance over the last 3 and last 8 steps, round, step.
- **Outputs:** center offset from public expected V, and half-spread (softplus to keep it positive).
- **Model:** two variants, both trained:
  1. **Linear policy** (directly interpretable: each weight is an explanation)
  2. **Small MLP** (one hidden layer of 16 units)

### 6.2 Training
- **Algorithm:** Cross-Entropy Method (an evolution strategy): sample policy parameters, play batches of simulated games against bots across a range of α, keep the best-performing parameter sets, refit, repeat. Simple, stable, and fast enough on a CPU.
- **Objective:** mean P&L per game − λ × mean squared inventory.
- **Script:** `npm run train` (Node, using the same engine) writes `public/models/learned-mm.json` (weights + training curve). Use ≥ 3 seeds; keep the best on validation seeds.

### 6.3 Explaining it
- **Linear policy:** show its weights as a chart on the Research page and in Review ("each unit of inventory moves my prices by −0.2").
- **MLP:** partial-dependence plots (offset vs inventory; half-spread vs order-flow imbalance; half-spread vs round) and permutation feature importance, computed by a Node script and saved as JSON for the Research page.
- **Distillation:** fit a linear model to the MLP's outputs; report fidelity (R²). Compare the inventory coefficient with the analytical MM's γ × Var.
- **Headline question:** did the learned MM rediscover inventory skew (offset falls as inventory rises) and adverse-selection protection (spread rises with one-sided order flow)?
- In Expert mode, Review shows the distilled explanation of each quote, labeled with its fidelity.

---

## 7. Review page (post-game)

1. **Outcome:** all 5 cards, V, your P&L, skill score, the MM's P&L.
2. **Timeline:** step-by-step replay with a scrubber. Each step shows the MM's quote and full explanation, the Advisor's recommendation, and what you actually did. A line chart shows your estimate, the MM's fair value and the true V over time.
3. **Your trades, graded:** followed/ignored the Advisor, expected edge at the time, actual result.
4. **Key moments:** the 3 biggest missed opportunities and 3 worst trades (by expected edge at the time).
5. **Lessons:** templated tips triggered by patterns, e.g. "You often sold right after the market maker widened its spread. A wide spread means it is uncertain, so its bid is less attractive."
6. **Export:** download the game log as JSON; **share:** copy a link containing the seed so a friend can play the same deal.

---

## 8. Simulations and research results

Node scripts (`npm run sim -- --exp <name>`) using the same engine write JSON to `public/research/`. The Research page renders charts from these files. Seeds are split into **validation** (for tuning) and **test** (for reported numbers).

### 8.1 Correctness (automated tests)
- Zero-sum P&L every game
- Quote decomposition sums exactly; counterfactuals match replays
- Belief calibration
- Advisor no-cheat invariance
- Deterministic replays: same seed + same actions → identical log
- **No leak in the UI:** hidden cards are not rendered or stored in React state before settlement (keep them inside the engine object; the UI receives only `PlayerView` until settlement). Test by snapshotting the store at each step.

### 8.2 Market-maker experiments
- **α sweep** (0%–50%): profit, average spread, losses to informed traders, for naive vs analytical vs learned MM
- **γ sweep:** profit vs inventory variability
- **Model mismatch:** MM's assumed α wrong by ±50%
- **P&L attribution** per MM: spread capture (noise traders), adverse-selection loss (informed traders), inventory P&L

### 8.3 Faithfulness of explanations
- **Ablations:** remove each analytical component; check the effect its explanation claims (no skew → inventory variability rises; no adverse-selection spread → losses to informed rise).
- **Counterfactual accuracy:** 1,000 random states, listed counterfactual quotes vs real replays.
- **Advisor attribution:** removing the private card changes μ_p by the claimed private-card effect (within tolerance).

### 8.4 Advisor results
- Advisor-bot mean P&L and win rate at each difficulty with 95% CIs. **Required: mean P&L > 0 (CI above 0) at Easy, Medium and Hard.**
- Probability calibration of Advisor statements.
- Grid search of θ, p_min, k on validation seeds; final numbers on test seeds.

### 8.5 Research page
Sections: calibration chart; α-sweep chart; P&L attribution bars; ablation table; Advisor results table; learned-MM training curve, weights/PDPs and fidelity; short written conclusions under each chart.

---

## 9. Website

### 9.1 Pages (hash-based routing so refreshes work on GitHub Pages)
| Route | Content |
|---|---|
| `#/` | **Home:** the hero is a live, self-playing mini market (quotes updating, trades ticking) with a single "Play" button; short explanation of the game; links to Tutorial and Research |
| `#/play` | Difficulty and mode picker, then the game |
| `#/tutorial` | Guided first game |
| `#/review/:gameId` | Post-game review |
| `#/daily` | Daily challenge + local leaderboard |
| `#/research` | Simulation results (§8.5) |
| `#/sandbox` | Run simulations with chosen settings |
| `#/about` | What the project is, how it works (MM components, Advisor, learned MM), tech stack, link to the GitHub repo |

### 9.2 Play screen layout
- **Top bar:** round, step, difficulty, mode, countdown (timed mode)
- **Left:** cards: face-down hidden cards, revealed public cards, your private card(s) highlighted
- **Center:** large **quote board** (BID | ASK with sizes; brief highlight when a price changes), buttons **Sell at bid** (▼) and **Buy at ask** (▲), size selector 1–3, Pass
- **Right:** **Advisor panel** (§5.4) with an "Ask the Advisor" button, and a histogram of your belief about V with bid and ask drawn as lines
- **Bottom:** trade feed and position panel (position, average price, unrealized P&L at your estimate)
- **Keyboard:** B buy, S sell, 1/2/3 size, Space pass, A ask Advisor
- **Mobile:** stacked layout; quote board and buttons stay on screen

### 9.3 Design requirements
- Follow the `frontend-design` skill if available: a distinctive visual identity grounded in the subject (cards, trading pits, order tickets), not a generic dashboard template.
- Buy/sell never distinguished by color alone (icons and labels too).
- Keyboard-accessible controls with visible focus; respects reduced motion; light and dark themes; good contrast.
- Numbers right-aligned with tabular figures so prices don't jump around.
- Loading and empty states written as plain instructions.

### 9.4 Storage
`localStorage` (wrapped in try/catch; the site must work if it's unavailable) for: settings, the local leaderboard, and the last 20 game logs for Review. No other persistence.

---

## 10. Tech stack and hosting

| Area | Choice |
|---|---|
| App | Vite + React + TypeScript (strict) |
| State | Zustand |
| Charts | Recharts (or hand-built SVG where simpler) |
| Styling | CSS with design tokens (CSS variables), or Tailwind |
| Heavy compute | Web Worker (particle filter for Sandbox and Advisor-bot replays) |
| Scripts | Node + `tsx` for `train` and `sim` |
| Tests | Vitest (unit + property tests with fast-check); Playwright (one full game end to end) |
| Quality | ESLint, Prettier, `tsc --noEmit` |
| CI/CD | GitHub Actions: lint, type-check, tests, build, deploy to GitHub Pages |
| Hosting | **GitHub Pages**, repo in the user's account |

Check current versions before pinning.

### 10.1 GitHub setup (Claude Code does this using the `gh` CLI)
1. `gh auth status`; if not logged in, ask the user to run `gh auth login` (never ask for or handle tokens directly).
2. Get the username with `gh api user --jq .login`.
3. Create a **public** repo `hidden-value` (public is required for free GitHub Pages): `gh repo create hidden-value --public --source . --push`.
4. Set Vite `base` to `/hidden-value/`.
5. Add `.github/workflows/deploy.yml` using `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`; enable Pages with source "GitHub Actions" (`gh api -X POST repos/<user>/hidden-value/pages -f build_type=workflow`, or via repo settings if that call fails).
6. The site lives at `https://<user>.github.io/hidden-value/`. Put the link in the README and the repo's "About" box (`gh repo edit --homepage ...`).

---

## 11. Repository structure
```
hidden-value/
  spec.md  plan.md  README.md  LICENSE  .gitignore
  index.html  vite.config.ts  package.json  tsconfig.json
  .github/workflows/  ci.yml  deploy.yml
  src/
    engine/     cards.ts  events.ts  state.ts  rules.ts  views.ts  rng.ts
    belief/     particleFilter.ts  likelihoods.ts
    agents/     noise.ts  informed.ts  mmNaive.ts  mmAnalytical.ts  mmLearned.ts  advisor.ts  advisorBot.ts
    explain/    quoteExplanation.ts  counterfactual.ts  attribution.ts  review.ts  lessons.ts  render.ts
    workers/    sim.worker.ts
    store/      gameStore.ts  settings.ts  storage.ts
    pages/      Home.tsx  Play.tsx  Tutorial.tsx  Review.tsx  Daily.tsx  Research.tsx  Sandbox.tsx  About.tsx
    components/ QuoteBoard.tsx  CardRow.tsx  AdvisorPanel.tsx  BeliefHistogram.tsx  TradeFeed.tsx  PositionPanel.tsx  Timeline.tsx
    styles/
  scripts/      train.ts  sim.ts
  public/       models/learned-mm.json  research/*.json
  tests/        zeroSum.test.ts  replay.test.ts  calibration.test.ts  decomposition.test.ts
                counterfactual.test.ts  advisorNoCheat.test.ts  uiNoLeak.test.ts  e2e/fullGame.spec.ts
  docs/         DECISIONS.md  RULES.md
```

---

## 12. Definition of done

- [x] Site is live at `https://<user>.github.io/hidden-value/` from a public repo in the user's account, deployed by GitHub Actions
- [x] A full game is playable on desktop and mobile in turn-based and timed modes, at all four difficulties
- [x] Tutorial, Practice, Daily challenge, Review, Research, Sandbox and About pages all work
- [x] Advisor gives BUY / SELL / HOLD with size, numbers and reasons; no-cheat test passes
- [x] Every analytical MM quote has an explanation whose parts sum exactly; counterfactual test passes
- [x] Advisor bot is profitable at Easy, Medium and Hard (95% CI above 0)
- [x] Learned MM trained, playable in Expert mode, and explained on the Research page
- [x] All tests pass in CI; Playwright plays a full game
- [x] README: what the game is, how to play, how it works, research highlights, a screenshot or GIF, the live link

---

## 13. Rules for Claude Code

1. Read `spec.md` and `plan.md` fully, then build in the order of `plan.md` without waiting for approval between steps. Stop and ask only if something in the spec is contradictory or blocked (e.g. GitHub not logged in).
2. Engine, belief model and agents are **pure TypeScript with no DOM or I/O**, so the browser, the Web Worker and the Node scripts share exactly the same logic.
3. **Information boundaries are sacred:** agents get only their view object; the UI gets only `PlayerView` until settlement. Write these tests before the features that rely on them.
4. Every number shown to the player comes from computation, never from free text.
5. Seed all randomness; any game is reproducible from seed + action list.
6. Commit and push after each completed step of `plan.md` with a clear message, so progress is visible on GitHub and CI runs.
7. Record non-obvious choices (parameter values, library picks, rule tweaks) in `docs/DECISIONS.md`.
8. Ask before changing game rules, the Advisor's decision rule, or the tech stack.
9. Never print, log or commit secrets or tokens.
