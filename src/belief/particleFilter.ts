/**
 * Particle filter over the hidden cards (spec §3), shared by the market maker and the Advisor.
 *
 * Each particle is one full assignment of ranks to the 5 positions, consistent with what the agent knows (its
 * private cards and the public reveals). Trades reweight particles by their likelihood. A reveal invalidates every
 * particle that disagrees with the revealed card: those are redrawn from the deck given everything known and
 * weighted by the likelihood of the whole trade history (exact importance sampling), then combined with the
 * surviving particles in proportion to each group's effective sample size. Resampling (systematic) happens when
 * the effective sample size drops below half the particle count.
 */
import { noiseBuyProb, noiseSellProb } from '../agents/noise';
import { DECK_SIZE, expectedValue, HAND_SIZE, MAX_VALUE, RANKS } from '../engine/cards';
import { Rng } from '../engine/rng';
import type { ActionEvent, ActionSide } from '../engine/types';
import {
  botLikelihood,
  keyFor,
  N_KEYS,
  N_SUBSETS,
  KEYS_BY_VAL,
  playerLikelihood,
  SUBSET_WEIGHTS,
  traderModel,
  upperBound,
  lowerBound,
  writeKeys,
  type PlayerTakerModel,
  type QuoteFaced,
  type TraderModel,
} from './likelihoods';

export const DEFAULT_PARTICLES = 5000;

export interface FilterOptions {
  /** The belief model's informed share α (may differ from the game's true α). */
  alpha: number;
  seed: number;
  particles?: number;
  /** Cards the agent privately knows, by position (rank 1..13). */
  known?: readonly { position: number; rank: number }[];
  /** If set, the player's trades are evidence too (Hard-mode market maker). */
  playerModel?: PlayerTakerModel | null;
}

interface HistoryEntry {
  publicMask: number;
  taker: 'bot' | 'player';
  side: ActionSide;
  q: QuoteFaced;
}

function quoteFaced(e: ActionEvent, publicEV: number): QuoteFaced {
  const { bid, ask } = e.quote;
  return {
    bid,
    ask,
    bidOpen: e.quote.bidSize > 0,
    askOpen: e.quote.askSize > 0,
    pNoiseBuy: ask === null ? 0 : noiseBuyProb(ask, publicEV),
    pNoiseSell: bid === null ? 0 : noiseSellProb(bid, publicEV),
  };
}

export class ParticleFilter {
  readonly n: number;
  readonly model: TraderModel;
  private readonly pm: PlayerTakerModel | null;
  private readonly rng: Rng;
  private vals: Uint8Array;
  private sums: Uint8Array;
  private w: Float64Array;
  private keys: Uint16Array;
  private pkeys: Uint16Array;
  private publicMask = 0;
  private publicSum = 0;
  private publicCount = 0;
  private knownMask = 0;
  private readonly knownRank = new Uint8Array(HAND_SIZE);
  private readonly history: HistoryEntry[] = [];
  private resamples = 0;

  // Lazily rebuilt summaries
  private dirty = true;
  private mu = 0;
  private second = 0;
  private readonly dist = new Float64Array(MAX_VALUE + 1);
  private readonly accW = new Float64Array(N_KEYS);
  private readonly accWV = new Float64Array(N_KEYS);
  /** Cumulative sums over keys sorted by valuation: cumW[i] = Σ_{j<i} accW[KEYS_BY_VAL[j]]. */
  private readonly cumW = new Float64Array(N_KEYS + 1);
  private readonly cumWV = new Float64Array(N_KEYS + 1);

  constructor(opts: FilterOptions) {
    this.n = opts.particles ?? DEFAULT_PARTICLES;
    this.model = traderModel(opts.alpha);
    this.pm = opts.playerModel ?? null;
    this.rng = new Rng(opts.seed);
    for (const k of opts.known ?? []) {
      this.knownMask |= 1 << k.position;
      this.knownRank[k.position] = k.rank;
    }
    const n = this.n;
    this.vals = new Uint8Array(n * HAND_SIZE);
    this.sums = new Uint8Array(n);
    this.w = new Float64Array(n).fill(1 / n);
    this.keys = new Uint16Array(n * N_SUBSETS);
    this.pkeys = new Uint16Array(n);
    for (let i = 0; i < n; i++) this.drawParticle(i);
    this.refreshKeys();
  }

  // ---- sampling ---------------------------------------------------------------------------------------------

  /** Draws particle i's unknown positions from the deck given every card the agent knows. */
  private drawParticle(i: number): void {
    const counts = new Uint8Array(RANKS + 1).fill(4);
    let remaining = DECK_SIZE;
    for (let p = 0; p < HAND_SIZE; p++) {
      if (this.knownMask & (1 << p)) {
        counts[this.knownRank[p]]--;
        remaining--;
      }
    }
    let sum = 0;
    const off = i * HAND_SIZE;
    for (let p = 0; p < HAND_SIZE; p++) {
      let r: number;
      if (this.knownMask & (1 << p)) {
        r = this.knownRank[p];
      } else {
        let u = this.rng.int(remaining);
        r = 1;
        while (u >= counts[r]) {
          u -= counts[r];
          r++;
        }
        counts[r]--;
        remaining--;
      }
      this.vals[off + p] = r;
      sum += r;
    }
    this.sums[i] = sum;
  }

