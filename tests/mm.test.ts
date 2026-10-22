import { describe, expect, it } from 'vitest';
import { createGame } from '../src/agents/factory';
import { makeConfig } from '../src/engine/rules';
import type { MMKind } from '../src/engine/types';

function meanPnl(mmKind: MMKind, alpha: number, games: number): number {
  let total = 0;
  for (let g = 0; g < games; g++) {
    const game = createGame(makeConfig('medium', 9000 + g, { mmKind, alpha, mm: { particles: 1000 } }));
    while (game.phase !== 'settled') game.act({ side: 'pass', size: 0 });
    total += game.settlement().pnl.mm;
  }
  return total / games;
}

describe('market makers against bots', () => {
  it('the analytical MM out-earns the naive MM when informed traders are common (α = 0.4)', () => {
    expect(meanPnl('analytical', 0.4, 150)).toBeGreaterThan(meanPnl('naive', 0.4, 150));
  });
});
