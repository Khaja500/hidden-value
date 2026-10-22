/**
 * The Advisor (spec §5): tells the player when to buy at the ask, sell at the bid, or hold, how much, and why.
 *
 * Its only input is a PlayerView. It keeps two particle filters fed from the view's event log: one that knows the
 * player's private card(s), and one that does not (for attribution). Filters are synced incrementally when the
 * view extends what was already processed, and rebuilt otherwise; both paths give identical results, because a
 * filter's state is a deterministic function of its seed and the events it has seen. Seeds come from visible
 * information only.
 */
import { ParticleFilter } from '../belief/particleFilter';
import { expectedValue, MAX_VALUE, rankOf } from '../engine/cards';
import { quoteMid } from '../engine/events';
import { hashSeed } from '../engine/rng';
import type { ActionEvent, PlayerView, PublicEvent } from '../engine/types';
import { attribute, type Attribution } from '../explain/attribution';

export interface AdvisorParams {
  /** Required edge, as a multiple of the estimate's SD. */
  theta: number;
  /** Required probability that the trade ends up profitable. */
  pMin: number;
  /** Sizing constant: size = clamp(round(k · edge / Var), 1, 3). */
  k: number;
  particles?: number;
}

export const DEFAULT_ADVISOR_PARAMS: AdvisorParams = { theta: 0.15, pMin: 0.65, k: 50 };

export type AdviceAction = 'buy' | 'sell' | 'hold';

export interface Advice {
  action: AdviceAction;
  size: number;
  price: number | null;
  /** Round-4 recommendation to close a position whose edge turned negative. */
  closing: boolean;
  round: number;
  step: number;
  estimate: { mean: number; sd: number };
  buyEdge: number | null;
  buyProb: number | null;
  sellEdge: number | null;
  sellProb: number | null;
  /** Edge needed to act: θ × SD. */
  minEdge: number;
  pMin: number;
  maxBuy: number;
  maxSell: number;
  position: number;
  positionAfter: number;
  /** The MM's inventory, which is public: it is minus the takers' net buying in the trade feed. */
  mmPosition: number;
  attribution: Attribution;
  /** Loss per unit if V lands at a plausible bad outcome (20th / 80th percentile). */
  risk: { value: number; lossPerUnit: number } | null;
  flow: { buys: number; sells: number; passes: number };
  /** Hard mode: the MM is adjusting to the player's trades. */
  warning: { side: 'buy' | 'sell'; count: number; midMove: number } | null;
  /** P(V = v), v = 0..65, for the belief histogram. */
  distribution: number[];
}

function eventSignature(e: PublicEvent): string {
  return JSON.stringify(e);
}

function gameKey(view: PlayerView): string {
  return JSON.stringify([view.config, view.privateCards]);
}

export class Advisor {
  readonly params: AdvisorParams;
  private key: string | null = null;
  private withPrivate!: ParticleFilter;
  private withoutPrivate!: ParticleFilter;
  private processed = 0;
  private lastSignature = '';
  private flow = { buys: 0, sells: 0, passes: 0 };

  constructor(params: Partial<AdvisorParams> = {}) {
    this.params = { ...DEFAULT_ADVISOR_PARAMS, ...params };
  }

  private reset(view: PlayerView): void {
    const cardsSeed = view.privateCards.map((c) => c.card).join(',');
    const known = view.privateCards.map((c) => ({ position: c.position, rank: rankOf(c.card) }));
    const alpha = view.config.alpha;
    const particles = this.params.particles;
    this.withPrivate = new ParticleFilter({ alpha, particles, known, seed: hashSeed('advisor', cardsSeed) });
    this.withoutPrivate = new ParticleFilter({
      alpha,
      particles,
      seed: hashSeed('advisor-public', cardsSeed),
    });
    this.key = gameKey(view);
    this.processed = 0;
    this.lastSignature = '';
    this.flow = { buys: 0, sells: 0, passes: 0 };
  }

  private sync(view: PlayerView): void {
    const ev = view.events;
    const sameGame =
      this.key === gameKey(view) &&
      ev.length >= this.processed &&
      (this.processed === 0 || eventSignature(ev[this.processed - 1]) === this.lastSignature);
    if (!sameGame) this.reset(view);
    for (let i = this.processed; i < ev.length; i++) {
      const e = ev[i];
      if (e.kind === 'reveal') {
        this.withPrivate.reveal(e.position, rankOf(e.card));
        this.withoutPrivate.reveal(e.position, rankOf(e.card));
      } else if (e.kind === 'action' && e.taker === 'bot') {
        // The player's own trades carry no information for the player. In multiplayer, reading the other
        // players' trades is left to the players: the Advisor uses the bots' order flow only.
        this.withPrivate.observe(e);
        this.withoutPrivate.observe(e);
        if (e.side === 'buy') this.flow.buys++;
        else if (e.side === 'sell') this.flow.sells++;
        else this.flow.passes++;
      }
    }
    this.processed = ev.length;
    if (ev.length > 0) this.lastSignature = eventSignature(ev[ev.length - 1]);
  }