  private refreshKeys(): void {
    const pmask = this.pm ? this.publicMask | this.pm.mask : 0;
    for (let i = 0; i < this.n; i++) {
      writeKeys(this.vals, i * HAND_SIZE, this.publicMask, this.keys, i * N_SUBSETS);
      if (this.pm) this.pkeys[i] = keyFor(this.vals, i * HAND_SIZE, pmask);
    }
  }

  /** Likelihood of the entire trade history for particle i (used when redrawing after a reveal). */
  private historyLikelihood(i: number, scratch: Uint16Array): number {
    let like = 1;
    let mask = -1;
    let pkey = 0;
    const off = i * HAND_SIZE;
    for (const h of this.history) {
      if (h.publicMask !== mask) {
        mask = h.publicMask;
        writeKeys(this.vals, off, mask, scratch, 0);
        if (this.pm) pkey = keyFor(this.vals, off, mask | this.pm.mask);
      }
      like *=
        h.taker === 'bot'
          ? botLikelihood(scratch, 0, h.side, h.q, this.model)
          : playerLikelihood(pkey, h.side, h.q, this.pm!);
    }
    return like;
  }

  // ---- evidence ---------------------------------------------------------------------------------------------

  /** A card became public. */
  reveal(position: number, rank: number): void {
    const bit = 1 << position;
    const alreadyKnown = (this.knownMask & bit) !== 0;
    if (!(this.publicMask & bit)) {
      this.publicSum += rank;
      this.publicCount += 1;
    }
    this.publicMask |= bit;
    this.knownMask |= bit;
    this.knownRank[position] = rank;
    if (!alreadyKnown) this.conditionOnReveal(position, rank);
    this.refreshKeys();
    this.dirty = true;
  }

  private conditionOnReveal(position: number, rank: number): void {
    const n = this.n;
    const w = this.w;
    const keep = new Uint8Array(n);
    let sumA = 0;
    let sqA = 0;
    for (let i = 0; i < n; i++) {
      if (this.vals[i * HAND_SIZE + position] === rank) {
        keep[i] = 1;
        sumA += w[i];
        sqA += w[i] * w[i];
      }
    }
    const scratch = new Uint16Array(N_SUBSETS);
    const wB = new Float64Array(n);
    let sumB = 0;
    let sqB = 0;
    for (let i = 0; i < n; i++) {
      if (keep[i]) continue;
      this.drawParticle(i);
      const l = this.historyLikelihood(i, scratch);
      wB[i] = l;
      sumB += l;
      sqB += l * l;
    }
    const essA = sumA > 0 ? (sumA * sumA) / sqA : 0;
    const essB = sumB > 0 ? (sumB * sumB) / sqB : 0;
    const lamA = essA + essB > 0 ? essA / (essA + essB) : 0;
    const lamB = 1 - lamA;
    for (let i = 0; i < n; i++) {
      w[i] = keep[i] ? (lamA * w[i]) / sumA : sumB > 0 ? (lamB * wB[i]) / sumB : 0;
    }
    this.normalize();
    this.maybeResample();
  }

  /**
   * A taker acted at the quote. Bot actions (including passes) are always evidence; the player's trades are
   * evidence only when a player model is set; the player's passes never are.
   */
  observe(e: ActionEvent): void {
    if (e.taker === 'player' && (!this.pm || e.side === 'pass')) return;
    const q = quoteFaced(e, this.publicEV());
    const entry: HistoryEntry = { publicMask: this.publicMask, taker: e.taker, side: e.side, q };
    this.history.push(entry);
    const w = this.w;
    if (e.taker === 'bot') {
      for (let i = 0; i < this.n; i++) w[i] *= botLikelihood(this.keys, i * N_SUBSETS, e.side, q, this.model);
    } else {
      for (let i = 0; i < this.n; i++) w[i] *= playerLikelihood(this.pkeys[i], e.side, q, this.pm!);
    }
    this.normalize();
    this.maybeResample();
    this.dirty = true;
  }

  private normalize(): void {
    let s = 0;
    for (let i = 0; i < this.n; i++) s += this.w[i];
    if (!(s > 0)) {
      this.w.fill(1 / this.n);
      return;
    }
    for (let i = 0; i < this.n; i++) this.w[i] /= s;
  }

  /** Expected V given the public reveals only. */
  publicEV(): number {
    return expectedValue(this.publicSum, this.publicCount);
  }

  ess(): number {
    let sq = 0;
    for (let i = 0; i < this.n; i++) sq += this.w[i] * this.w[i];
    return 1 / sq;
  }

  get resampleCount(): number {
    return this.resamples;
  }

