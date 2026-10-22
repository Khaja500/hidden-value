# plan.md — Hidden Value build plan (one session)

`spec.md` says **what** to build. This file gives the **order** to build it in. The whole project is built in one session: Claude Code works through the steps below in order, commits after each one, and only stops to ask if it's blocked.

> **Status (updated 22 Oct 2026): all 10 steps are done.** The site is live at https://khaja500.github.io/hidden-value/, the repo is https://github.com/Khaja500/hidden-value, and every item of spec §12 is ticked. Each step below now records what was delivered and anything that changed. The 🔍 checks are yours to do; Claude Code can't do them, so they stay unticked until you tick them.

Legend: 🤖 = Claude Code does it · ✅ = done when · 📌 = what was delivered · 🔍 = what you check yourself

---

## How to start

Put `spec.md` and `plan.md` in an empty folder, open Claude Code there, and paste:

> Read spec.md and plan.md fully. Build the whole project in one session by working through every step in plan.md in order. After each step: run the tests, commit with a clear message, push, and tick the step in plan.md. Don't stop for approval between steps; only stop if you're blocked or the spec is contradictory. Start with step 1.

If the session ends partway, start a new one with:

> Read spec.md, plan.md and docs/DECISIONS.md, check git log and the test status, tell me which step we're on, and continue from there.

For follow-up work now that the build is finished:

> Read spec.md (especially §14), plan.md and docs/DECISIONS.md, check git log and that the tests pass, then make this change: …

---

## Build steps

### 1. Project and GitHub setup — [x] done
🤖
- Scaffold Vite + React + TypeScript (strict), ESLint, Prettier, Vitest, Playwright; folder structure from spec §11.
- Check `gh auth status`. If not logged in, stop and ask me to run `gh auth login`.
- Create the public repo `hidden-value` in my account with `gh`, push, add `ci.yml` and `deploy.yml`, enable GitHub Pages (source: GitHub Actions), set Vite `base` to `/hidden-value/`.
- Deploy a placeholder page.

✅ `https://khaja500.github.io/hidden-value/` shows the placeholder; CI is green.
📌
- `gh` was already logged in as `Khaja500`, so no token was ever handled.
- The repo is public, Pages builds from GitHub Actions, and the homepage is set.
- Pinned versions: Vite 8, React 19, TypeScript 6.0.3 (not 7, because typescript-eslint supports TypeScript < 6.1 only) and Node 24 in CI.

- [ ] 🔍 Open the link on your phone and laptop.

### 2. Game engine — [x] done
🤖
- Cards, seeded RNG, event-sourced state, rules, settlement, and the three views (`FullState`, `PublicView`, `PlayerView`) per spec §2 and §11.
- Placeholder MM (public expected V ± 3) and noise bots so games run end to end.
- Tests first: zero-sum, replay determinism, view boundaries, plus fast-check property tests for engine invariants.

✅ A full game runs headlessly from a seed; all engine tests pass.
📌
- Details the spec left open, now in spec §2:
  - bot trade sizes are 1–3, the same for every bot
  - noise bots buy 0.4, sell 0.4 and pass 0.2
  - informed bots see 1 or 2 cards
  - the player's card is position 0, with reveals in a seeded order
- Bot arrivals are pre-drawn from the seed, so the same seed gives the same bots whatever the player does. The skill score needs this.

### 3. Belief model — [x] done
🤖
- Particle filter with typed arrays and a precomputed informed-trader lookup table (spec §3).
- Calibration test over 2,000 simulated games; benchmark update time.

✅ Calibration test passes; updates < 30 ms.
📌
- The lookup table is keyed by (number of known cards, their sum).
- Reveals redraw inconsistent particles with full-history importance weights, combined by effective sample size, so the filter never collapses.
- Measured: 0.4 ms per trade update and 9 ms per reveal with 5,000 particles. `npm run bench` asserts the 30 ms budget; the unit test is a loose 100 ms guard, because it was flaky under parallel test load.

