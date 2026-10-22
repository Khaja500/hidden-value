/**
 * Trade likelihoods for the belief model (spec §3).
 *
 * An informed bot sees the public reveals plus a random subset of 1–2 of the 5 positions, and values the asset at
 * E[V | those cards]. That valuation depends only on (number of distinct known cards n, their sum S), so it is
 * precomputed once in VAL[n·66 + S]. For a particle (a full assignment of the 5 cards) and a set of public reveals,
 * each of the 15 possible subsets maps to one table key; the chance an informed bot buys at `ask` is the
 * subset-weighted share of keys whose valuation exceeds the ask.
 */
import { expectedValue, HAND_SIZE, MAX_VALUE } from '../engine/cards';
import { INFORMED_K_PROBS } from '../engine/rules';
import type { ActionSide } from '../engine/types';

export const S_SPAN = MAX_VALUE + 1; // sums 0..65
export const N_KEYS = (HAND_SIZE + 1) * S_SPAN;

/** VAL[n·66 + S] = expected V for a trader who knows n distinct cards summing to S. */
export const VAL = new Float64Array(N_KEYS);
for (let n = 0; n <= HAND_SIZE; n++) {
  for (let s = 0; s < S_SPAN; s++) VAL[n * S_SPAN + s] = expectedValue(s, n);
}

/** The 15 position subsets an informed bot may see, as bitmasks, with their probabilities. */
export const N_SUBSETS = 15;
export const SUBSET_MASKS = new Uint8Array(N_SUBSETS);
export const SUBSET_WEIGHTS = new Float64Array(N_SUBSETS);
{
  let k = 0;
  for (let i = 0; i < HAND_SIZE; i++) {
    SUBSET_MASKS[k] = 1 << i;
    SUBSET_WEIGHTS[k++] = INFORMED_K_PROBS[0] / HAND_SIZE;
  }
  for (let i = 0; i < HAND_SIZE; i++) {
    for (let j = i + 1; j < HAND_SIZE; j++) {
      SUBSET_MASKS[k] = (1 << i) | (1 << j);
      SUBSET_WEIGHTS[k++] = INFORMED_K_PROBS[1] / 10;
    }
  }
}

/** Keys sorted by valuation, for fast "how much weight values the asset above x" queries. */
export const KEYS_BY_VAL = Uint16Array.from({ length: N_KEYS }, (_, i) => i).sort((a, b) => VAL[a] - VAL[b]);
export const SORTED_VALS = Float64Array.from(KEYS_BY_VAL, (k) => VAL[k]);

/** First index in SORTED_VALS whose value is > x. */
export function upperBound(x: number): number {
  let lo = 0;
  let hi = N_KEYS;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (SORTED_VALS[mid] > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First index in SORTED_VALS whose value is ≥ x. */
export function lowerBound(x: number): number {
  let lo = 0;
  let hi = N_KEYS;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (SORTED_VALS[mid] >= x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** How bot takers behave, as the belief model assumes. α may differ from the game's true α. */
export interface TraderModel {
  alpha: number;
}

export function traderModel(alpha: number): TraderModel {
  return { alpha };
}

/**
 * How a market maker that learns from the player models them (Hard mode): with probability β the player trades
 * on their private card(s) (buys if their valuation exceeds the ask), otherwise at random with probability `base`.
 * Only the player's trades are used; their passes are ignored. `masks[seat]` is the positions that player holds
 * (one entry in single-player games; one per player in multiplayer).
 */
export interface PlayerTakerModel {
  masks: number[];
  beta: number;
  base: number;
}

export const DEFAULT_PLAYER_BETA = 0.5;
export const DEFAULT_PLAYER_BASE = 0.5;

export function popcount5(m: number): number {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) + ((m >> 4) & 1);
}

/** Table key for a particle's cards (5 ranks at `vals[off..off+4]`) when the positions in `mask` are known. */
export function keyFor(vals: Uint8Array, off: number, mask: number): number {
  let s = 0;
  for (let p = 0; p < HAND_SIZE; p++) if (mask & (1 << p)) s += vals[off + p];
  return popcount5(mask) * S_SPAN + s;
}

/** Writes the 15 subset keys for one particle under a given public mask. */
export function writeKeys(
  vals: Uint8Array,
  off: number,
  publicMask: number,
  out: Uint16Array,
  outOff: number,
): void {
  for (let k = 0; k < N_SUBSETS; k++) out[outOff + k] = keyFor(vals, off, publicMask | SUBSET_MASKS[k]);
}

export interface QuoteFaced {
  bid: number | null;
  ask: number | null;
  bidOpen: boolean;
  askOpen: boolean;
  /** Chance a noise trader buys at this ask / sells at this bid (depends on public information only). */
  pNoiseBuy: number;
  pNoiseSell: number;
}

/** P(observed bot action | particle), from the particle's 15 subset keys. */
export function botLikelihood(
  keys: Uint16Array,
  off: number,
  side: ActionSide,
  q: QuoteFaced,
  m: TraderModel,
): number {
  let infBuy = 0;
  let infSell = 0;
  const ask = q.ask ?? Infinity;
  const bid = q.bid ?? -Infinity;
  for (let k = 0; k < N_SUBSETS; k++) {
    const v = VAL[keys[off + k]];
    if (v > ask) infBuy += SUBSET_WEIGHTS[k];
    else if (v < bid) infSell += SUBSET_WEIGHTS[k];
  }
  const pBuy = q.askOpen ? (1 - m.alpha) * q.pNoiseBuy + m.alpha * infBuy : 0;
  const pSell = q.bidOpen ? (1 - m.alpha) * q.pNoiseSell + m.alpha * infSell : 0;
  if (side === 'buy') return pBuy;
  if (side === 'sell') return pSell;
  return 1 - pBuy - pSell;
}

/** P(observed player trade | particle) under the player-taker model. Passes return 1 (ignored). */
export function playerLikelihood(
  playerKey: number,
  side: ActionSide,
  q: QuoteFaced,
  pm: PlayerTakerModel,
): number {
  const v = VAL[playerKey];
  if (side === 'buy') return (1 - pm.beta) * pm.base + pm.beta * (q.ask !== null && v > q.ask ? 1 : 0);
  if (side === 'sell') return (1 - pm.beta) * pm.base + pm.beta * (q.bid !== null && v < q.bid ? 1 : 0);
  return 1;
}
