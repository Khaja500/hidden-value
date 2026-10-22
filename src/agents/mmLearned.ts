/**
 * Expert-mode market maker: a small policy trained by simulation (spec §6). It quotes
 *   centre = public expected value + learned offset,  half-spread = learned (softplus),
 * from public features only. Its explanation uses a linear model distilled from the policy, labelled with its
 * fidelity (exact for the linear variant).
 */
import { conditionalMoments, expectedValue, PRIOR_MEAN, rankOf } from '../engine/cards';
import type {
  Counterfactual,
  LearnedContribution,
  MarketEvent,
  MarketMaker,
  PublicView,
  Quote,
  QuoteExplanation,
} from '../engine/types';
import { features, FEATURE_NAMES, forward, type FeatureInputs, type LearnedModel } from './learnedPolicy';
import { describeRemoval } from './mmNaive';
import { finishQuote, replayView } from './quoting';

export class LearnedMM implements MarketMaker {
  readonly kind = 'learned' as const;
  readonly model: LearnedModel;
  private readonly inventoryOverride: number | null;
  private inventory = 0;
  private readonly revealedRanks: number[] = [];
  private publicVariance = conditionalMoments([]).variance;
  private readonly botSides: number[] = [];
  private readonly history: MarketEvent[] = [];
  private roundFrom = PRIOR_MEAN;
  private lastReveal: { card: number; delta: number } | null = null;
  private last: QuoteExplanation | null = null;
  private lastInputs: FeatureInputs | null = null;

  constructor(model: LearnedModel, inventoryOverride: number | null = null) {
    this.model = model;
    this.inventoryOverride = inventoryOverride;
  }

  get position(): number {
    return this.inventoryOverride ?? this.inventory;
  }

  fairValue(): number {
    return expectedValue(
      this.revealedRanks.reduce((a, b) => a + b, 0),
      this.revealedRanks.length,
    );
  }

  onEvent(e: MarketEvent): void {
    this.history.push(e);
    if (e.kind === 'reveal') {
      const before = this.fairValue();
      this.roundFrom = before;
      this.revealedRanks.push(rankOf(e.card));
      this.publicVariance = conditionalMoments(this.revealedRanks).variance;
      this.lastReveal = { card: e.card, delta: this.fairValue() - before };
      return;
    }
    if (e.side !== 'pass') this.inventory += e.side === 'buy' ? -e.size : e.size;
    if (e.taker === 'bot') this.botSides.push(e.side === 'buy' ? 1 : e.side === 'sell' ? -1 : 0);
  }

  private imbalance(n: number): number {
    let s = 0;
    for (let i = Math.max(0, this.botSides.length - n); i < this.botSides.length; i++) s += this.botSides[i];
    return s;
  }

  inputs(round: number, step: number, q = this.position): FeatureInputs {
    return {
      publicEV: this.fairValue(),
      nRevealed: this.revealedRanks.length,
      publicVariance: this.publicVariance,
      inventory: q,
      imbalance3: this.imbalance(3),
      imbalance8: this.imbalance(8),
      round,
      step,
    };
  }

  private build(inp: FeatureInputs) {
    const x = features(inp);
    const { offset, halfSpread } = forward(this.model.variant, this.model.params, x);
    const mu = inp.publicEV;
    return {
      x,
      mu,
      offset,
      halfSpread,
      ...finishQuote(mu + offset - halfSpread, mu + offset + halfSpread, inp.inventory),
    };
  }

  quote(view: PublicView): Quote {
    const inp = this.inputs(view.round, view.step);
    this.lastInputs = inp;
    const b = this.build(inp);
    const d = this.model.distilled;
    const raw = [
      inp.publicEV,
      inp.nRevealed,
      inp.inventory,
      inp.inventory * inp.publicVariance,
      inp.imbalance3,
      inp.imbalance8,
      inp.round,
      inp.step,
    ];
    const contributions: LearnedContribution[] = FEATURE_NAMES.map((feature, j) => ({
      feature,
      value: raw[j],
      offset: d.offset[j] * b.x[j],
      halfSpread: d.halfSpread[j] * b.x[j],
    }));
    this.last = {
      mmKind: 'learned',
      round: view.round,
      step: view.step,
      fairValue: b.mu,
      fairValueChange: {
        from: this.roundFrom,
        reasons: this.lastReveal
          ? [{ cause: 'reveal', card: this.lastReveal.card, delta: this.lastReveal.delta }]
          : [],
      },
      adverseSelection: { bidOffset: 0, askOffset: 0 },
      inventory: { position: inp.inventory, skew: 0 },
      riskHalfSpread: 0,
      fixedHalfSpread: b.halfSpread,
      learnedOffset: b.offset,
      rounding: b.rounding,
      bid: b.quote.bid,
      ask: b.quote.ask,
      bidSize: b.quote.bidSize,
      askSize: b.quote.askSize,
      counterfactuals: [],
      learned: {
        fidelity: this.model.fidelity,
        contributions,
        distilledOffset: d.offsetIntercept + contributions.reduce((a, c) => a + c.offset, 0),
        distilledHalfSpread: d.halfSpreadIntercept + contributions.reduce((a, c) => a + c.halfSpread, 0),
        inventoryPerUnit: d.offset[2] / 10 + (d.offset[3] * inp.publicVariance) / 650,
      },
    };
    return b.quote;
  }

  explain(opts: { counterfactuals?: boolean } = {}): QuoteExplanation {
    if (!this.last || !this.lastInputs) throw new Error('No quote to explain yet');
    if (opts.counterfactuals === false) return this.last;
    const cfs: Counterfactual[] = [];
    if (this.position !== 0) {
      const flat = this.build({ ...this.lastInputs, inventory: 0 }).quote;
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
      const replay = new LearnedMM(this.model, this.inventoryOverride);
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
