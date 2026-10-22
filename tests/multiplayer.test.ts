import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { advise } from '../src/agents/advisor';
import { createMarketMaker, createMultiGame } from '../src/agents/factory';
import { ParticleFilter } from '../src/belief/particleFilter';
import { DECK_SIZE } from '../src/engine/cards';
import { drawTickets } from '../src/engine/game';
import {
  MultiGame,
  replayMultiGame,
  seatOrder,
  toMultiPublicView,
  toSeatView,
  type MultiState,
  type SeatAction,
} from '../src/engine/multiGame';
import { hashSeed, Rng } from '../src/engine/rng';
import { makeConfig, makeMultiConfig } from '../src/engine/rules';
import type { ActionEvent, Difficulty } from '../src/engine/types';
import { ALL_DIFFICULTIES, randomAction } from './helpers';

function multiConfig(difficulty: Difficulty, seats: number, seed: number, particles = 600) {
  const c = makeMultiConfig(difficulty, seats, seed);
  return { ...c, mm: { ...c.mm, particles } };
}

function playRandom(game: MultiGame, rng: Rng, maxActions = Infinity): SeatAction[] {
  const actions: SeatAction[] = [];
  while (game.phase !== 'settled' && actions.length < maxActions) {
    const seat = game.currentSeat!;
    const a = randomAction(game.seatView(seat), rng);
    actions.push({ seat, ...a });
    game.act(a);
  }
  return actions;
}

function cardIdsIn(json: string): number[] {
  return [...json.matchAll(/"card":(\d+)/g)].map((m) => Number(m[1]));
}

describe('multiplayer engine', () => {
  it('is zero-sum: the players, the market maker and the bots always sum to 0', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_DIFFICULTIES),
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 0, max: 2 ** 31 }),
        (difficulty, seats, seed) => {
          const game = createMultiGame(multiConfig(difficulty, seats, seed, 300));
          playRandom(game, new Rng(seed ^ 0x5eed));
          const { pnl } = game.settlement();
          const total = pnl.players.reduce((a, b) => a + b, 0) + pnl.mm + pnl.noise + pnl.informed;
          expect(Math.abs(total)).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 24 },
    );
  });

  it('replays exactly from the config and the actions', () => {
    for (const seats of [2, 3, 4]) {
      const config = multiConfig('hard', seats, 1000 + seats);
      const game = createMultiGame(config);
      const actions = playRandom(game, new Rng(seats));
      const again = replayMultiGame(config, actions, createMarketMaker(config));
      expect(JSON.stringify(again.fullState())).toBe(JSON.stringify(game.fullState()));
    }
  });

  it('lets every player act once per step, with the first player rotating each step', () => {
    const config = multiConfig('medium', 3, 7);
    const game = createMultiGame(config);
    const actions = playRandom(game, new Rng(7));
    expect(actions.length).toBe(32 * 3);
    for (let k = 0; k < 32; k++) {
      const round = Math.floor(k / 8) + 1;
      const step = (k % 8) + 1;
      expect(actions.slice(k * 3, k * 3 + 3).map((a) => a.seat)).toEqual(seatOrder(3, round, step, 8));
      expect(actions[k * 3].seat).toBe(k % 3);
    }
    // Each step's player actions come after that step's single bot arrival.
    const events = game.fullState().events.filter((e): e is ActionEvent => e.kind === 'action');
    for (let k = 0; k < 32; k++) {
      const group = events.slice(k * 4, k * 4 + 4);
      expect(group.map((e) => e.taker)).toEqual(['bot', 'player', 'player', 'player']);
    }
  });

  it("reveals cards nobody holds first; only with 3–4 players are players' cards revealed, late", () => {
    for (let i = 0; i < 50; i++) {
      for (const seats of [2, 3, 4]) {
        const s = createMultiGame(multiConfig('easy', seats, hashSeed('reveal', i, seats))).fullState();
        const held = (p: number) => p < seats;
        const heldReveals = s.revealOrder.filter(held).length;
        expect(heldReveals).toBe(Math.max(0, 3 - (5 - seats)));
        // Unheld cards come first.
        const firstHeld = s.revealOrder.findIndex(held);
        if (firstHeld >= 0) expect(s.revealOrder.slice(firstHeld).every(held)).toBe(true);
        expect(new Set(s.revealOrder).size).toBe(3);
      }
    }
  });

  it('uses the same bots as a single-player game on the same seed, whatever the players do', () => {
    const seed = 4242;
    const config = multiConfig('hard', 4, seed);
    expect(drawTickets(config)).toEqual(drawTickets(makeConfig('hard', seed)));
    const a = createMultiGame(config);
    playRandom(a, new Rng(1));
    const b = createMultiGame(config);
    playRandom(b, new Rng(2));
    const types = (g: MultiGame) => g.fullState().botRecords.map((r) => [r.type, r.positions]);
    expect(types(a)).toEqual(types(b));
  });

  it("never shows a player anyone else's hidden card", () => {
    for (let i = 0; i < 40; i++) {
      const seats = 2 + (i % 3);
      const game = createMultiGame(
        multiConfig(ALL_DIFFICULTIES[i % 4], seats, hashSeed('seat-view', i), 300),
      );
      const rng = new Rng(i);
      playRandom(game, rng, rng.int(32 * seats));
      const full = game.fullState();
      const pub = game.publicView();
      const publicCards = new Set(full.revealed.map((r) => r.card));
      for (const c of cardIdsIn(JSON.stringify(pub))) expect(publicCards.has(c)).toBe(true);
      for (let seat = 0; seat < seats; seat++) {
        const view = game.seatView(seat);
        expect(view.privateCards).toEqual([{ position: seat, card: full.cards[seat] }]);
        const allowed = new Set([...publicCards, full.cards[seat]]);
        for (const c of cardIdsIn(JSON.stringify(view))) expect(allowed.has(c)).toBe(true);
        const mine = full.queue[0] === seat;
        if (!mine) expect(view.maxBuy + view.maxSell).toBe(0);
      }
    }
  });

  it('gives each player identical advice whatever the cards they cannot see', () => {
    /** Same information for `seat`, different everything-else. */
    const scramble = (full: MultiState, seat: number, rng: Rng): MultiState => {
      const visible = new Set<number>([seat, ...full.revealed.map((r) => r.position)]);
      const used = new Set<number>([...visible].map((p) => full.cards[p]));
      const pool = rng.shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i).filter((c) => !used.has(c)));
      const cards = full.cards.map((c, p) => (visible.has(p) ? c : pool.pop()!));
      return { ...full, cards, tickets: rng.shuffle([...full.tickets]) };
    };
    for (let i = 0; i < 60; i++) {
      const rng = new Rng(hashSeed('mp-nocheat', i));
      const seats = 2 + (i % 3);
      const game = createMultiGame(multiConfig(ALL_DIFFICULTIES[i % 4], seats, hashSeed('mp-game', i), 300));
      playRandom(game, rng, rng.int(32 * seats));
      const full = game.fullState();
      const seat = rng.int(seats);
      const other = scramble(full, seat, rng);
      const view = toSeatView(full, seat);
      expect(JSON.stringify(toSeatView(other, seat))).toBe(JSON.stringify(view));
      expect(JSON.stringify(toMultiPublicView(other))).toBe(JSON.stringify(toMultiPublicView(full)));
      const a = advise(view, { particles: 500 });
      const b = advise(toSeatView(other, seat), { particles: 500 });
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('rejects bad tables and out-of-turn replays', () => {
    expect(() => createMultiGame(makeMultiConfig('easy', 1, 1))).toThrow();
    expect(() => createMultiGame(makeMultiConfig('easy', 5, 1))).toThrow();
    const config = multiConfig('easy', 2, 3);
    expect(() =>
      replayMultiGame(config, [{ seat: 1, side: 'pass', size: 0 }], createMarketMaker(config)),
    ).toThrow(/out of turn/);
  });
});

