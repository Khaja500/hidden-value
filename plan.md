# plan.md — Hidden Value build plan (one session)

`spec.md` says **what** to build. This file gives the **order** to build it in. The whole project is built in one session: Claude Code works through the steps below in order, commits after each one, and only stops to ask if it's blocked.

Legend: 🤖 = Claude Code does it · ✅ = done when · 🔍 = what you check yourself

---

## How to start

Put `spec.md` and `plan.md` in an empty folder, open Claude Code there, and paste:

> Read spec.md and plan.md fully. Build the whole project in one session by working through every step in plan.md in order. After each step: run the tests, commit with a clear message, push, and tick the step in plan.md. Don't stop for approval between steps; only stop if you're blocked or the spec is contradictory. Start with step 1.

If the session ends partway, start a new one with:

> Read spec.md, plan.md and docs/DECISIONS.md, check git log and the test status, tell me which step we're on, and continue from there.

---

## Build steps

### 1. Project and GitHub setup — [x] done
🤖
- Scaffold Vite + React + TypeScript (strict), ESLint, Prettier, Vitest, Playwright; folder structure from spec §11.
- Check `gh auth status`. If not logged in, stop and ask me to run `gh auth login`.
- Create the public repo `hidden-value` in my account with `gh`, push, add `ci.yml` and `deploy.yml`, enable GitHub Pages (source: GitHub Actions), set Vite `base` to `/hidden-value/`.
- Deploy a placeholder page.

✅ `https://<username>.github.io/hidden-value/` shows the placeholder; CI is green.
🔍 Open the link on your phone and laptop.

### 2. Game engine — [x] done
🤖
- Cards, seeded RNG, event-sourced state, rules, settlement, and the three views (`FullState`, `PublicView`, `PlayerView`) per spec §2 and §11.
- Placeholder MM (public expected V ± 3) and noise bots so games run end to end.
- Tests first: zero-sum, replay determinism, view boundaries, plus fast-check property tests for engine invariants.

✅ A full game runs headlessly from a seed; all engine tests pass.

### 3. Belief model — [x] done
🤖
- Particle filter with typed arrays and a precomputed informed-trader lookup table (spec §3).
- Calibration test over 2,000 simulated games; benchmark update time.

✅ Calibration test passes; updates < 30 ms.

### 4. Bots and market makers — [x] done
🤖
- Noise and informed bots; naive MM; analytical MM with fair value, adverse-selection spread, inventory skew and risk spread (spec §4).
- `QuoteExplanation` with counterfactuals and the plain-language renderer.
- Tests first: decomposition sums exactly; counterfactuals match replays.
- Quick check: analytical MM beats naive MM in simulation when α ≥ 20%.

✅ Decomposition and counterfactual tests pass; analytical MM beats naive MM at α ≥ 20%.

### 5. The Advisor — [x] done
🤖
- No-cheat invariance test first (spec §5.1).
- Player particle filter, edges and probabilities, decision rule, sizing, attribution, templated BUY/SELL/HOLD cards, post-trade feedback, Advisor bot (spec §5).
- Simulate the Advisor bot at Easy/Medium/Hard (2,000 games each); tune θ, p_min, k on validation seeds; record values in `docs/DECISIONS.md`.

✅ No-cheat test passes; Advisor bot mean P&L > 0 (CI above 0) at Easy, Medium and Hard.
❌ If the Advisor loses money at any level, fix the likelihood model or tuning before building the UI.

### 6. Design system and Play page — [x] done
🤖
- Read the frontend-design skill if available; write a short design plan (palette, type, layout) into `docs/DECISIONS.md`, grounded in cards and trading, then build the tokens.
- Play page per spec §9.2: card row, quote board, Buy at ask / Sell at bid / size / Pass, Advisor panel with belief histogram, trade feed, position panel, keyboard shortcuts, turn-based and timed modes, mobile layout, light/dark themes.
- Zustand store that only ever holds `PlayerView` before settlement; UI no-leak test.
- Playwright test that plays a full game.

✅ A full game is playable in the browser at all difficulties except Expert; Playwright and no-leak tests pass; deployed.
🔍 **Play 3 games on the live site.** Is it obvious which button buys and which sells? Is the Advisor readable at a glance? Does it work on your phone?

### 7. Review, Tutorial, Practice and Daily challenge
🤖
- Review page per spec §7 (timeline scrubber, revealed MM explanations, graded trades, key moments, lessons, JSON export, share-a-seed link).
- Guided Tutorial with pop-ups and the Glosten–Milgrom worked example.
- Practice mode; Daily challenge with a date-based seed and local leaderboard; skill score via the Advisor bot replay in a Web Worker.

✅ Tutorial completes end to end; Review works for any finished game; deployed.
🔍 Send the link to 2–3 friends with no explanation beyond the tutorial and watch where they get confused.

### 8. Simulations and Research page
🤖
- `npm run sim` experiments from spec §8: α sweep, γ sweep, model mismatch, P&L attribution, ablations, counterfactual accuracy, Advisor attribution, Advisor results and calibration. Write JSON to `public/research/`.
- Research page rendering every chart and table with short conclusions.
- Sandbox page running small simulations in a Web Worker.

✅ Research page shows every §8.5 section from real simulation output; Sandbox runs; deployed.
🔍 For each chart, make sure you can explain *why* the result happened. Ask Claude Code if not; you'll need this in interviews.

### 9. Learned market maker
🤖
- `npm run train`: Cross-Entropy Method training of the linear policy and the small MLP (≥ 3 seeds) per spec §6; save the best to `public/models/learned-mm.json`.
- Partial-dependence plots, permutation importance, distillation fidelity; add to the Research page.
- Expert mode using the learned MM; Review shows its distilled explanation with fidelity.

✅ Expert mode playable; Research page answers whether the learned MM rediscovered inventory skew and adverse-selection widening; deployed.
❌ If training is unstable: simplify features, normalize inputs, increase games per evaluation, and record the changes in `docs/DECISIONS.md`.

### 10. Home, About, README and final checks
🤖
- Home page with the live self-playing mini market as the hero; About page; final visual polish across all pages; loading and empty states.
- README: what it is, how to play, how it works, research highlights, screenshot/GIF, live link; set the repo homepage link with `gh repo edit --homepage`.
- Go through the **Definition of done** in spec §12 and tick every item; fix anything that fails.

✅ Every item in spec §12 is ticked; the live site works on desktop and mobile.

---

## Optional extras (only after everything above is done)
- **Play as the market maker:** you post bid/ask, bots trade against you, the Advisor coaches your quotes.
- **LLM narrator:** a small model rewrites the templated explanations in natural language, restricted to computed numbers and checked for accuracy.
- **Smarter informed bots** that split orders to hide their information.

---

## What to put on your resume when done
> Built **Hidden Value** (live at `<username>.github.io/hidden-value`), a browser trading game against an explainable AI market maker (Bayesian particle-filter fair value, Glosten–Milgrom adverse-selection spreads, Avellaneda–Stoikov inventory skew), with an Advisor that recommends trades using only the player's information; trained a learned market maker by simulation and showed through partial-dependence and distillation analysis whether it rediscovered inventory skew; validated explanation faithfulness with ablations and counterfactual tests. Stack: TypeScript, React, Web Workers, GitHub Actions.

Only include results you actually measured on the Research page.