  private maybeResample(): void {
    if (this.ess() >= 0.5 * this.n) return;
    const n = this.n;
    const idx = new Uint32Array(n);
    const step = 1 / n;
    let u = this.rng.next() * step;
    let c = this.w[0];
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (u > c && j < n - 1) c += this.w[++j];
      idx[i] = j;
      u += step;
    }
    const vals = new Uint8Array(n * HAND_SIZE);
    const sums = new Uint8Array(n);
    const keys = new Uint16Array(n * N_SUBSETS);
    const pkeys = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const s = idx[i];
      vals.set(this.vals.subarray(s * HAND_SIZE, s * HAND_SIZE + HAND_SIZE), i * HAND_SIZE);
      keys.set(this.keys.subarray(s * N_SUBSETS, s * N_SUBSETS + N_SUBSETS), i * N_SUBSETS);
      sums[i] = this.sums[s];
      pkeys[i] = this.pkeys[s];
    }
    this.vals = vals;
    this.sums = sums;
    this.keys = keys;
    this.pkeys = pkeys;
    this.w.fill(1 / n);
    this.resamples++;
  }

  // ---- summaries --------------------------------------------------------------------------------------------

  private rebuild(): void {
    if (!this.dirty) return;
    this.dist.fill(0);
    this.accW.fill(0);
    this.accWV.fill(0);
    let mu = 0;
    let second = 0;
    for (let i = 0; i < this.n; i++) {
      const wi = this.w[i];
      const v = this.sums[i];
      mu += wi * v;
      second += wi * v * v;
      this.dist[v] += wi;
      const off = i * N_SUBSETS;
      for (let k = 0; k < N_SUBSETS; k++) {
        const ww = wi * SUBSET_WEIGHTS[k];
        const key = this.keys[off + k];
        this.accW[key] += ww;
        this.accWV[key] += ww * v;
      }
    }
    this.mu = mu;
    this.second = second;
    this.cumW[0] = 0;
    this.cumWV[0] = 0;
    for (let j = 0; j < N_KEYS; j++) {
      const key = KEYS_BY_VAL[j];
      this.cumW[j + 1] = this.cumW[j] + this.accW[key];
      this.cumWV[j + 1] = this.cumWV[j] + this.accWV[key];
    }
    this.dirty = false;
  }

  mean(): number {
    this.rebuild();
    return this.mu;
  }

  variance(): number {
    this.rebuild();
    return Math.max(0, this.second - this.mu * this.mu);
  }

  sd(): number {
    return Math.sqrt(this.variance());
  }

  /** P(V = v) for v = 0..65. */
  distribution(): Float64Array {
    this.rebuild();
    return this.dist.slice();
  }

  /** P(V > x). */
  probAbove(x: number): number {
    this.rebuild();
    let p = 0;
    for (let v = Math.floor(x) + 1; v <= MAX_VALUE; v++) if (v > x) p += this.dist[v];
    return p;
  }

  /** P(V < x). */
  probBelow(x: number): number {
    this.rebuild();
    let p = 0;
    for (let v = 0; v < x && v <= MAX_VALUE; v++) p += this.dist[v];
    return p;
  }

  /** E[V | the next bot taker buys at `ask`] under the trader model. */
  meanGivenBuy(ask: number): number {
    this.rebuild();
    const j = upperBound(ask);
    const infW = this.cumW[N_KEYS] - this.cumW[j];
    const infWV = this.cumWV[N_KEYS] - this.cumWV[j];
    const { alpha } = this.model;
    const pNoiseBuy = noiseBuyProb(ask, this.publicEV());
    const den = (1 - alpha) * pNoiseBuy + alpha * infW;
    if (den <= 0) return this.mu;
    return ((1 - alpha) * pNoiseBuy * this.mu + alpha * infWV) / den;
  }

  /** E[V | the next bot taker sells at `bid`]. */
  meanGivenSell(bid: number): number {
    this.rebuild();
    const j = lowerBound(bid);
    const infW = this.cumW[j];
    const infWV = this.cumWV[j];
    const { alpha } = this.model;
    const pNoiseSell = noiseSellProb(bid, this.publicEV());
    const den = (1 - alpha) * pNoiseSell + alpha * infW;
    if (den <= 0) return this.mu;
    return ((1 - alpha) * pNoiseSell * this.mu + alpha * infWV) / den;
  }

  /**
   * Glosten–Milgrom zero-profit quotes: the ask solves a = E[V | buy at a] and the bid solves b = E[V | sell at b].
   * Iterating from μ moves monotonically to the fixed point nearest μ.
   */
  glostenMilgrom(): { bid: number; ask: number } {
    const mu = this.mean();
    let ask = mu;
    for (let it = 0; it < 60; it++) {
      const next = this.meanGivenBuy(ask);
      if (Math.abs(next - ask) < 1e-9) break;
      ask = next;
    }
    let bid = mu;
    for (let it = 0; it < 60; it++) {
      const next = this.meanGivenSell(bid);
      if (Math.abs(next - bid) < 1e-9) break;
      bid = next;
    }
    return { bid, ask };
  }

  /** Number of observed trade events (for diagnostics). */
  get historyLength(): number {
    return this.history.length;
  }
}