### 4. Bots and market makers — [x] done
🤖
- Noise and informed bots; naive MM; analytical MM with fair value, adverse-selection spread, inventory skew and risk spread (spec §4).
- `QuoteExplanation` with counterfactuals and the plain-language renderer.
- Tests first: decomposition sums exactly; counterfactuals match replays.
- Quick check: analytical MM beats naive MM in simulation when α ≥ 20%.

✅ Decomposition and counterfactual tests pass; analytical MM beats naive MM at α ≥ 20%.
📌 **Change:** this check could not pass while noise traders traded at any price, because the widest spread then always earns the most.
- Noise traders were made **price-sensitive**: tolerance τ ~ Exponential(mean 2), chosen by simulation from 1.5, 2 and 3. This is spec §2.2, and §14 explains it.
- γ = 0.01 and c_risk = 3 were chosen for the analytical MM.
- With both changes, the analytical MM beats the naive one at every α ≥ 20% (+23.5 vs +18.7 at 20%; +23.3 vs −8.3 at 50%).
- `QuoteExplanation` gained `mmKind`, `fixedHalfSpread`, `learnedOffset` and a `change` on each counterfactual, so one shape serves all three MMs.

### 5. The Advisor — [x] done
🤖
- No-cheat invariance test first (spec §5.1).
- Player particle filter, edges and probabilities, decision rule, sizing, attribution, templated BUY/SELL/HOLD cards, post-trade feedback, Advisor bot (spec §5).
- Simulate the Advisor bot at Easy/Medium/Hard (2,000 games each); tune θ, p_min, k on validation seeds; record values in `docs/DECISIONS.md`.

✅ No-cheat test passes; Advisor bot mean P&L > 0 (CI above 0) at Easy, Medium and Hard.
❌ If the Advisor loses money at any level, fix the likelihood model or tuning before building the UI.
📌
- **Tuned values:** θ = 0.15, **p_min = 0.65** (up from the 0.58 default) and k = 50.
- **Held-out results** (mean P&L per game): Easy +17.5 ± 1.8, Medium +12.0 ± 1.3, Hard +7.4 ± 0.9, and Expert +9.9 ± 1.3 (measured after step 9).
- **Attribution:** the Advisor runs two filters, one with your private card and one without. The "why" splits into private-card effect, order-flow effect and the MM's own positioning. Public cards are shown as context, because they move both estimates equally (spec §5.5).

### 6. Design system and Play page — [x] done
🤖
- Read the frontend-design skill if available; write a short design plan (palette, type, layout) into `docs/DECISIONS.md`, grounded in cards and trading, then build the tokens.
- Play page per spec §9.2: card row, quote board, Buy at ask / Sell at bid / size / Pass, Advisor panel with belief histogram, trade feed, position panel, keyboard shortcuts, turn-based and timed modes, mobile layout, light/dark themes.
- Zustand store that only ever holds `PlayerView` before settlement; UI no-leak test.
- Playwright test that plays a full game.

✅ A full game is playable in the browser at all difficulties except Expert; Playwright and no-leak tests pass; deployed.
📌
- **Design:** no frontend-design skill was available, so the design plan, "the trading pit's paper", was written from scratch. It uses order-ticket panels, a chalk price board, real card faces, and self-hosted Fraunces / IBM Plex fonts. Buy is cobalt ▲ and sell is vermilion ▼.
- **Timed mode** defaults to 8 s per step (3–30 s).
- **Fix:** order buttons drop focus after a mouse click, so Space (pass) can't re-press Buy.

- [ ] 🔍 **Play 3 games on the live site.** Is it obvious which button buys and which sells? Is the Advisor readable at a glance? Does it work on your phone?

