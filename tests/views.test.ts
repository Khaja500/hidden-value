import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGame } from '../src/agents/factory';
import { Rng } from '../src/engine/rng';
import type { PlayerView, PublicView } from '../src/engine/types';
import { ALL_DIFFICULTIES, configFor, randomAction } from './helpers';

/** Every card id that appears anywhere in a serialized view. */
function cardsMentioned(view: PublicView): Set<number> {
  const found = new Set<number>();
  const re = /"card":(\d+)/g;
  for (const m of JSON.stringify(view).matchAll(re)) found.add(Number(m[1]));
  return found;
}

describe('view boundaries', () => {
  it('the player view only ever contains private and revealed cards', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 }),
        fc.constantFrom(...ALL_DIFFICULTIES),
        (seed, difficulty) => {
          const game = createGame(configFor(difficulty, seed));
          const rng = new Rng(seed ^ 0xabc);
          const hidden = game.fullState().cards;
          while (game.phase !== 'settled') {
            const v: PlayerView = game.view();
            const allowed = new Set([...v.privateCards.map((c) => c.card), ...v.revealed.map((r) => r.card)]);
            for (const c of cardsMentioned(v)) expect(allowed.has(c)).toBe(true);
            expect(Object.keys(v)).not.toContain('cards');
            expect(Object.keys(v)).not.toContain('settlement');
            // No hidden card may appear in the public view at all, except once revealed.
            const pub = game.publicView();
            for (const c of cardsMentioned(pub)) expect(v.revealed.some((r) => r.card === c)).toBe(true);
            expect(hidden.length).toBe(5);
            game.act(randomAction(v, rng));
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it('the player’s private cards are never revealed publicly', () => {
    for (const difficulty of ALL_DIFFICULTIES) {
      for (let seed = 0; seed < 50; seed++) {
        const game = createGame(configFor(difficulty, seed));
        const rng = new Rng(seed);
        while (game.phase !== 'settled') game.act(randomAction(game.view(), rng));
        const v = game.view();
        const priv = v.privateCards.map((c) => c.position);
        expect(v.revealed.length).toBe(3);
        for (const r of v.revealed) expect(priv).not.toContain(r.position);
      }
    }
  });

  it('settledView throws before settlement', () => {
    const game = createGame(configFor('medium', 3));
    expect(() => game.settledView()).toThrow();
  });

  it('views do not change after they are built', () => {
    const game = createGame(configFor('medium', 9));
    const v = game.view();
    const before = JSON.stringify(v);
    game.act({ side: 'pass', size: 0 });
    game.act({ side: 'pass', size: 0 });
    expect(JSON.stringify(v)).toBe(before);
    expect(Object.isFrozen(v.events[0])).toBe(true);
  });
});
