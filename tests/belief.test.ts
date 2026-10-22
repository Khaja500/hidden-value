import { describe, expect, it } from 'vitest';
import { ParticleFilter } from '../src/belief/particleFilter';
import { PRIOR_MEAN, PRIOR_VARIANCE } from '../src/engine/cards';
import type { ActionEvent } from '../src/engine/types';

function botTrade(side: 'buy' | 'sell' | 'pass', bid: number, ask: number): ActionEvent {
  return {
    kind: 'action',
    seq: 0,
    round: 1,
    step: 1,
    taker: 'bot',
    side,
    size: side === 'pass' ? 0 : 1,
    price: side === 'buy' ? ask : side === 'sell' ? bid : null,
    quote: { bid, ask, bidSize: 5, askSize: 5 },
  };
}

describe('particle filter', () => {
  it('starts at the prior', () => {
    const f = new ParticleFilter({ alpha: 0.25, seed: 1, particles: 20000 });
    expect(f.mean()).toBeCloseTo(PRIOR_MEAN, 0);
    expect(Math.abs(f.variance() - PRIOR_VARIANCE)).toBeLessThan(3);
  });

  it('known and revealed cards pin the estimate', () => {
    const f = new ParticleFilter({ alpha: 0.25, seed: 2, known: [{ position: 0, rank: 13 }] });
    // E[V | one King] = 13 + 4 × (364 − 13)/51
    expect(f.mean()).toBeCloseTo(13 + (4 * 351) / 51, 0);
    f.reveal(1, 12);
    f.reveal(2, 11);
    f.reveal(3, 10);
    expect(f.mean()).toBeCloseTo(46 + (364 - 46) / 48, 0);
    f.reveal(4, 1);
    expect(f.mean()).toBeCloseTo(47, 9);
    expect(f.variance()).toBeCloseTo(0, 9);
  });

  it('buys raise the estimate and sells lower it', () => {
    const up = new ParticleFilter({ alpha: 0.35, seed: 3 });
    const down = new ParticleFilter({ alpha: 0.35, seed: 3 });
    for (let i = 0; i < 4; i++) {
      up.observe(botTrade('buy', 33, 37));
      down.observe(botTrade('sell', 33, 37));
    }
    expect(up.mean()).toBeGreaterThan(PRIOR_MEAN + 1);
    expect(down.mean()).toBeLessThan(PRIOR_MEAN - 1);
  });

  it('α = 0 makes order flow uninformative', () => {
    const f = new ParticleFilter({ alpha: 0, seed: 4, particles: 20000 });
    const before = f.mean();
    for (let i = 0; i < 5; i++) f.observe(botTrade('buy', 33, 37));
    expect(Math.abs(f.mean() - before)).toBeLessThan(1e-9);
  });

  it('Glosten–Milgrom quotes bracket μ and widen with α', () => {
    const lo = new ParticleFilter({ alpha: 0.1, seed: 5 }).glostenMilgrom();
    const hi = new ParticleFilter({ alpha: 0.5, seed: 5 }).glostenMilgrom();
    expect(lo.bid).toBeLessThan(PRIOR_MEAN);
    expect(lo.ask).toBeGreaterThan(PRIOR_MEAN);
    expect(hi.ask - hi.bid).toBeGreaterThan(lo.ask - lo.bid);
  });

  it('P(V > x) and P(V < x) agree with the distribution', () => {
    const f = new ParticleFilter({ alpha: 0.25, seed: 6 });
    const d = f.distribution();
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(f.probAbove(35) + f.probBelow(35) + d[35]).toBeCloseTo(1, 10);
    expect(f.probAbove(35.5) + f.probBelow(35.5)).toBeCloseTo(1, 10);
  });

  it('updates stay fast with 5,000 particles (regression guard; `npm run bench` checks the 30 ms budget)', () => {
    // Other test files run in parallel and compete for the CPU, so this guard is loose. The 30 ms laptop budget
    // is asserted by scripts/bench.ts, which runs alone.
    const budget = 100;
    const observeMs: number[] = [];
    const revealMs: number[] = [];
    for (let rep = 0; rep < 6; rep++) {
      const f = new ParticleFilter({ alpha: 0.35, seed: 7 + rep });
      for (let i = 0; i < 12; i++) f.observe(botTrade(i % 3 === 0 ? 'sell' : 'buy', 33, 37));
      let t = performance.now();
      f.observe(botTrade('buy', 33, 37));
      f.mean();
      observeMs.push(performance.now() - t);
      t = performance.now();
      f.reveal(2, 9);
      f.mean();
      revealMs.push(performance.now() - t);
    }
    const median = (xs: number[]) => xs.slice(1).sort((a, b) => a - b)[2];
    expect(median(observeMs)).toBeLessThan(budget);
    expect(median(revealMs)).toBeLessThan(budget);
  });
});