### 7. Review, Tutorial, Practice and Daily challenge — [x] done
🤖
- Review page per spec §7 (timeline scrubber, revealed MM explanations, graded trades, key moments, lessons, JSON export, share-a-seed link).
- Guided Tutorial with pop-ups and the Glosten–Milgrom worked example.
- Practice mode; Daily challenge with a date-based seed and local leaderboard; skill score via the Advisor bot replay in a Web Worker.

✅ Tutorial completes end to end; Review works for any finished game; deployed.
📌
- **Review:** logs store only the config, your actions and the result, and the Review rebuilds the game by replaying it in the Web Worker. It also reveals bot types after settlement.
- **Tutorial:** seed 1757224188, with an interactive Glosten–Milgrom example.
- **Daily:** uses the Medium table, and the first attempt each day is ranked.
- **Hints:** in Practice, each "Ask the Advisor" counts as a hint. Daily shows no Advisor, no histogram and no post-trade verdicts.

- [ ] 🔍 Send the link to 2–3 friends with no explanation beyond the tutorial and watch where they get confused.

### 8. Simulations and Research page — [x] done
🤖
- `npm run sim` experiments from spec §8: α sweep, γ sweep, model mismatch, P&L attribution, ablations, counterfactual accuracy, Advisor attribution, Advisor results and calibration. Write JSON to `public/research/`.
- Research page rendering every chart and table with short conclusions.
- Sandbox page running small simulations in a Web Worker.

✅ Research page shows every §8.5 section from real simulation output; Sandbox runs; deployed.
📌 All the results are in spec §8.6. The ones that cut against the design are reported as they are:
- Underestimating α *raises* profit.
- γ = 0.02 earns slightly more than the game's 0.01 but quotes a spread too wide to be fun.
- The naive MM wins when few traders are informed.

Other points:
- **Conclusions** under each chart are generated from the JSON.
- **Sandbox** also lets you pick the player (nobody or the Advisor bot) and a numbered deal set.

- [ ] 🔍 For each chart, make sure you can explain *why* the result happened. Ask Claude Code if not; you'll need this in interviews.

### 9. Learned market maker — [x] done
🤖
- `npm run train`: Cross-Entropy Method training of the linear policy and the small MLP (≥ 3 seeds) per spec §6; save the best to `public/models/learned-mm.json`.
- Partial-dependence plots, permutation importance, distillation fidelity; add to the Research page.
- Expert mode using the learned MM; Review shows its distilled explanation with fidelity.

✅ Expert mode playable; Research page answers whether the learned MM rediscovered inventory skew and adverse-selection widening; deployed.
❌ If training is unstable: simplify features, normalize inputs, increase games per evaluation, and record the changes in `docs/DECISIONS.md`.
📌
- **Training:** 64 candidates × 400 games × 60 iterations × 3 seeds, with λ = 0.1. It takes about 3.5 minutes. Training was stable with normalised inputs.
- **Choice:** the MLP (validation objective 29.8 vs 29.5 for the linear policy) is Expert's MM. Its explanations come from a distilled linear model with fidelity R² 0.95.
- **Answer to the headline question:**
  - It **rediscovered inventory skew** (−0.82 per unit against the analytical −0.65).
  - It **rediscovered a spread that narrows as cards are revealed**.
  - It **did not rediscover Glosten–Milgrom widening**: it moves its centre instead.
- **Profit:** +30.4 to +31.4 per game at every α, more than the analytical MM throughout. It is **not** more than the naive MM at α = 0, where the naive MM earns 34.0.

### 10. Home, About, README and final checks — [x] done
🤖
- Home page with the live self-playing mini market as the hero; About page; final visual polish across all pages; loading and empty states.
- README: what it is, how to play, how it works, research highlights, screenshot/GIF, live link; set the repo homepage link with `gh repo edit --homepage`.
- Go through the **Definition of done** in spec §12 and tick every item; fix anything that fails.

