/** Recomposing a quote from its explanation: the parts plus rounding must equal the posted prices. */
import type { QuoteExplanation } from '../engine/types';

export function composeBid(e: QuoteExplanation): number | null {
  if (e.bid === null) return null;
  return (
    e.fairValue +
    e.adverseSelection.bidOffset +
    e.learnedOffset +
    e.inventory.skew -
    e.riskHalfSpread -
    e.fixedHalfSpread +
    e.rounding.bid
  );
}

export function composeAsk(e: QuoteExplanation): number | null {
  if (e.ask === null) return null;
  return (
    e.fairValue +
    e.adverseSelection.askOffset +
    e.learnedOffset +
    e.inventory.skew +
    e.riskHalfSpread +
    e.fixedHalfSpread +
    e.rounding.ask
  );
}

/** Sum of the per-cause fair-value changes; equals fairValue − fairValueChange.from. */
export function reasonsTotal(e: QuoteExplanation): number {
  return e.fairValueChange.reasons.reduce((a, r) => a + r.delta, 0);
}

/** The spread split into its parts: adverse selection + risk + fixed + rounding = ask − bid. */
export function spreadParts(e: QuoteExplanation) {
  return {
    adverseSelection: e.adverseSelection.askOffset - e.adverseSelection.bidOffset,
    risk: 2 * e.riskHalfSpread,
    fixed: 2 * e.fixedHalfSpread,
    rounding: e.rounding.ask - e.rounding.bid,
  };
}
