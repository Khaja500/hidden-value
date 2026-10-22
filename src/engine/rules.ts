/** Game rules and difficulty presets (spec §2). */
import type { Difficulty, GameConfig, MMKind, MMParams } from './types';

export const ROUNDS = 4;
export const STEPS_PER_ROUND = 8;

export const PLAYER_POSITION_LIMIT = 10;
export const PLAYER_MAX_TRADE = 3;
export const MM_POSITION_LIMIT = 25;
export const MM_MAX_QUOTE_SIZE = 5;
export const TICK = 0.5;
export const MIN_SPREAD = 1.0;

/** Noise traders want to buy or sell with these probabilities; they pass the rest of the time. */
export const NOISE_BUY_PROB = 0.4;
export const NOISE_SELL_PROB = 0.4;
/** Mean of a noise trader's exponential price tolerance, relative to the public-card expected value. */
export const NOISE_TOLERANCE_MEAN = 2;
/** Informed bots see 1 or 2 of the 5 hidden cards (chosen uniformly from all 5 positions), each with probability ½. */
export const INFORMED_K_PROBS: readonly [number, number] = [0.5, 0.5];
/** Bots trade 1–3 units, drawn the same way for noise and informed bots, so size carries no information. */
export const BOT_MAX_SIZE = 3;

export interface DifficultyPreset {
  label: string;
  playerCards: 1 | 2;
  alpha: number;
  mmKind: MMKind;
  mmLearnsFromPlayer: boolean;
  blurb: string;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyPreset> = {
  easy: {
    label: 'Easy',
    playerCards: 2,
    alpha: 0.1,
    mmKind: 'naive',
    mmLearnsFromPlayer: false,
    blurb: 'You see 2 cards. The market maker quotes a fixed spread around the public-card average.',
  },
  medium: {
    label: 'Medium',
    playerCards: 1,
    alpha: 0.25,
    mmKind: 'analytical',
    mmLearnsFromPlayer: false,
    blurb: 'You see 1 card. The market maker reads the bots’ order flow but ignores your trades.',
  },
  hard: {
    label: 'Hard',
    playerCards: 1,
    alpha: 0.35,
    mmKind: 'analytical',
    mmLearnsFromPlayer: true,
    blurb: 'More informed bots, and the market maker also learns from your trades.',
  },
  expert: {
    label: 'Expert',
    playerCards: 1,
    alpha: 0.35,
    mmKind: 'learned',
    mmLearnsFromPlayer: false,
    blurb: 'A market maker trained by simulation instead of designed by hand.',
  },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export function makeConfig(
  difficulty: Difficulty,
  seed: number,
  overrides: Partial<Omit<GameConfig, 'mm'>> & { mm?: MMParams } = {},
): GameConfig {
  const p = DIFFICULTIES[difficulty];
  return {
    seed: seed >>> 0,
    difficulty,
    rounds: ROUNDS,
    stepsPerRound: STEPS_PER_ROUND,
    alpha: p.alpha,
    playerCards: p.playerCards,
    mmKind: p.mmKind,
    mmLearnsFromPlayer: p.mmLearnsFromPlayer,
    ...overrides,
    mm: { ...(overrides.mm ?? {}) },
  };
}

/** A multiplayer table: the difficulty's α and market maker, with one card for each of `seats` players. */
export function makeMultiConfig(difficulty: Difficulty, seats: number, seed: number): GameConfig {
  return makeConfig(difficulty, seed, { playerCards: 1, seats });
}

export function roundToTick(x: number, dir: 'down' | 'up'): number {
  // Small epsilon so that values like 36.5000000001 do not round up a full tick.
  const eps = 1e-9;
  return dir === 'down' ? Math.floor(x / TICK + eps) * TICK : Math.ceil(x / TICK - eps) * TICK;
}