  /** The player's current estimate of V, without building full advice. */
  estimate(view: PlayerView): { mean: number; sd: number } {
    this.sync(view);
    return { mean: this.withPrivate.mean(), sd: this.withPrivate.sd() };
  }

  advise(view: PlayerView): Advice {
    this.sync(view);
    const { theta, pMin, k } = this.params;
    const f = this.withPrivate;
    const mean = f.mean();
    const variance = f.variance();
    const sd = Math.sqrt(variance);
    const q = view.quote;
    const buyEdge = q.ask !== null ? mean - q.ask : null;
    const sellEdge = q.bid !== null ? q.bid - mean : null;
    const buyProb = q.ask !== null ? f.probAbove(q.ask) : null;
    const sellProb = q.bid !== null ? f.probBelow(q.bid) : null;
    const minEdge = theta * sd;
    const position = view.player.position;
    const sizeFor = (edge: number, cap: number) => {
      const raw = variance < 1e-9 ? 3 : Math.round((k * edge) / variance);
      return Math.min(cap, Math.max(1, Math.min(3, raw)));
    };

    const buyOk = view.maxBuy > 0 && buyEdge !== null && buyEdge > minEdge && (buyProb ?? 0) >= pMin;
    const sellOk = view.maxSell > 0 && sellEdge !== null && sellEdge > minEdge && (sellProb ?? 0) >= pMin;
    let action: AdviceAction = 'hold';
    let size = 0;
    let closing = false;
    if (buyOk && (!sellOk || buyEdge! >= sellEdge!)) {
      action = 'buy';
      size = sizeFor(buyEdge!, view.maxBuy);
    } else if (sellOk) {
      action = 'sell';
      size = sizeFor(sellEdge!, view.maxSell);
    } else if (view.round === view.config.rounds) {
      // Last round: close a position whose expected value is now below what the market will pay.
      if (position > 0 && view.maxSell > 0 && sellEdge !== null && sellEdge > 0) {
        action = 'sell';
        size = Math.min(position, view.maxSell);
        closing = true;
      } else if (position < 0 && view.maxBuy > 0 && buyEdge !== null && buyEdge > 0) {
        action = 'buy';
        size = Math.min(-position, view.maxBuy);
        closing = true;
      }
    }

    const publicSum = view.revealed.reduce((a, r) => a + rankOf(r.card), 0);
    const muPublic = expectedValue(publicSum, view.revealed.length);
    const attribution = attribute(mean, this.withoutPrivate.mean(), muPublic, quoteMid(q));
    const distribution = Array.from(f.distribution());

    let risk: Advice['risk'] = null;
    if (action === 'buy' && q.ask !== null) {
      const v = quantile(distribution, 0.2);
      risk = { value: v, lossPerUnit: q.ask - v };
    } else if (action === 'sell' && q.bid !== null) {
      const v = quantile(distribution, 0.8);
      risk = { value: v, lossPerUnit: v - q.bid };
    }

    return {
      action,
      size,
      price: action === 'buy' ? q.ask : action === 'sell' ? q.bid : null,
      closing,
      round: view.round,
      step: view.step,
      estimate: { mean, sd },
      buyEdge,
      buyProb,
      sellEdge,
      sellProb,
      minEdge,
      pMin,
      maxBuy: view.maxBuy,
      maxSell: view.maxSell,
      position,
      positionAfter: position + (action === 'buy' ? size : action === 'sell' ? -size : 0),
      mmPosition: view.mmPosition,
      attribution,
      risk,
      flow: { ...this.flow },
      warning: view.config.mmLearnsFromPlayer ? adjustmentWarning(view) : null,
      distribution,
    };
  }
}

/** Smallest v with P(V ≤ v) ≥ p. */
export function quantile(dist: readonly number[], p: number): number {
  let c = 0;
  for (let v = 0; v <= MAX_VALUE; v++) {
    c += dist[v];
    if (c >= p - 1e-12) return v;
  }
  return MAX_VALUE;
}

/** After 2+ consecutive same-side trades by this player, how far has the MM's mid moved since the first of them? */
function adjustmentWarning(view: PlayerView): Advice['warning'] {
  const seat = view.seat ?? 0;
  const trades = view.events.filter(
    (e): e is ActionEvent =>
      e.kind === 'action' && e.taker === 'player' && (e.seat ?? 0) === seat && e.side !== 'pass',
  );
  if (trades.length < 2) return null;
  const side = trades[trades.length - 1].side as 'buy' | 'sell';
  let count = 0;
  for (let i = trades.length - 1; i >= 0 && trades[i].side === side; i--) count++;
  if (count < 2) return null;
  const first = trades[trades.length - count];
  const before = quoteMid(first.quote);
  const now = quoteMid(view.quote);
  if (before === null || now === null) return null;
  return { side, count, midMove: now - before };
}

/** Advice from scratch, for one view. Equivalent to `new Advisor(params).advise(view)`. */
export function advise(view: PlayerView, params: Partial<AdvisorParams> = {}): Advice {
  return new Advisor(params).advise(view);
}
