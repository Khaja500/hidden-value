/** Builds the market maker for a game config, and games with their market maker. */
import { Game, type GameHooks } from '../engine/game';
import type { GameConfig, MarketMaker } from '../engine/types';
import type { LearnedModel } from './learnedPolicy';
import learnedWeights from './learned-weights.json';
import { AnalyticalMM, analyticalSettings } from './mmAnalytical';
import { LearnedMM } from './mmLearned';
import { NaiveMM } from './mmNaive';

/** The trained Expert-mode policy (written by `npm run train`). */
export const LEARNED_MODEL = learnedWeights as LearnedModel;

export function createMarketMaker(config: GameConfig): MarketMaker {
  switch (config.mmKind) {
    case 'naive':
      return new NaiveMM(config.mm.inventoryOverride ?? null);
    case 'analytical':
      return new AnalyticalMM(analyticalSettings(config));
    case 'learned':
      return new LearnedMM(LEARNED_MODEL, config.mm.inventoryOverride ?? null);
  }
}

export function createGame(config: GameConfig, hooks: GameHooks = {}): Game {
  return new Game(config, createMarketMaker(config), hooks);
}
