// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import type { Difficulty } from '../src/engine/types';
import { Party } from '../src/pages/Party';
import { __partyEngineForTests, useParty } from '../src/store/partyStore';
import { randomAction } from './helpers';

afterEach(() => {
  cleanup();
  useParty.getState().quit();
});

function keysOf(x: unknown, out = new Set<string>()): Set<string> {
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}

function cardIdsIn(json: string): number[] {
  return [...json.matchAll(/"card":(\d+)/g)].map((m) => Number(m[1]));
}

describe('no leak on the shared screen', () => {
  const cases: [Difficulty, number, number][] = [
    ['easy', 2, 11],
    ['hard', 3, 22],
    ['expert', 4, 33],
  ];
  for (const [difficulty, seats, seed] of cases) {
    it(`shows nobody's card during hand-offs, and only the current player's during a turn (${seats} players, ${difficulty})`, () => {
      const names = ['Ada', 'Ben', 'Cy', 'Di'].slice(0, seats);
      act(() => useParty.getState().start({ names, difficulty, advisorOn: true }, seed));
      const { container } = render(<Party />);
      const rng = new Rng(seed);
      let turns = 0;
      while (useParty.getState().status === 'playing') {
        const engine = __partyEngineForTests()!.fullState();
        const publicCards = new Set(engine.revealed.map((r) => r.card));
        const seat = engine.queue[0];

        // Hand-off: only public cards anywhere in the store or on screen.
        let st = useParty.getState();
        expect(st.stage).toBe('handoff');
        expect(st.seatView).toBeNull();
        for (const c of cardIdsIn(JSON.stringify(st))) expect(publicCards.has(c)).toBe(true);
        const keys = keysOf(JSON.parse(JSON.stringify(st)));
        for (const k of ['cards', 'tickets', 'botRecords', 'revealOrder', 'settlement', 'seed', 'players']) {
          expect(keys.has(k)).toBe(false);
        }
        const faces = () =>
          [...container.querySelectorAll('[data-card]')].map((el) => Number(el.getAttribute('data-card')));
        for (const c of faces()) expect(publicCards.has(c)).toBe(true);
        expect(container.querySelectorAll('[data-role="private"]').length).toBe(0);

        // The player's turn: their own card is added, nobody else's.
        act(() => useParty.getState().showTurn());
        st = useParty.getState();
        expect(st.stage).toBe('turn');
        expect(st.seatView!.seat).toBe(seat);
        const allowed = new Set([...publicCards, engine.cards[seat]]);
        for (const c of cardIdsIn(JSON.stringify(st))) expect(allowed.has(c)).toBe(true);
        for (const c of faces()) expect(allowed.has(c)).toBe(true);
        expect(container.querySelectorAll('[data-role="private"]').length).toBe(1);

        if (turns % 7 === 0) act(() => useParty.getState().askAdvisor());
        act(() => useParty.getState().act(randomAction(useParty.getState().seatView!, rng)));
        turns++;
      }
      expect(turns).toBe(32 * seats);
      // After settlement every card is public and labelled.
      const st = useParty.getState();
      expect(st.result!.settlement.cards.length).toBe(5);
      expect(container.querySelectorAll('.party__cards [data-card]').length).toBe(5);
      const total =
        st.result!.settlement.pnl.players.reduce((a, b) => a + b, 0) +
        st.result!.settlement.pnl.mm +
        st.result!.settlement.pnl.noise +
        st.result!.settlement.pnl.informed;
      expect(Math.abs(total)).toBeLessThan(1e-9);
      // Standings: best first, and each player's expected edge is the sum of their graded trades.
      const s = st.result!.standings;
      for (let i = 1; i < s.length; i++) expect(s[i - 1].pnl).toBeGreaterThanOrEqual(s[i].pnl);
      for (const p of s) {
        const mine = st.result!.trades.filter((t) => t.seat === p.seat);
        expect(p.expected).toBeCloseTo(
          mine.reduce((a, t) => a + t.expected, 0),
          9,
        );
        expect(p.pnl).toBeCloseTo(
          mine.reduce((a, t) => a + t.actual, 0),
          9,
        );
      }
    });
  }
});
