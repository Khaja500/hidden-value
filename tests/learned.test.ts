import { describe, expect, it } from 'vitest';
import { LEARNED_MODEL } from '../src/agents/factory';
import { features, forward, paramCount } from '../src/agents/learnedPolicy';
import { hashSeed } from '../src/engine/rng';
import { collectStates, distill, evaluatePolicy, fitLinear } from '../src/sim/train';

describe('learned market maker', () => {
  it('least squares recovers a known linear function', () => {
    const X = Array.from({ length: 200 }, (_, i) => [Math.sin(i), Math.cos(3 * i), (i % 7) / 7]);
    const y = X.map((x) => 2 * x[0] - 1.5 * x[1] + 0.5 * x[2] + 3);
    const f = fitLinear(X, y);
    expect(f.w[0]).toBeCloseTo(2, 4);
    expect(f.w[1]).toBeCloseTo(-1.5, 4);
    expect(f.w[2]).toBeCloseTo(0.5, 4);
    expect(f.b).toBeCloseTo(3, 4);
    expect(f.r2).toBeCloseTo(1, 6);
  });

  it('distilling a linear policy reproduces its centre exactly', () => {
    const params = Array.from({ length: paramCount('linear') }, (_, i) => Math.sin(i + 1) * 0.5);
    const games = Array.from({ length: 10 }, (_, i) => ({ seed: hashSeed('distill', i), alpha: 0.25 }));
    const states = collectStates('linear', params, games);
    const d = distill('linear', params, states);
    expect(d.r2Offset).toBeCloseTo(1, 6);
    // Predictions are exact. "Cards revealed" is always round − 1, so those two weights are not separately
    // identifiable; every other weight is recovered.
    for (const s of states.slice(0, 50)) {
      const x = features(s);
      const pred = x.reduce((a, v, j) => a + v * d.offset[j], d.offsetIntercept);
      expect(pred).toBeCloseTo(forward('linear', params, x).offset, 3);
    }
    for (const j of [0, 2, 3, 4, 5, 7]) expect(d.offset[j]).toBeCloseTo(params[j], 2);
  });

  it('the deployed Expert policy is trained, explained with high fidelity, and profitable against bots', () => {
    expect(LEARNED_MODEL.trainedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LEARNED_MODEL.params.length).toBe(paramCount(LEARNED_MODEL.variant));
    expect(LEARNED_MODEL.fidelity).toBeGreaterThan(0.9);
    const x = features({
      publicEV: 35,
      nRevealed: 0,
      publicVariance: 64.5,
      inventory: 0,
      imbalance3: 0,
      imbalance8: 0,
      round: 1,
      step: 1,
    });
    const out = forward(LEARNED_MODEL.variant, LEARNED_MODEL.params, x);
    expect(out.halfSpread).toBeGreaterThan(0);
    const games = Array.from({ length: 300 }, (_, i) => ({ seed: hashSeed('learned-test', i), alpha: 0.35 }));
    const r = evaluatePolicy({
      variant: LEARNED_MODEL.variant,
      params: LEARNED_MODEL.params,
      games,
      lambda: 0,
    });
    expect(r.pnl).toBeGreaterThan(0);
  });
});