✅ Every item in spec §12 is ticked; the live site works on desktop and mobile.
📌
- The Home page shows research highlights read live from the JSON.
- The README has four screenshots in `docs/screenshots/`.
- Extra Playwright tests play a full game at every difficulty on a phone-sized screen.
- The live site was checked in a real browser: every route loads (including after a refresh), with no console errors.

### 11. Multiplayer edition (one screen, 2–4 players) — [x] done
🤖 Requested after step 10. Built on the `multiplayer` branch and published from a new repo, so `main` and the original site stay as they are (spec §15).
- Engine: a `MultiGame` driver with per-seat views, rotating turn order, and reveals that use unheld cards first. The Hard MM's particle filter models each player with their own card position. The single-player driver shares the bot, trade and deal helpers, and its behaviour is unchanged.
- Tests first: zero-sum, replay, turn order, reveal order, seat-view boundaries, no-cheat per player, per-seat Hard MM, store/DOM no-leak across hand-offs.
- UI: the `#/multiplayer` setup page (players, names, table, Advisor on/off), the table with hand-off screens, the per-player turn panel, and results graded by expected edge versus luck. Plus a Home entry point, an About section and the README.
- Hosting: create the public repo `hidden-value-multiplayer`, push the branch as its `main`, enable Pages (GitHub Actions), set the homepage. Keep the branch in `hidden-value` in sync.

✅ The multiplayer site is live; every item in spec §15.5 is ticked; the single-player tests still pass.
📌
- **Live:** https://khaja500.github.io/hidden-value-multiplayer/ (repo `Khaja500/hidden-value-multiplayer`). The original site is unchanged.
- **Tests:** 60 unit tests (all 47 single-player ones unchanged) and 13 Playwright tests (2-, 3- and 4-player games) pass locally and in the new repo's CI.
- **Checked on the live site:** a full 3-player Hard game on a phone-sized screen, the Advisor, a refresh on `#/multiplayer`, single-player play and the About page, with no console errors.
- **Keeping it in sync:** commit on the `multiplayer` branch, then `git push origin multiplayer` and `git push multiplayer multiplayer:main` (the `multiplayer` remote is the new repo, and its `main` deploys).
- [ ] 🔍 Play a 2-player and a 3-player game with friends on one laptop or phone. Is the hand-off quick enough? Does anyone see a card they shouldn't?

---

## Optional extras (only after everything above is done) — not started
- **Play as the market maker:** you post bid/ask, bots trade against you, the Advisor coaches your quotes.
- **LLM narrator:** a small model rewrites the templated explanations in natural language, restricted to computed numbers and checked for accuracy.
- **Smarter informed bots** that split orders to hide their information.

---

## What to put on your resume when done
> Built **Hidden Value** (live at `khaja500.github.io/hidden-value`), a browser trading game against an explainable AI market maker (Bayesian particle-filter fair value, Glosten–Milgrom adverse-selection spreads, Avellaneda–Stoikov inventory skew), with an Advisor that recommends trades using only the player's information; trained a learned market maker by simulation and showed through partial-dependence and distillation analysis whether it rediscovered inventory skew; validated explanation faithfulness with ablations and counterfactual tests. Stack: TypeScript, React, Web Workers, GitHub Actions.

Only include results you actually measured on the Research page. A version with the measured results filled in:

> Built **Hidden Value** (live at `khaja500.github.io/hidden-value`), a browser trading game against an explainable AI market maker (Bayesian particle-filter fair value, Glosten–Milgrom adverse-selection spreads, Avellaneda–Stoikov inventory skew). Built an Advisor that uses only the player's information and is profitable at every difficulty (+7 to +18 per game, 95% CIs above zero, on held-out deals). Trained a neural market maker with the Cross-Entropy Method; partial-dependence and distillation analysis (R² 0.95) showed that it rediscovered inventory skew but not adverse-selection spread widening. Validated explanation faithfulness: 1,889/1,889 counterfactual quotes matched replays, and ablations confirmed every component's claimed effect. Stack: TypeScript, React, Web Workers, GitHub Actions.
