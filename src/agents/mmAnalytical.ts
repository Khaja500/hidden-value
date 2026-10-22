/**
 * The analytical market maker (spec §4.2). Every quote is built from named parts:
 *   A. fair value μ from the particle filter (public cards + order flow),
 *   B. a Glosten–Milgrom adverse-selection spread: ask = E[V | next taker buys], bid = E[V | next taker sells],
 *   C. an Avellaneda–Stoikov style inventory skew −γ·q·Var(V) and a risk half-spread c·γ·Var(V),
 * then rounded outward to the 0.5 tick with a 1.0 minimum spread.
 */
import { DEFAULT_PLAYER_BASE, DEFAULT_PLAYER_BETA } from '../belief/likelihoods';
import { ParticleFilter } from '../belief/particleFilter';
import { rankOf } from '../engine/cards';
import { hashSeed } from '../engine/rng';
import type {
  Counterfactual,
  FairValueReason,
  GameConfig,
  MarketEvent,
  MarketMaker,
  PublicView,
  Quote,
  QuoteExplanation,
} from '../engine/types';
import { seatPositions } from '../engine/views';
import { finishQuote, replayView } from './quoting';
import { describeRemoval } from './mmNaive';

export const DEFAULT_GAMMA = 0.01;
export const DEFAULT_RISK_COEF = 3;

export interface AnalyticalSettings {
  alpha: number;
  gamma: number;
  riskCoef: number;
  particles?: number;
  seed: number;
  /** Masks of each player's private positions, by seat, when the MM learns from the players' trades (Hard). */
  playerMasks: number[] | null;
  disableSkew: boolean;
  disableAdverseSelection: boolean;
  disableRiskSpread: boolean;
  /** Counterfactual "what if my inventory were x": trades no longer move the inventory used for quoting. */
  inventoryOverride: number | null;
}

export function analyticalSettings(config: GameConfig): AnalyticalSettings {
  const m = config.mm;
  const masks = seatPositions(config).map((ps) => ps.reduce((a, p) => a | (1 << p), 0));
  return {
    alpha: m.assumedAlpha ?? config.alpha,
    gamma: m.gamma ?? DEFAULT_GAMMA,
    riskCoef: m.riskCoef ?? DEFAULT_RISK_COEF,
    particles: m.particles,
    seed: hashSeed(config.seed, 'mm'),
    playerMasks: config.mmLearnsFromPlayer ? masks : null,
    disableSkew: !!m.disableSkew,
    disableAdverseSelection: !!m.disableAdverseSelection,
    disableRiskSpread: !!m.disableRiskSpread,
    inventoryOverride: m.inventoryOverride ?? null,
  };
}

interface FlowTally {
  delta: number;
  buys: number;
  sells: number;
  passes: number;
}

function emptyTally(): FlowTally {
  return { delta: 0, buys: 0, sells: 0, passes: 0 };
}

export class AnalyticalMM implements MarketMaker {
  readonly kind = 'analytical' as const;
  readonly settings: AnalyticalSettings;
  private readonly filter: ParticleFilter;
  private inventory = 0;
  private readonly history: MarketEvent[] = [];
  private roundFrom: number;
  private reveal: { card: number; delta: number } | null = null;
  private botFlow = emptyTally();
  private playerFlow = emptyTally();
  private last: QuoteExplanation | null = null;

  constructor(settings: AnalyticalSettings) {
    this.settings = settings;
    this.filter = new ParticleFilter({
      alpha: settings.alpha,
      seed: settings.seed,
      particles: settings.particles,
      playerModel:
        settings.playerMasks === null
          ? null
          : { masks: settings.playerMasks, beta: DEFAULT_PLAYER_BETA, base: DEFAULT_PLAYER_BASE },
    });
    this.roundFrom = this.filter.mean();
  }

  get beliefs(): ParticleFilter {
    return this.filter;
  }

  get position(): number {
    return this.settings.inventoryOverride ?? this.inventory;
  }

  fairValue(): number {
    return this.filter.mean();
  }

