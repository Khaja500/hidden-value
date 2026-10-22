/** Cards are integers 0..51. Rank (value) is 1..13 (Ace = 1, King = 13); suit is 0..3. */
import type { Card } from './types';

export const DECK_SIZE = 52;
export const RANKS = 13;
export const HAND_SIZE = 5;
/** Sum of all card values in the deck: 4 × (1 + … + 13). */
export const DECK_TOTAL = 364;
export const DECK_MEAN = DECK_TOTAL / DECK_SIZE; // 7
/** Population variance of one card's value: (13² − 1) / 12. */
export const CARD_VARIANCE = 14;
export const PRIOR_MEAN = HAND_SIZE * DECK_MEAN; // 35
/** Variance of the sum of 5 cards drawn without replacement: 5 × 14 × 47/51. */
export const PRIOR_VARIANCE = (HAND_SIZE * CARD_VARIANCE * (DECK_SIZE - HAND_SIZE)) / (DECK_SIZE - 1);
export const MIN_VALUE = 5;
export const MAX_VALUE = 65;

export function rankOf(card: Card): number {
  return (card % RANKS) + 1;
}

export function suitOf(card: Card): number {
  return Math.floor(card / RANKS);
}

const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_NAMES = [
  '',
  'Ace',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Jack',
  'Queen',
  'King',
];
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

export function rankLabel(rank: number): string {
  return RANK_LABELS[rank];
}

export function rankName(rank: number): string {
  return RANK_NAMES[rank];
}

export function cardLabel(card: Card): string {
  return `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
}

export function cardName(card: Card): string {
  return `${RANK_NAMES[rankOf(card)]} of ${SUIT_NAMES[suitOf(card)]}`;
}

export function isRedSuit(card: Card): boolean {
  const s = suitOf(card);
  return s === 1 || s === 2;
}

/**
 * Expected value of the 5-card sum for someone who knows `nKnown` of the hidden cards with value sum `knownSum`.
 * Each unknown card is a uniform draw from the 52 − nKnown cards they have not seen, whose total is 364 − knownSum.
 */
export function expectedValue(knownSum: number, nKnown: number): number {
  const unknown = HAND_SIZE - nKnown;
  if (unknown === 0) return knownSum;
  return knownSum + (unknown * (DECK_TOTAL - knownSum)) / (DECK_SIZE - nKnown);
}

/** Mean and variance of V for someone who knows exactly the given card values (and nothing about order flow). */
export function conditionalMoments(knownRanks: readonly number[]): { mean: number; variance: number } {
  const n = knownRanks.length;
  const unknown = HAND_SIZE - n;
  const knownSum = knownRanks.reduce((a, b) => a + b, 0);
  if (unknown === 0) return { mean: knownSum, variance: 0 };
  const counts = new Array<number>(RANKS + 1).fill(4);
  for (const r of knownRanks) counts[r]--;
  const m = DECK_SIZE - n;
  let s1 = 0;
  let s2 = 0;
  for (let r = 1; r <= RANKS; r++) {
    s1 += counts[r] * r;
    s2 += counts[r] * r * r;
  }
  const mu = s1 / m;
  const sigma2 = s2 / m - mu * mu;
  const variance = (unknown * sigma2 * (m - unknown)) / (m - 1);
  return { mean: knownSum + unknown * mu, variance };
}
