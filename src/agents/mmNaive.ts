/** Easy-mode market maker: a fixed spread of 6 around the expected value given the public cards (spec §4.1). */
import { expectedValue, PRIOR_MEAN, rankOf } from '../engine/cards';
import type {
  Counterfactual,
  MarketEvent,
  MarketMaker,
  PublicView,
  Quote,
  QuoteExplanation,
} from '../engine/types';
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
  private readonly inventoryOverride: number | null;

  constructor(inventoryOverride: number | null = null) {
    this.inventoryOverride = inventoryOverride;
  }

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
    const inv = this.inventoryOverride ?? this.inventory;
    const { quote, rounding } = finishQuote(mu - NAIVE_HALF_SPREAD, mu + NAIVE_HALF_SPREAD, inv);
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
      inventory: { position: inv, skew: 0 },
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
    const cfs: Counterfactual[] = [];
    if ((this.inventoryOverride ?? this.inventory) !== 0) {
      cfs.push({
        if: 'inventory were 0',
        bid: flat.bid,
        ask: flat.ask,
        change: { kind: 'inventory', value: 0 },
      });
    }
    const trades = this.history.filter((e) => e.kind === 'action' && e.side !== 'pass');
    if (trades.length > 0) {
      const removed = trades.slice(-2);
      const replay = new NaiveMM(this.inventoryOverride);
      for (const e of this.history) if (!removed.includes(e)) replay.onEvent(e);
      const q = replay.quote(replayView(this.last.round, this.last.step));
      cfs.push({
        if: describeRemoval(removed),
        bid: q.bid,
        ask: q.ask,
        change: { kind: 'remove', seqs: removed.map((e) => e.seq) },
      });
    }
    return { ...this.last, counterfactuals: cfs };
  }
}

/** "the last 2 buys had not happened", "your last sell had not happened", "the last two trades (…) had not happened". */
export function describeRemoval(removed: MarketEvent[]): string {
  const acts = removed.filter((e) => e.kind === 'action');
  if (acts.length === 1) {
    const e = acts[0];
    return e.taker === 'player'
      ? `your last ${e.side} had not happened`
      : `the last ${e.side} had not happened`;
  }
  const sameSide = acts.every((e) => e.side === acts[0].side);
  if (sameSide && acts.every((e) => e.taker === 'bot'))
    return `the last ${acts.length} ${acts[0].side}s had not happened`;
  if (sameSide && acts.every((e) => e.taker === 'player'))
    return `your last ${acts.length} ${acts[0].side}s had not happened`;
  const label = (e: (typeof acts)[number]) => (e.taker === 'player' ? `your ${e.side}` : `a ${e.side}`);
  return `the last two trades (${acts.map(label).join(', then ')}) had not happened`;
}