  onEvent(e: MarketEvent): void {
    this.history.push(e);
    const before = this.filter.mean();
    if (e.kind === 'reveal') {
      this.roundFrom = before;
      this.botFlow = emptyTally();
      this.playerFlow = emptyTally();
      this.filter.reveal(e.position, rankOf(e.card));
      this.reveal = { card: e.card, delta: this.filter.mean() - before };
      return;
    }
    if (e.side !== 'pass') this.inventory += e.side === 'buy' ? -e.size : e.size;
    this.filter.observe(e);
    const tally = e.taker === 'bot' ? this.botFlow : this.playerFlow;
    tally.delta += this.filter.mean() - before;
    if (e.side === 'buy') tally.buys++;
    else if (e.side === 'sell') tally.sells++;
    else tally.passes++;
  }

  /** The quote the MM would post with its current beliefs and a given inventory. */
  private build(q: number) {
    const s = this.settings;
    const mu = this.filter.mean();
    const variance = this.filter.variance();
    const gm = s.disableAdverseSelection ? { bid: mu, ask: mu } : this.filter.glostenMilgrom();
    const bidOffset = gm.bid - mu;
    const askOffset = gm.ask - mu;
    const skew = s.disableSkew ? 0 : -s.gamma * q * variance;
    const risk = s.disableRiskSpread ? 0 : s.riskCoef * s.gamma * variance;
    const rawBid = mu + bidOffset + skew - risk;
    const rawAsk = mu + askOffset + skew + risk;
    const finished = finishQuote(rawBid, rawAsk, q);
    return { mu, bidOffset, askOffset, skew, risk, ...finished };
  }

  quote(view: PublicView): Quote {
    const q = this.position;
    const b = this.build(q);
    const reasons: FairValueReason[] = [];
    if (this.reveal) reasons.push({ cause: 'reveal', card: this.reveal.card, delta: this.reveal.delta });
    const bf = this.botFlow;
    if (bf.buys + bf.sells + bf.passes > 0) {
      reasons.push({ cause: 'orderFlow', detail: flowDetail(bf, 'this round'), delta: bf.delta });
    }
    const pf = this.playerFlow;
    if (this.settings.playerMasks !== null && pf.buys + pf.sells > 0) {
      const from =
        this.settings.playerMasks.length > 1 ? 'from the players this round' : 'from you this round';
      reasons.push({ cause: 'playerFlow', detail: flowDetail(pf, from), delta: pf.delta });
    }
    this.last = {
      mmKind: 'analytical',
      round: view.round,
      step: view.step,
      fairValue: b.mu,
      fairValueChange: { from: this.roundFrom, reasons },
      adverseSelection: { bidOffset: b.bidOffset, askOffset: b.askOffset },
      inventory: { position: q, skew: b.skew },
      riskHalfSpread: b.risk,
      fixedHalfSpread: 0,
      learnedOffset: 0,
      rounding: b.rounding,
      bid: b.quote.bid,
      ask: b.quote.ask,
      bidSize: b.quote.bidSize,
      askSize: b.quote.askSize,
      counterfactuals: [],
    };
    return b.quote;
  }

  explain(opts: { counterfactuals?: boolean } = {}): QuoteExplanation {
    if (!this.last) throw new Error('No quote to explain yet');
    if (opts.counterfactuals === false) return this.last;
    const cfs: Counterfactual[] = [];
    if (this.position !== 0) {
      // Inventory does not affect beliefs, so the flat quote uses the same filter state as a full replay would.
      const flat = this.build(0).quote;
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
      const replay = new AnalyticalMM(this.settings);
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

function flowDetail(t: FlowTally, suffix: string): string {
  const parts = [];
  if (t.buys) parts.push(`${t.buys} buy${t.buys > 1 ? 's' : ''}`);
  if (t.sells) parts.push(`${t.sells} sell${t.sells > 1 ? 's' : ''}`);
  if (t.passes) parts.push(`${t.passes} pass${t.passes > 1 ? 'es' : ''}`);
  return `${parts.join(', ')} ${suffix}`;
}
