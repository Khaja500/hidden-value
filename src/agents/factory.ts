/** Builds the market maker for a game config, and games with their market maker. */
import { Game, type GameHooks } from '../engine/game';
import type { GameConfig, MarketMaker } from '../engine/types';
import { NaiveMM } from './mmNaive';

export function createMarketMaker(config: GameConfig): MarketMaker {
  switch (config.mmKind) {
    case 'naive':
      return new NaiveMM();
    default:
      // Placeholder until the analytical and learned market makers exist.
      return new NaiveMM();
  }
}

export function createGame(config: GameConfig, hooks: GameHooks = {}): Game {
  return new Game(config, createMarketMaker(config), hooks);
}