describe('Hard-mode market maker with several players', () => {
  it("reads each player's trade with that player's own card position", () => {
    // A filter that knows four players (masks for positions 0..3) must treat a trade by seat 2 exactly as a
    // single-player filter whose player holds position 2.
    const quote = { bid: 33, ask: 37, bidSize: 5, askSize: 5 };
    const trade = (seat?: number): ActionEvent => ({
      kind: 'action',
      seq: 1,
      round: 1,
      step: 1,
      taker: 'player',
      side: 'buy',
      size: 2,
      price: 37,
      quote,
      ...(seat === undefined ? {} : { seat }),
    });
    const model = (masks: number[]) => ({ masks, beta: 0.5, base: 0.5 });
    const multi = new ParticleFilter({
      alpha: 0.35,
      seed: 9,
      particles: 3000,
      playerModel: model([1, 2, 4, 8]),
    });
    const single = new ParticleFilter({ alpha: 0.35, seed: 9, particles: 3000, playerModel: model([4]) });
    multi.observe(trade(2));
    single.observe(trade());
    expect(multi.mean()).toBeCloseTo(single.mean(), 12);
    expect(multi.mean()).toBeGreaterThan(35.5);
    expect(() => single.observe(trade(1))).toThrow(/seat 1/);
  });

  it("learns from every player's buying, not only the first player's", () => {
    // For each seat: the players before it pass (passes are ignored), then it buys 1 at the first step. A buy at
    // a price some one-card holders would pay is evidence of a high card, so the fair value rises.
    for (const seat of [0, 1, 2]) {
      const game = createMultiGame(multiConfig('hard', 3, 77, 2000));
      while (game.currentSeat !== seat) game.act({ side: 'pass', size: 0 });
      const before = game.marketMaker.fairValue();
      game.act({ side: 'buy', size: 1 });
      expect(game.marketMaker.fairValue()).toBeGreaterThan(before + 0.1);
    }
  });
});
