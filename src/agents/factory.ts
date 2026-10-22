/** Builds the market maker for a game config, and games with their market maker. */
import { Game, type GameHooks } from '../engine/game';
import type { GameConfig, MarketMaker } from '../engine/types';
import { AnalyticalMM, analyticalSettings } from './mmAnalytical';
import { NaiveMM } from './mmNaive';

export function createMarketMaker(config: GameConfig): MarketMaker {
  switch (config.mmKind) {
    case 'naive':
      return new NaiveMM(config.mm.inventoryOverride ?? null);
    case 'analytical':
      return new AnalyticalMM(analyticalSettings(config));
    default:
      // Placeholder until the learned market maker exists.
      return new NaiveMM();
  }
}

export function createGame(config: GameConfig, hooks: GameHooks = {}): Game {
  return new Game(config, createMarketMaker(config), hooks);
}
