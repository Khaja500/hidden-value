import { createGame } from '../src/agents/factory';
import type { Game } from '../src/engine/game';
import { makeConfig } from '../src/engine/rules';
import { Rng } from '../src/engine/rng';
import type { Difficulty, GameConfig, PlayerAction, PlayerView } from '../src/engine/types';

/** A random legal action: pass, or buy/sell 1..max. */
export function randomAction(view: PlayerView, rng: Rng): PlayerAction {
  const u = rng.next();
  if (u < 0.35 && view.maxBuy > 0) return { side: 'buy', size: 1 + rng.int(view.maxBuy) };
  if (u < 0.7 && view.maxSell > 0) return { side: 'sell', size: 1 + rng.int(view.maxSell) };
  return { side: 'pass', size: 0 };
}

export function playRandomGame(
  config: GameConfig,
  actionSeed: number,
): { game: Game; actions: PlayerAction[] } {
  const game = createGame(config);
  const rng = new Rng(actionSeed);
  const actions: PlayerAction[] = [];
  while (game.phase !== 'settled') {
    const a = randomAction(game.view(), rng);
    actions.push(a);
    game.act(a);
  }
  return { game, actions };
}

export const ALL_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export function configFor(difficulty: Difficulty, seed: number): GameConfig {
  return makeConfig(difficulty, seed);
}
