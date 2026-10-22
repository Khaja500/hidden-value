/**
 * Training and analysis helpers for the learned market maker (spec §6.2–6.3). Pure: the Node script runs them in
 * worker threads.
 */
import { LearnedMM } from '../agents/mmLearned';
import { Game } from '../engine/game';
import { makeConfig } from '../engine/rules';
import {
  features,
  forward,
  N_FEATURES,
  type Distilled,
  type FeatureInputs,
  type LearnedModel,
  type LearnedVariant,
} from '../agents/learnedPolicy';

export const ZERO_DISTILLED: Distilled = {
  offset: new Array(N_FEATURES).fill(0),
  offsetIntercept: 0,
  halfSpread: new Array(N_FEATURES).fill(0),
  halfSpreadIntercept: 0,
  r2Offset: 0,
  r2HalfSpread: 0,
};

export function modelOf(
  variant: LearnedVariant,
  params: number[],
  distilled = ZERO_DISTILLED,
  fidelity = 0,
): LearnedModel {
  return { variant, params, distilled, fidelity, trainedAt: '' };
}

export interface EvalTask {
  variant: LearnedVariant;
  params: number[];
  games: { seed: number; alpha: number }[];
  lambda: number;
}

export interface EvalResult {
  objective: number;
  pnl: number;
  /** Time-averaged squared inventory. */
  msq: number;
  spread: number;
}

/** Plays bot-only games with the given policy as market maker. Objective = mean P&L − λ · mean squared inventory. */
export function evaluatePolicy(task: EvalTask): EvalResult {
  const model = modelOf(task.variant, task.params);
  let pnl = 0;
  let msq = 0;
  let spread = 0;
  for (const g of task.games) {
    let q2 = 0;
    let n = 0;
    let sp = 0;
    let ns = 0;
    const config = makeConfig('expert', g.seed, { alpha: g.alpha, mmLearnsFromPlayer: false });
    const game = new Game(config, new LearnedMM(model), {
      onQuote: (q, _mm, s) => {
        const inv = s.accounts.mm.position;
        q2 += inv * inv;
        n++;
        if (q.bid !== null && q.ask !== null) {
          sp += q.ask - q.bid;
          ns++;
        }
      },
    });
    while (game.phase !== 'settled') game.act({ side: 'pass', size: 0 });
    pnl += game.settlement().pnl.mm;
    msq += q2 / Math.max(1, n);
    spread += ns ? sp / ns : 0;
  }
  const k = task.games.length;
  return { objective: pnl / k - (task.lambda * msq) / k, pnl: pnl / k, msq: msq / k, spread: spread / k };
}

/** Feature inputs at every quote the policy posts, across bot-only games: the dataset for analysis. */
export function collectStates(
  variant: LearnedVariant,
  params: number[],
  games: { seed: number; alpha: number }[],
): FeatureInputs[] {
  const out: FeatureInputs[] = [];
  const model = modelOf(variant, params);
  for (const g of games) {
    const mm = new LearnedMM(model);
    const config = makeConfig('expert', g.seed, { alpha: g.alpha, mmLearnsFromPlayer: false });
    const game = new Game(config, mm, {
      onQuote: (_q, _mm, s) => out.push(mm.inputs(s.round, s.step)),
    });
    while (game.phase !== 'settled') game.act({ side: 'pass', size: 0 });
  }
  return out;
}

// ---- Linear algebra ----------------------------------------------------------------------------------------------

/** Solves A x = b (A is n×n, row-major arrays) by Gaussian elimination with partial pivoting. */
export function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Ordinary least squares with intercept (tiny ridge for stability); returns weights, intercept and R². */
export function fitLinear(X: number[][], y: number[]): { w: number[]; b: number; r2: number } {
  const n = X[0].length;
  const p = n + 1;
  const A = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const v = new Array<number>(p).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = [...X[i], 1];
    for (let a = 0; a < p; a++) {
      v[a] += row[a] * y[i];
      for (let b = 0; b < p; b++) A[a][b] += row[a] * row[b];
    }
  }
  for (let a = 0; a < n; a++) A[a][a] += 1e-6 * X.length;
  const coef = solve(A, v);
  const w = coef.slice(0, n);
  const b = coef[n];
  const mean = y.reduce((s, x) => s + x, 0) / y.length;
  let sst = 0;
  let sse = 0;
  for (let i = 0; i < X.length; i++) {
    const pred = X[i].reduce((s, x, j) => s + x * w[j], b);
    sse += (y[i] - pred) ** 2;
    sst += (y[i] - mean) ** 2;
  }
  return { w, b, r2: sst > 0 ? 1 - sse / sst : 1 };
}

/** Fits linear models to the policy's offset and half-spread over a set of states. */
export function distill(variant: LearnedVariant, params: number[], states: FeatureInputs[]): Distilled {
  const X = states.map(features);
  const outs = X.map((x) => forward(variant, params, x));
  const o = fitLinear(
    X,
    outs.map((r) => r.offset),
  );
  const h = fitLinear(
    X,
    outs.map((r) => r.halfSpread),
  );
  return {
    offset: o.w,
    offsetIntercept: o.b,
    halfSpread: h.w,
    halfSpreadIntercept: h.b,
    r2Offset: o.r2,
    r2HalfSpread: h.r2,
  };
}

/** Partial dependence: mean policy output over the dataset with one input set to each grid value. */
export function partialDependence(
  variant: LearnedVariant,
  params: number[],
  states: FeatureInputs[],
  set: (s: FeatureInputs, v: number) => FeatureInputs,
  grid: number[],
): { x: number; offset: number; halfSpread: number }[] {
  return grid.map((v) => {
    let o = 0;
    let h = 0;
    for (const s of states) {
      const r = forward(variant, params, features(set(s, v)));
      o += r.offset;
      h += r.halfSpread;
    }
    return { x: v, offset: o / states.length, halfSpread: h / states.length };
  });
}

/** Permutation importance: mean absolute change in each output when one feature column is shuffled. */
export function permutationImportance(
  variant: LearnedVariant,
  params: number[],
  states: FeatureInputs[],
  shuffle: (n: number) => number[],
): { offset: number; halfSpread: number }[] {
  const X = states.map(features);
  const base = X.map((x) => forward(variant, params, x));
  return Array.from({ length: N_FEATURES }, (_, j) => {
    const perm = shuffle(X.length);
    let o = 0;
    let h = 0;
    for (let i = 0; i < X.length; i++) {
      const x = X[i].slice();
      x[j] = X[perm[i]][j];
      const r = forward(variant, params, x);
      o += Math.abs(r.offset - base[i].offset);
      h += Math.abs(r.halfSpread - base[i].halfSpread);
    }
    return { offset: o / X.length, halfSpread: h / X.length };
  });
}
