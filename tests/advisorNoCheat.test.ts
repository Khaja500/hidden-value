import { describe, expect, it } from 'vitest';
import { Advisor, advise } from '../src/agents/advisor';
import { createGame } from '../src/agents/factory';
import { DECK_SIZE } from '../src/engine/cards';
import { hashSeed, Rng } from '../src/engine/rng';
import { makeConfig } from '../src/engine/rules';
import type { FullState } from '../src/engine/state';
import type { Difficulty } from '../src/engine/types';
import { privatePositions, toPlayerView } from '../src/engine/views';
import { randomAction } from './helpers';

const PARTICLES = 800;

/** Same visible information, different everything-else: unseen cards, bot types and bot cards. */
function scramble(full: FullState, rng: Rng): FullState {
  const visible = new Set<number>([
    ...privatePositions(full.config),
    ...full.revealed.map((r) => r.position),
  ]);
  const used = new Set<number>([...visible].map((p) => full.cards[p]));
  const pool = rng.shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i).filter((c) => !used.has(c)));
  const cards = full.cards.map((c, p) => (visible.has(p) ? c : pool.pop()!));
  const botRecords = full.botRecords.map((r) => ({
    ...r,
    type: rng.next() < 0.5 ? ('noise' as const) : ('informed' as const),
    positions: [rng.int(5)],
    valuation: rng.next() * 60,
  }));
  return { ...full, cards, botRecords, tickets: rng.shuffle([...full.tickets]) };
}

describe('Advisor information rule (no cheating)', () => {
  it('gives identical advice for 500 states that differ only in what the player cannot see', () => {
    let changedValue = 0;
    for (let i = 0; i < 500; i++) {
      const rng = new Rng(hashSeed('nocheat', i));
      const difficulty: Difficulty = (['easy', 'medium', 'hard', 'expert'] as const)[i % 4];
      const game = createGame(
        makeConfig(difficulty, hashSeed('nocheat-game', i), { mm: { particles: 600 } }),
      );
      const steps = rng.int(32);
      for (let s = 0; s < steps; s++) game.act(randomAction(game.view(), rng));
      const full = game.fullState();
      const other = scramble(full, rng);
      const sum = (cs: number[]) => cs.reduce((a, c) => a + (c % 13) + 1, 0);
      if (sum(other.cards) !== sum(full.cards)) changedValue++;

      const view = toPlayerView(full);
      const view2 = toPlayerView(other);
      expect(JSON.stringify(view2)).toBe(JSON.stringify(view));
      const a = advise(view, { particles: PARTICLES });
      const b = advise(view2, { particles: PARTICLES });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
    // The scrambles really did change the hidden asset value most of the time.
    expect(changedValue).toBeGreaterThan(400);
  });

  it('incremental advice equals advice computed from scratch', () => {
    const game = createGame(makeConfig('hard', 99, { mm: { particles: 600 } }));
    const live = new Advisor({ particles: PARTICLES });
    const rng = new Rng(5);
    while (game.phase !== 'settled') {
      const v = game.view();
      const a = live.advise(v);
      if (v.step % 3 === 0)
        expect(JSON.stringify(a)).toBe(JSON.stringify(advise(v, { particles: PARTICLES })));
      game.act(randomAction(v, rng));
    }
  });
});
