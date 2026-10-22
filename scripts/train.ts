/**
 * Trains the learned market maker with the Cross-Entropy Method (spec §6.2), then explains it (§6.3).
 *   npm run train [-- --iters 60 --pop 64 --games 400 --seeds 3]
 * Writes public/models/learned-mm.json (weights, training curves, analysis) and src/agents/learned-weights.json
 * (the deployed policy, bundled with the site).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  inverseSoftplus,
  MIN_HALF_SPREAD,
  paramCount,
  FEATURE_NAMES,
  type LearnedVariant,
  type LearnedModel,
} from '../src/agents/learnedPolicy';
import { conditionalMoments, PRIOR_VARIANCE } from '../src/engine/cards';
import { hashSeed, Rng } from '../src/engine/rng';
import { DEFAULT_GAMMA } from '../src/agents/mmAnalytical';
import {
  collectStates,
  distill,
  partialDependence,
  permutationImportance,
  type EvalResult,
  type EvalTask,
} from '../src/sim/train';
import { validationSeed } from '../src/sim/simulate';
import { numArg, ROOT, writeJson } from './lib/io';
import { runPool } from './lib/pool';

const ITERS = numArg('iters', 60);
const POP = numArg('pop', 64);
const GAMES = numArg('games', 400);
const SEEDS = numArg('seeds', 3);
const ELITES = Math.max(4, Math.round(POP * 0.15));
const LAMBDA = 0.1;
const ALPHAS = [0.05, 0.15, 0.25, 0.35, 0.45];
const VAL_GAMES = numArg('val', 2000);

function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

function initial(variant: LearnedVariant, rng: Rng): { mu: number[]; sigma: number[] } {
  const n = paramCount(variant);
  const mu = new Array<number>(n).fill(0);
  const sigma = new Array<number>(n).fill(variant === 'linear' ? 0.5 : 0.3);
  const hs0 = inverseSoftplus(2.5 - MIN_HALF_SPREAD);
  if (variant === 'linear') {
    mu[2 * 8 + 1] = hs0;
  } else {
    // W1 small random so hidden units differ from the start; output bias for the half-spread.
    for (let i = 0; i < 16 * 8; i++) mu[i] = 0.4 * gaussian(rng);
    mu[n - 1] = hs0;
  }
  return { mu, sigma };
}

function gamesFor(tag: string, n: number, ...key: (string | number)[]) {
  return Array.from({ length: n }, (_, i) => ({
    seed: hashSeed(tag, ...key, i),
    alpha: ALPHAS[i % ALPHAS.length],
  }));
}

interface CurvePoint {
  iter: number;
  meanObjective: number;
  eliteObjective: number;
  bestObjective: number;
  muObjective: number;
  muPnl: number;
  muSpread: number;
}

async function cem(variant: LearnedVariant, seed: number) {
  const rng = new Rng(hashSeed('cem', variant, seed));
  let { mu, sigma } = initial(variant, rng);
  const curve: CurvePoint[] = [];
  for (let it = 0; it < ITERS; it++) {
    const games = gamesFor('train', GAMES, variant, seed, it);
    const pop = Array.from({ length: POP }, () => mu.map((m, j) => m + sigma[j] * gaussian(rng)));
    const tasks: EvalTask[] = [mu, ...pop].map((params) => ({ variant, params, games, lambda: LAMBDA }));
    const res = await runPool<EvalTask, EvalResult>('learnedEval', tasks, { chunk: 1 });
    const muRes = res[0];
    const scored = pop.map((p, i) => ({ p, r: res[i + 1] })).sort((a, b) => b.r.objective - a.r.objective);
    const elites = scored.slice(0, ELITES);
    const dim = mu.length;
    const extra = 0.02 * Math.max(0, 1 - it / (0.75 * ITERS));
    const newMu = new Array<number>(dim).fill(0);
    for (const e of elites) for (let j = 0; j < dim; j++) newMu[j] += e.p[j] / elites.length;
    const newSigma = newMu.map((m, j) => {
      const v = elites.reduce((a, e) => a + (e.p[j] - m) ** 2, 0) / elites.length;
      return Math.sqrt(v + extra);
    });
    curve.push({
      iter: it,
      meanObjective: scored.reduce((a, s) => a + s.r.objective, 0) / scored.length,
      eliteObjective: elites.reduce((a, s) => a + s.r.objective, 0) / elites.length,
      bestObjective: scored[0].r.objective,
      muObjective: muRes.objective,
      muPnl: muRes.pnl,
      muSpread: muRes.spread,
    });
    mu = newMu;
    sigma = newSigma;
    if (it % 10 === 9 || it === ITERS - 1) {
      console.log(
        `${variant} seed ${seed} iter ${it + 1}: μ objective ${muRes.objective.toFixed(2)} (P&L ${muRes.pnl.toFixed(2)}, spread ${muRes.spread.toFixed(2)}), elite ${curve[it].eliteObjective.toFixed(2)}`,
      );
    }
  }
  // Validation on held-out deals (validation seeds; never the reported test seeds).
  const val = Array.from({ length: VAL_GAMES }, (_, i) => ({
    seed: validationSeed(500_000 + i),
    alpha: ALPHAS[i % ALPHAS.length],
  }));
  const chunks: EvalTask[] = [];
  for (let i = 0; i < val.length; i += 200)
    chunks.push({ variant, params: mu, games: val.slice(i, i + 200), lambda: LAMBDA });
  const vr = await runPool<EvalTask, EvalResult>('learnedEval', chunks);
  const avg = (f: (r: EvalResult) => number) => vr.reduce((a, r) => a + f(r), 0) / vr.length;
  return {
    seed,
    params: mu,
    curve,
    valObjective: avg((r) => r.objective),
    valPnl: avg((r) => r.pnl),
    valMsq: avg((r) => r.msq),
    valSpread: avg((r) => r.spread),
  };
}

function shuffler(seed: number) {
  const rng = new Rng(seed);
  return (n: number) => rng.shuffle(Array.from({ length: n }, (_, i) => i));
}

function analyse(variant: LearnedVariant, params: number[]) {
  const all = collectStates(variant, params, gamesFor('analysis', 300, variant));
  const rng = new Rng(hashSeed('analysis-sample', variant));
  const states = rng.shuffle(all).slice(0, 6000);
  const varByRevealed = [0, 1, 2, 3].map((k) => {
    const s = states.filter((x) => x.nRevealed === k);
    return s.length ? s.reduce((a, x) => a + x.publicVariance, 0) / s.length : PRIOR_VARIANCE;
  });
  const range = (a: number, b: number, step: number) =>
    Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => a + i * step);
  const pdp = {
    offsetVsInventory: partialDependence(
      variant,
      params,
      states,
      (s, v) => ({ ...s, inventory: v }),
      range(-15, 15, 1),
    ),
    halfSpreadVsImbalance: partialDependence(
      variant,
      params,
      states,
      (s, v) => ({ ...s, imbalance8: v, imbalance3: Math.max(-3, Math.min(3, Math.round((v * 3) / 8))) }),
      range(-8, 8, 1),
    ),
    offsetVsImbalance: partialDependence(
      variant,
      params,
      states,
      (s, v) => ({ ...s, imbalance8: v, imbalance3: Math.max(-3, Math.min(3, Math.round((v * 3) / 8))) }),
      range(-8, 8, 1),
    ),
    halfSpreadVsRound: partialDependence(
      variant,
      params,
      states,
      (s, v) => ({ ...s, round: v, nRevealed: v - 1, publicVariance: varByRevealed[v - 1] }),
      [1, 2, 3, 4],
    ),
  };
  const importance = permutationImportance(variant, params, states, shuffler(hashSeed('perm', variant)));
  const distilled = distill(variant, params, states);
  const fidelity = (distilled.r2Offset + distilled.r2HalfSpread) / 2;
  // Inventory skew per unit, from the distilled offset: d offset / d q = a_q/10 + a_qv·Var/650.
  const perUnit = (v: number) => distilled.offset[2] / 10 + (distilled.offset[3] * v) / 650;
  const inventoryComparison = varByRevealed.map((v, k) => ({
    cardsRevealed: k,
    publicVariance: v,
    learnedPerUnit: perUnit(v),
    analyticalPerUnit: -DEFAULT_GAMMA * v,
  }));
  // Along a realistic path, net bot buying also leaves the MM short (about 2 units per bot trade), so the joint
  // effect moves inventory together with the imbalance.
  const offsetVsFlowJoint = partialDependence(
    variant,
    params,
    states,
    (s, v) => ({
      ...s,
      imbalance8: v,
      imbalance3: Math.max(-3, Math.min(3, Math.round((v * 3) / 8))),
      inventory: Math.max(-25, Math.min(25, s.inventory - 2 * v)),
    }),
    range(-8, 8, 1),
  );
  const o = pdp.offsetVsInventory;
  const h = pdp.halfSpreadVsImbalance;
  const r = pdp.halfSpreadVsRound;
  const mid = h[Math.floor(h.length / 2)].halfSpread;
  const afterSelling = h[0].halfSpread;
  const afterBuying = h[h.length - 1].halfSpread;
  const j = offsetVsFlowJoint;
  const rediscovered = {
    inventorySkew: o[o.length - 1].offset < o[0].offset,
    inventorySlope: (o[o.length - 1].offset - o[0].offset) / (o[o.length - 1].x - o[0].x),
    /** Glosten–Milgrom-like protection: wider after one-sided flow in either direction (by at least 0.1). */
    adverseSelection: Math.min(afterSelling, afterBuying) > mid + 0.1,
    spreadAtBalancedFlow: mid,
    spreadAfterNetSelling: afterSelling,
    spreadAfterNetBuying: afterBuying,
    /** The spread narrows as cards are revealed (like a risk spread proportional to the remaining variance). */
    uncertaintySpread: r[r.length - 1].halfSpread < r[0].halfSpread - 0.1,
    spreadRound1: r[0].halfSpread,
    spreadRound4: r[r.length - 1].halfSpread,
    /** Centre follows the flow along realistic paths (inventory moving with it). */
    flowFollowing: j[j.length - 1].offset > j[0].offset,
    jointOffsetAfterNetBuying: j[j.length - 1].offset,
    jointOffsetAfterNetSelling: j[0].offset,
    /** Centre vs flow holding inventory fixed (partial dependence). */
    flowFollowingHoldingInventory:
      pdp.offsetVsImbalance[pdp.offsetVsImbalance.length - 1].offset > pdp.offsetVsImbalance[0].offset,
  };
  Object.assign(pdp, { offsetVsFlowJoint });
  return { states: states.length, pdp, importance, distilled, fidelity, inventoryComparison, rediscovered };
}

