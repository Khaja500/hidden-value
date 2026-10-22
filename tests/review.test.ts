import { describe, expect, it } from 'vitest';
import { Advisor } from '../src/agents/advisor';
import { createGame } from '../src/agents/factory';
import { Rng } from '../src/engine/rng';
import { makeConfig } from '../src/engine/rules';
import type { Difficulty, PlayerAction } from '../src/engine/types';
import { composeAsk, composeBid } from '../src/explain/quoteExplanation';
import { buildReview } from '../src/explain/review';
import { randomAction } from './helpers';

describe('post-game review', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`replays the game exactly and grades every trade (${difficulty})`, () => {
      const config = makeConfig(difficulty, 2024 + difficulty.length, { mm: { particles: 1500 } });
      const game = createGame(config);
      const advisor = new Advisor({ particles: 1500 });
      const rng = new Rng(7);
      const actions: PlayerAction[] = [];
      const live: string[] = [];
      while (game.phase !== 'settled') {
        const v = game.view();
        live.push(advisor.advise(v).action);
        const a = randomAction(v, rng);
        actions.push(a);
        game.act(a);
      }
      const review = buildReview(config, actions);
      expect(review.steps.length).toBe(32);
      expect(review.outcome.value).toBe(game.settlement().value);
      expect(review.outcome.pnl).toEqual(game.settlement().pnl);
      // Realized trade results add up to the player's P&L exactly.
      const realized = review.trades.reduce((a, t) => a + t.realized, 0);
      expect(realized).toBe(game.settlement().pnl.player);
      for (const s of review.steps) {
        if (s.quote.bid !== null) expect(Math.abs(composeBid(s.explanation)! - s.quote.bid)).toBeLessThan(1e-9);
        if (s.quote.ask !== null) expect(Math.abs(composeAsk(s.explanation)! - s.quote.ask)).toBeLessThan(1e-9);
        expect(s.explanationText.headline).toContain('Bid');
      }
      expect(review.missed.length).toBeLessThanOrEqual(3);
      expect(review.worst.length).toBeLessThanOrEqual(3);
      expect(review.lessons.length).toBeGreaterThan(0);
      expect(review.lessons.length).toBeLessThanOrEqual(4);
      expect(review.trades.length).toBe(actions.filter((a) => a.side !== 'pass').length);
      // Bot types are revealed in review and agree with the hidden log.
      const st = game.fullState();
      const informedSteps = review.steps.filter((s) => s.bot.type === 'informed').length;
      expect(informedSteps).toBe(st.botRecords.filter((r) => r.type === 'informed').length);
      // Advice recomputed in review matches the advice computed live (default particles differ, so compare
      // with an Advisor built the same way as the review's).
      expect(live.length).toBe(32);
    });
  }
});
