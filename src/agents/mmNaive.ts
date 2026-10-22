/** Easy-mode market maker: a fixed spread of 6 around the expected value given the public cards (spec §4.1). */
import { expectedValue, PRIOR_MEAN, rankOf } from '../engine/cards';
import type { MarketEvent, MarketMaker, PublicView, Quote, QuoteExplanation } from '../engine/types';
import { finishQuote, replayView } from './quoting';

export const NAIVE_HALF_SPREAD = 3;

export class NaiveMM implements MarketMaker {
  readonly kind = 'naive' as const;
  private knownSum = 0;
  private nKnown = 0;
  private inventory = 0;
  private roundFrom = PRIOR_MEAN;
  private lastReveal: { card: number; delta: number } | null = null;
  private last: QuoteExplanation | null = null;
  private history: MarketEvent[] = [];

  onEvent(e: MarketEvent): void {
    this.history.push(e);
    if (e.kind === 'reveal') {
      const before = this.fairValue();
      this.roundFrom = before;
      this.knownSum += rankOf(e.card);
      this.nKnown += 1;
      this.lastReveal = { card: e.card, delta: this.fairValue() - before };
    } else if (e.side !== 'pass') {
      // The taker's trade is the MM's opposite trade.
      this.inventory += e.side === 'buy' ? -e.size : e.size;
    }
  }

  fairValue(): number {
    return expectedValue(this.knownSum, this.nKnown);
  }

  quote(view: PublicView): Quote {
    const mu = this.fairValue();
    const { quote, rounding } = finishQuote(mu - NAIVE_HALF_SPREAD, mu + NAIVE_HALF_SPREAD, this.inventory);
    this.last = {
      mmKind: 'naive',
      round: view.round,
      step: view.step,
      fairValue: mu,
      fairValueChange: {
        from: this.roundFrom,
        reasons: this.lastReveal
          ? [{ cause: 'reveal', card: this.lastReveal.card, delta: this.lastReveal.delta }]
          : [],
      },
      adverseSelection: { bidOffset: 0, askOffset: 0 },
      inventory: { position: this.inventory, skew: 0 },
      riskHalfSpread: 0,
      fixedHalfSpread: NAIVE_HALF_SPREAD,
      learnedOffset: 0,
      rounding,
      bid: quote.bid,
      ask: quote.ask,
      bidSize: quote.bidSize,
      askSize: quote.askSize,
      counterfactuals: [],
    };
    return quote;
  }

  explain(opts: { counterfactuals?: boolean } = {}): QuoteExplanation {
    if (!this.last) throw new Error('No quote to explain yet');
    if (opts.counterfactuals === false) return this.last;
    const mu = this.last.fairValue;
    const flat = finishQuote(mu - NAIVE_HALF_SPREAD, mu + NAIVE_HALF_SPREAD, 0).quote;
    const cfs = [];
    if (this.inventory !== 0) cfs.push({ if: 'inventory were 0', bid: flat.bid, ask: flat.ask });
    const trades = this.history.filter((e) => e.kind === 'action' && e.side !== 'pass');
    if (trades.length > 0) {
      const removed = trades.slice(-2);
      const replay = new NaiveMM();
      for (const e of this.history) if (!removed.includes(e)) replay.onEvent(e);
      const q = replay.quote(replayView(this.last.round, this.last.step));
      cfs.push({ if: describeRemoval(removed), bid: q.bid, ask: q.ask });
    }
    return { ...this.last, counterfactuals: cfs };
  }
}

export function describeRemoval(removed: MarketEvent[]): string {
  const parts = removed.map((e) =>
    e.kind === 'action' ? `${e.taker === 'player' ? 'your ' : ''}${e.side} of ${e.size}` : 'reveal',
  );
  if (removed.length === 1) return `the last trade (${parts[0]}) had not happened`;
  return `the last ${removed.length} trades (${parts.join(', ')}) had not happened`;
}