const t0 = Date.now();
const out: Record<string, unknown> = {};
const variants: LearnedVariant[] = ['linear', 'mlp'];
type Run = Awaited<ReturnType<typeof cem>>;
const best: Record<string, Run> = {};
const runsByVariant: Record<string, Run[]> = {};
const MODEL_FILE = path.join(ROOT, 'public/models/learned-mm.json');
if (process.argv.includes('--analyse-only')) {
  // Recompute the analysis for the already-trained policies (no training).
  const prev = JSON.parse(readFileSync(MODEL_FILE, 'utf8'));
  for (const v of variants) {
    runsByVariant[v] = prev.variants[v].runs;
    best[v] = { ...prev.variants[v].best, curve: [] };
  }
  out.settings = prev.settings;
} else {
  for (const variant of variants) {
    const runs = [];
    for (let s = 1; s <= SEEDS; s++) runs.push(await cem(variant, s));
    runsByVariant[variant] = runs;
    best[variant] = runs.reduce((a, b) => (b.valObjective > a.valObjective ? b : a));
    console.log(
      `${variant}: best seed ${best[variant].seed}, validation objective ${best[variant].valObjective.toFixed(2)}, P&L ${best[variant].valPnl.toFixed(2)}`,
    );
  }
  out.settings = {
    iterations: ITERS,
    population: POP,
    elites: ELITES,
    gamesPerEvaluation: GAMES,
    seeds: SEEDS,
    lambda: LAMBDA,
    alphas: ALPHAS,
    validationGames: VAL_GAMES,
  };
}
const analysis = Object.fromEntries(variants.map((v) => [v, analyse(v, best[v].params)]));
const chosen: LearnedVariant = best.mlp.valObjective >= best.linear.valObjective ? 'mlp' : 'linear';
const a = analysis[chosen];
const model: LearnedModel = {
  variant: chosen,
  params: best[chosen].params,
  distilled: a.distilled,
  fidelity: a.fidelity,
  trainedAt: new Date().toISOString().slice(0, 10),
};
writeFileSync(path.join(ROOT, 'src/agents/learned-weights.json'), JSON.stringify(model, null, 1) + '\n');
out.featureNames = FEATURE_NAMES;
out.chosen = chosen;
out.priorVariance = PRIOR_VARIANCE;
out.roundOneVariance = conditionalMoments([]).variance;
out.variants = Object.fromEntries(
  variants.map((v) => [
    v,
    {
      runs: runsByVariant[v].map((r) => ({
        seed: r.seed,
        curve: r.curve,
        valObjective: r.valObjective,
        valPnl: r.valPnl,
        valMsq: r.valMsq,
        valSpread: r.valSpread,
      })),
      best: {
        seed: best[v].seed,
        params: best[v].params,
        valObjective: best[v].valObjective,
        valPnl: best[v].valPnl,
        valMsq: best[v].valMsq,
        valSpread: best[v].valSpread,
      },
      analysis: analysis[v],
    },
  ]),
);
writeJson('models/learned-mm.json', out);
console.log(
  `Chosen for Expert mode: ${chosen} (fidelity of its distilled explanation R² ${a.fidelity.toFixed(3)})`,
);
console.log(`Rediscovered: ${JSON.stringify(a.rediscovered)}`);
console.log(`Finished in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
