import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGame } from '../src/agents/factory';
import { rankOf } from '../src/engine/cards';
import { MM_POSITION_LIMIT, PLAYER_POSITION_LIMIT } from '../src/engine/rules';
import { Rng } from '../src/engine/rng';
import { ALL_DIFFICULTIES, configFor, randomAction } from './helpers';

describe('engine invariants', () => {
  it('limits, ticks, crossed quotes and event structure hold in every game', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 }),
        fc.constantFrom(...ALL_DIFFICULTIES),
        (seed, difficulty) => {
          const config = configFor(difficulty, seed);
          const game = createGame(config);
          const rng = new Rng(seed + 1);
          let steps = 0;
          while (game.phase !== 'settled') {
            const v = game.view();
            expect(Math.abs(v.player.position)).toBeLessThanOrEqual(PLAYER_POSITION_LIMIT);
            expect(Math.abs(v.mmPosition)).toBeLessThanOrEqual(MM_POSITION_LIMIT);
            const q = v.quote;
            if (q.bid !== null && q.ask !== null) expect(q.ask - q.bid).toBeGreaterThanOrEqual(1);
            for (const p of [q.bid, q.ask]) if (p !== null) expect(Number.isInteger(p * 2)).toBe(true);
            game.act(randomAction(v, rng));
            steps++;
          }
          expect(steps).toBe(config.rounds * config.stepsPerRound);
          const st = game.fullState();
          expect(new Set(st.cards).size).toBe(5);
          const botActions = st.events.filter((e) => e.kind === 'action' && e.taker === 'bot');
          expect(botActions.length).toBe(32);
          for (const e of st.events) {
            if (e.kind !== 'action' || e.side === 'pass') continue;
            // Trades happen at the quoted price and never exceed the quoted size.
            expect(e.price).toBe(e.side === 'buy' ? e.quote.ask : e.quote.bid);
            expect(e.size).toBeLessThanOrEqual(e.side === 'buy' ? e.quote.askSize : e.quote.bidSize);
            expect(e.size).toBeGreaterThan(0);
          }
          // Informed bots trade only when their valuation is outside the quote.
          for (const r of st.botRecords) {
            if (r.type !== 'informed') continue;
            const e = st.events[r.seq];
            if (e.kind !== 'action') throw new Error('bad record');
            if (e.side === 'buy') expect(r.valuation!).toBeGreaterThan(e.quote.ask!);
            if (e.side === 'sell') expect(r.valuation!).toBeLessThan(e.quote.bid!);
          }
          const v = st.cards.reduce((a, c) => a + rankOf(c), 0);
          expect(game.settlement().value).toBe(v);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('rejects illegal player actions', () => {
    const game = createGame(configFor('medium', 5));
    expect(() => game.act({ side: 'buy', size: 4 })).toThrow();
    expect(() => game.act({ side: 'sell', size: 0 })).toThrow();
    expect(() => game.act({ side: 'pass', size: 2 })).toThrow();
    for (let i = 0; i < 3; i++) game.act({ side: 'buy', size: 3 });
    expect(game.view().player.position).toBe(9);
    expect(game.view().maxBuy).toBe(1);
    expect(() => game.act({ side: 'buy', size: 2 })).toThrow();
  });

  it('tracks the average entry price', () => {
    const game = createGame(configFor('medium', 11));
    const a1 = game.view().quote.ask!;
    game.act({ side: 'buy', size: 2 });
    const a2 = game.view().quote.ask!;
    game.act({ side: 'buy', size: 1 });
    expect(game.view().player.avgPrice).toBeCloseTo((2 * a1 + a2) / 3, 10);
    game.act({ side: 'sell', size: 3 });
    expect(game.view().player.avgPrice).toBeNull();
  });
});
