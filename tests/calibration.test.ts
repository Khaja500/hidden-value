import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game';
import { ParticleFilter } from '../src/belief/particleFilter';
import { probabilityBuckets, quantileBuckets } from '../src/belief/calibration';
import { expectedValue, rankOf } from '../src/engine/cards';
import { finishQuote } from '../src/agents/quoting';
import { hashSeed, Rng } from '../src/engine/rng';
import { makeConfig } from '../src/engine/rules';
import type { MarketEvent, MarketMaker, PublicView, Quote, QuoteExplanation } from '../src/engine/types';

/** Quotes public EV ± 1.5 so informed bots trade often and order flow carries real information. */
class TightMM implements MarketMaker {
  readonly kind = 'naive' as const;
  private s = 0;
  private n = 0;
  private q = 0;
  onEvent(e: MarketEvent) {
    if (e.kind === 'reveal') {
      this.s += rankOf(e.card);
      this.n++;
    } else if (e.side !== 'pass') this.q += e.side === 'buy' ? -e.size : e.size;
  }
  fairValue() {
    return expectedValue(this.s, this.n);
  }
  quote(_v: PublicView): Quote {
    const mu = this.fairValue();
    return finishQuote(mu - 1.5, mu + 1.5, this.q).quote;
  }
  explain(): QuoteExplanation {
    throw new Error('not used');
  }
}

const GAMES = 2000;
const PARTICLES = 2000;

/** Runs GAMES games; for each, feeds one filter and records μ and a P(V > x) statement at a random step. */
function collect(viewer: 'public' | 'player') {
  const mus: number[] = [];
  const vs: number[] = [];
  const probs: number[] = [];
  const hits: number[] = [];
  for (let g = 0; g < GAMES; g++) {
    const config = makeConfig('hard', hashSeed('calibration', viewer, g), { mmLearnsFromPlayer: false });
    const game = new Game(config, new TightMM());
    while (game.phase !== 'settled') game.act({ side: 'pass', size: 0 });
    const st = game.fullState();
    const V = st.cards.reduce((a, c) => a + rankOf(c), 0);
    const known = viewer === 'player' ? [{ position: 0, rank: rankOf(st.cards[0]) }] : [];
    const f = new ParticleFilter({ alpha: config.alpha, seed: g, particles: PARTICLES, known });
    const rng = new Rng(hashSeed('checkpoint', g));
    const checkpoint = rng.int(32);
    let botSeen = 0;
    for (const e of st.events) {
      if (e.kind === 'reveal') f.reveal(e.position, rankOf(e.card));
      if (e.kind === 'action') {
        f.observe(e);
        if (e.taker === 'bot' && botSeen++ === checkpoint) {
          const mu = f.mean();
          mus.push(mu);
          vs.push(V);
          const x = Math.round(mu) + rng.int(9) - 4 + 0.5;
          probs.push(f.probAbove(x));
          hits.push(V > x ? 1 : 0);
          break;
        }
      }
    }
  }
  return { mus, vs, probs, hits };
}

describe('belief calibration (2,000 simulated games per viewer)', () => {
  for (const viewer of ['public', 'player'] as const) {
    it(`${viewer} view: bucketed μ matches mean realized V, and P(V > x) is calibrated`, () => {
      const { mus, vs, probs, hits } = collect(viewer);
      const meanBuckets = quantileBuckets(mus, vs, 10);
      const failures = meanBuckets.filter((b) => !b.ok).length;
      // With 10 independent 95% intervals, one miss is expected by chance about 40% of the time.
      expect(failures).toBeLessThanOrEqual(1);
      const probBuckets = probabilityBuckets(probs, hits);
      expect(probBuckets.length).toBeGreaterThanOrEqual(6);
      expect(probBuckets.filter((b) => !b.ok).length).toBeLessThanOrEqual(1);
      // The model should also be sharp: μ explains a real share of V's variance.
      const mv = vs.reduce((a, b) => a + b, 0) / vs.length;
      const sst = vs.reduce((a, v) => a + (v - mv) ** 2, 0);
      const sse = vs.reduce((a, v, i) => a + (v - mus[i]) ** 2, 0);
      expect(1 - sse / sst).toBeGreaterThan(viewer === 'player' ? 0.25 : 0.15);
    });
  }
});
