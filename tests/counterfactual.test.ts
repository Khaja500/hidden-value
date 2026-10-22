import { describe, expect, it } from 'vitest';
import { createGame } from '../src/agents/factory';
import { hashSeed, Rng } from '../src/engine/rng';
import { makeConfig } from '../src/engine/rules';
import type { Difficulty } from '../src/engine/types';
import { replayCounterfactual } from '../src/explain/counterfactual';
import { randomAction } from './helpers';

describe('counterfactual quotes', () => {
  it('equal what the MM actually produces when the state is replayed with that change', () => {
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const difficulty: Difficulty = (['easy', 'medium', 'hard'] as const)[i % 3];
      const config = makeConfig(difficulty, hashSeed('cf', i), { mm: { particles: 1200 } });
      const game = createGame(config);
      const rng = new Rng(i);
      const stop = 1 + rng.int(31);
      for (let s = 0; s < stop; s++) {
        const v = game.view();
        // Lean one way so the MM carries inventory.
        game.act(v.maxBuy > 0 && rng.next() < 0.6 ? { side: 'buy', size: v.maxBuy } : randomAction(v, rng));
      }
      const view = game.view();
      const e = game.marketMaker.explain();
      expect(e.counterfactuals.length).toBeGreaterThan(0);
      for (const cf of e.counterfactuals) {
        const q = replayCounterfactual(config, view.events, cf.change, view.round, view.step);
        expect(q.bid).toBe(cf.bid);
        expect(q.ask).toBe(cf.ask);
        checked++;
      }
      // Replaying with no change reproduces the posted quote.
      const same = replayCounterfactual(
        config,
        view.events,
        { kind: 'remove', seqs: [] },
        view.round,
        view.step,
      );
      expect(same).toEqual(view.quote);
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('an inventory of 0 removes the skew', () => {
    const config = makeConfig('medium', 4242, { mm: { particles: 1200 } });
    const game = createGame(config);
    for (let s = 0; s < 3; s++) game.act({ side: 'buy', size: 3 });
    const e = game.marketMaker.explain();
    expect(e.inventory.position).toBeLessThan(0);
    const flat = e.counterfactuals.find((c) => c.change.kind === 'inventory')!;
    // Short MM skews up, so with no inventory both prices would be lower or equal.
    expect(flat.ask!).toBeLessThanOrEqual(e.ask!);
    expect(flat.bid!).toBeLessThanOrEqual(e.bid!);
  });
});
