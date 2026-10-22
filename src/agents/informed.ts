/**
 * Informed traders see 1–2 of the 5 hidden cards plus the public reveals. They value the asset at its expected
 * value given those cards and trade whenever that valuation is outside the quote. They ignore order flow.
 */
import { expectedValue, rankOf } from '../engine/cards';
import type { ActionSide, Card, Quote } from '../engine/types';

/** Expected V for a trader who knows the cards at `known` positions (duplicates allowed). */
export function valuationFromPositions(cards: readonly Card[], known: Iterable<number>): number {
  const seen = new Set<number>();
  let sum = 0;
  for (const p of known) {
    if (seen.has(p)) continue;
    seen.add(p);
    sum += rankOf(cards[p]);
  }
  return expectedValue(sum, seen.size);
}

export function informedDecision(valuation: number, quote: Quote): ActionSide {
  if (quote.ask !== null && quote.askSize > 0 && valuation > quote.ask) return 'buy';
  if (quote.bid !== null && quote.bidSize > 0 && valuation < quote.bid) return 'sell';
  return 'pass';
}
