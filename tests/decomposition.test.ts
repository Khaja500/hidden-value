import { describe, expect, it } from 'vitest';
import { createGame } from '../src/agents/factory';
import { Rng } from '../src/engine/rng';
import { makeConfig } from '../src/engine/rules';
import type { Difficulty, QuoteExplanation } from '../src/engine/types';
import { composeAsk, composeBid, reasonsTotal, spreadParts } from '../src/explain/quoteExplanation';
import { renderExplanation } from '../src/explain/render';
import { randomAction } from './helpers';

const TOL = 1e-9;

function explanations(difficulty: Difficulty, seed: number): QuoteExplanation[] {
  const out: QuoteExplanation[] = [];
  const config = makeConfig(difficulty, seed, { mm: { particles: 1500 } });
  const game = createGame(config, { onQuote: (_q, mm) => out.push(mm.explain({ counterfactuals: false })) });
  const rng = new Rng(seed);
  while (game.phase !== 'settled') game.act(randomAction(game.view(), rng));
  return out;
}

describe('quote decomposition', () => {
  for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as Difficulty[]) {
    it(`components plus rounding add up exactly to every posted quote (${difficulty})`, () => {
      let checked = 0;
      for (let seed = 1; seed <= 12; seed++) {
        for (const e of explanations(difficulty, seed)) {
          if (e.bid !== null) expect(Math.abs(composeBid(e)! - e.bid)).toBeLessThan(TOL);
          if (e.ask !== null) expect(Math.abs(composeAsk(e)! - e.ask)).toBeLessThan(TOL);
          expect(Math.abs(reasonsTotal(e) - (e.fairValue - e.fairValueChange.from))).toBeLessThan(1e-6);
          if (e.bid !== null && e.ask !== null) {
            const p = spreadParts(e);
            expect(
              Math.abs(p.adverseSelection + p.risk + p.fixed + p.rounding - (e.ask - e.bid)),
            ).toBeLessThan(TOL);
            expect(e.ask - e.bid).toBeGreaterThanOrEqual(1);
          }
          // Inventory skew leans against the position.
          if (e.inventory.position > 0) expect(e.inventory.skew).toBeLessThanOrEqual(0);
          if (e.inventory.position < 0) expect(e.inventory.skew).toBeGreaterThanOrEqual(0);
          if (e.mmKind === 'analytical') {
            expect(e.adverseSelection.askOffset).toBeGreaterThanOrEqual(-TOL);
            expect(e.adverseSelection.bidOffset).toBeLessThanOrEqual(TOL);
            expect(e.riskHalfSpread).toBeGreaterThanOrEqual(0);
          }
          if (e.mmKind === 'learned') {
            expect(e.learned).toBeDefined();
            expect(e.fixedHalfSpread).toBeGreaterThan(0);
          }
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(12 * 60);
    });
  }

  it('renders explanations from the computed numbers', () => {
    for (const e of explanations('hard', 77).slice(0, 40)) {
      const r = renderExplanation(e);
      expect(r.headline).toContain(e.bid === null ? '—' : e.bid.toFixed(1));
      expect(r.bullets.join(' ')).toContain(e.fairValue.toFixed(1));
    }
  });

  it('wider spreads at higher α (adverse selection)', () => {
    const avgSpread = (alpha: number) => {
      let s = 0;
      let n = 0;
      for (let seed = 0; seed < 10; seed++) {
        const config = makeConfig('medium', seed, { alpha, mm: { particles: 1500 } });
        const game = createGame(config);
        while (game.phase !== 'settled') {
          const q = game.view().quote;
          if (q.bid !== null && q.ask !== null) {
            s += q.ask - q.bid;
            n++;
          }
          game.act({ side: 'pass', size: 0 });
        }
      }
      return s / n;
    };
    expect(avgSpread(0.4)).toBeGreaterThan(avgSpread(0.05) + 0.5);
  });
});
