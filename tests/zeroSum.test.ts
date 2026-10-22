import { describe, expect, it } from 'vitest';
import { ALL_DIFFICULTIES, configFor, playRandomGame } from './helpers';

describe('zero-sum settlement', () => {
  for (const difficulty of ALL_DIFFICULTIES) {
    it(`player + MM + bots P&L sums to exactly 0 (${difficulty})`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const { game } = playRandomGame(configFor(difficulty, seed), seed * 7919);
        const { pnl } = game.settlement();
        expect(pnl.player + pnl.mm + pnl.noise + pnl.informed).toBe(0);
        const st = game.fullState();
        const positions = Object.values(st.accounts).reduce((a, x) => a + x.position, 0);
        expect(positions).toBe(0);
      }
    });
  }
});
