// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GameScreen } from '../src/components/GameScreen';
import { Rng } from '../src/engine/rng';
import type { Difficulty } from '../src/engine/types';
import { __engineForTests, useGame } from '../src/store/gameStore';
import { randomAction } from './helpers';

afterEach(() => {
  cleanup();
  useGame.getState().quit();
});

/** Every key path in the store snapshot (functions dropped), for structural checks. */
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

describe('no leak in the UI', () => {
  const cases: [Difficulty, number][] = [
    ['easy', 11],
    ['medium', 22],
    ['hard', 33],
    ['expert', 44],
  ];
  for (const [difficulty, seed] of cases) {
    it(`hidden cards are never in the store or the DOM before settlement (${difficulty})`, () => {
      act(() => useGame.getState().start({ difficulty, mode: 'practice', pacing: 'turn', seed }));
      const { container } = render(<GameScreen onPlayAgain={() => {}} />);
      const rng = new Rng(seed);
      let steps = 0;
      while (useGame.getState().status === 'playing') {
        const st = useGame.getState();
        const engine = __engineForTests()!.fullState();
        const view = st.view!;
        const visible = new Set([
          ...view.privateCards.map((c) => c.card),
          ...view.revealed.map((r) => r.card),
        ]);
        // (In Easy, round 4, your 2 cards plus 3 reveals are all five, so nothing is hidden any more.)
        const hidden = engine.cards.filter((c) => !visible.has(c));
        expect(hidden.length).toBe(5 - visible.size);

        // 1. Snapshot of the store: only visible cards, and none of the engine's hidden structures.
        const snapshot = JSON.stringify(st);
        for (const c of cardIdsIn(snapshot)) expect(visible.has(c)).toBe(true);
        const keys = keysOf(JSON.parse(snapshot));
        for (const k of ['cards', 'tickets', 'botRecords', 'revealOrder', 'settlement', 'seed', 'accounts']) {
          expect(keys.has(k)).toBe(false);
        }
        expect(st.settled).toBeNull();

        // 2. The DOM: every rendered card face is visible information.
        const rendered = [...container.querySelectorAll('[data-card]')].map((el) =>
          Number(el.getAttribute('data-card')),
        );
        expect(rendered.length).toBe(visible.size);
        for (const c of rendered) expect(visible.has(c)).toBe(true);
        expect(container.querySelectorAll('.pcard--back').length).toBe(5 - visible.size);

        act(() => st.act(randomAction(view, rng)));
        steps++;
      }
      expect(steps).toBe(32);
      // After settlement every card is public.
      const settled = useGame.getState().settled!;
      expect(settled.settlement.cards.length).toBe(5);
      expect(container.querySelectorAll('[data-card]').length).toBe(5);
    });
  }
});
