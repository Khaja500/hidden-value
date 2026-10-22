# Rules of Hidden Value

## The asset

- A standard 52-card deck; values Ace = 1 … King = 13 (four of each).
- Five cards are dealt face down. The asset's true value **V** is the sum of the five values.
- Before anything is known: E[V] = 35, Var(V) = 5 × 14 × 47/51 ≈ 64.5 (SD ≈ 8.0); V ranges from 5 to 65 and is usually 27–43.

## Who knows what

- **You** see 1 private card (2 on Easy). Your private cards are never revealed publicly.
- **Informed bots** each see 1 or 2 of the five cards (½ each, chosen uniformly from all five positions), plus the public reveals.
- **Noise bots** see only the public cards.
- **The market maker** sees only public information: revealed cards and every trade (including yours). It never sees a private card.

## Rounds and steps

- 4 rounds of 8 steps. Rounds 2, 3 and 4 each start with one card turned face up.
- Each step:
  1. The market maker shows its bid and ask, each for up to 5 units.
  2. One bot arrives: informed with probability α, noise otherwise. It buys at the ask, sells at the bid, or passes. The feed shows the side and size, never the trader type.
  3. The market maker updates and requotes.
  4. You may act once: buy 1–3 at the ask, sell 1–3 at the bid, or pass. The market maker requotes.
- **Turn-based** pacing waits for you. **Timed** pacing gives each step a countdown (3–30 s, default 8 s); no action counts as a pass.

## Bots

- **Noise bots** want to buy (40%), sell (40%) or do nothing (20%). Each has a price tolerance τ drawn from an exponential distribution with mean 2, and trades only if the price is at most τ worse than the public-card expected value.
- **Informed bots** value the asset at E[V | public cards and their own cards]. They buy if that is above the ask, sell if below the bid, and pass otherwise.
- Every bot trades 1–3 units (uniform, the same for both types), capped by the quoted size.

## Limits

- Your position stays within ±10; at most 3 units per trade.
- The market maker's position stays within ±25; at its limit it quotes only the side that reduces its position.
- Prices are on a 0.5 tick; the minimum spread is 1.0.

## Settlement and scoring

- After step 8 of round 4, all five cards are shown and V is computed.
- Long units earn V − purchase price; short units earn sale price − V. **Your score is your P&L.**
- **Skill score** = your P&L − the P&L of the Advisor bot (a player that always follows the Advisor) on the same deal. The bots are drawn in advance from the deal's seed, so they arrive the same way whatever you do.
- Player + market maker + all bots always sum to exactly zero.

## Tables

| Table  | Your cards | Informed share α | Market maker                             |
| ------ | ---------- | ---------------- | ---------------------------------------- |
| Easy   | 2          | 10%              | Naive: public-card average ± 3           |
| Medium | 1          | 25%              | Analytical; ignores your trades          |
| Hard   | 1          | 35%              | Analytical; also learns from your trades |
| Expert | 1          | 35%              | Learned policy (trained by simulation)   |

## Modes

- **Tutorial:** a guided first game on a fixed deal, with the Advisor always on.
- **Practice:** any table; the Advisor answers when you ask (each ask counts as a hint).
- **Daily challenge:** the same deal for everyone on a given UTC date, on the Medium table, with no Advisor. Your first attempt is your ranked score; replays are listed separately.
- **Review:** after every game, a step-by-step replay with the market maker's reasoning, the Advisor's advice, graded trades, key moments and lessons.
- **Sandbox:** run your own simulations.
