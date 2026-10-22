import { describe, expect, it } from 'vitest';
import { createMarketMaker } from '../src/agents/factory';
import { replayGame } from '../src/engine/game';
import { ALL_DIFFICULTIES, configFor, playRandomGame } from './helpers';

describe('deterministic replays', () => {
  for (const difficulty of ALL_DIFFICULTIES) {
    it(`same seed + same actions gives an identical log (${difficulty})`, () => {
      for (let seed = 100; seed < 115; seed++) {
        const config = configFor(difficulty, seed);
        const { game, actions } = playRandomGame(config, seed);
        const replay = replayGame(config, actions, createMarketMaker(config));
        expect(replay.phase).toBe('settled');
        expect(JSON.stringify(replay.fullState())).toBe(JSON.stringify(game.fullState()));
      }
    });
  }

  it('different seeds deal different cards', () => {
    const a = playRandomGame(configFor('medium', 1), 1).game.fullState().cards;
    const b = playRandomGame(configFor('medium', 2), 1).game.fullState().cards;
    expect(a).not.toEqual(b);
  });
});
