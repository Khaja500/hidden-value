/** Experiment registry for `npm run sim -- --exp <name>`. */
import { DEFAULT_ADVISOR_PARAMS, type AdvisorParams } from '../src/agents/advisor';
import { probabilityBuckets, quantileBuckets } from '../src/belief/calibration';
import { makeConfig } from '../src/engine/rules';
import type { Difficulty, GameConfig, MMKind, MMParams } from '../src/engine/types';
import type { AttributionCheck, CalibrationSample, CounterfactualCheck } from '../src/sim/research';
import { meanCI, testSeed, validationSeed, type GameSummary, type SimTask } from '../src/sim/simulate';
import { arg, numArg, writeJson } from './lib/io';
import { runPool } from './lib/pool';

const sims = (tasks: SimTask[], label: string) => runPool<SimTask, GameSummary>('sim', tasks, { label });

function advisorTasks(
  difficulty: Difficulty,
  games: number,
  seedFn: (i: number) => number,
  params: Partial<AdvisorParams>,
  particles: number,
): SimTask[] {
  return Array.from({ length: games }, (_, i) => ({
    config: makeConfig(difficulty, seedFn(i), { mm: { particles } }),
    player: 'advisor' as const,
    advisor: { ...params, particles },
  }));
}

/** Grid search of θ, p_min and k on validation seeds (spec §8.4). */
async function advisorTune() {
  const games = numArg('games', 300);
  const particles = numArg('particles', 2000);
  const thetas = [0.05, 0.15, 0.3];
  const pMins = [0.52, 0.58, 0.65];
  const ks = [25, 50, 100];
  const diffs: Difficulty[] = ['easy', 'medium', 'hard'];
  const grid: { theta: number; pMin: number; k: number }[] = [];
  for (const theta of thetas) for (const pMin of pMins) for (const k of ks) grid.push({ theta, pMin, k });
  const tasks: SimTask[] = [];
  for (const g of grid)
    for (const d of diffs) tasks.push(...advisorTasks(d, games, validationSeed, g, particles));
  const res = await sims(tasks, 'advisor-tune');
  const rows = grid.map((g, gi) => {
    const byDiff: Record<string, { mean: number; ci95: number; trades: number }> = {};
    let total = 0;
    diffs.forEach((d, di) => {
      const start = (gi * diffs.length + di) * games;
      const slice = res.slice(start, start + games);
      const m = meanCI(slice.map((r) => r.pnl.player));
      byDiff[d] = {
        mean: m.mean,
        ci95: m.ci95,
        trades: slice.reduce((a, r) => a + r.playerTrades, 0) / games,
      };
      total += m.mean;
    });
    return { ...g, byDiff, total };
  });
  rows.sort((a, b) => b.total - a.total);
  for (const r of rows.slice(0, 8)) {
    console.log(
      `θ=${r.theta} pMin=${r.pMin} k=${r.k} total=${r.total.toFixed(2)} ` +
        diffs
          .map(
            (d) =>
              `${d} ${r.byDiff[d].mean.toFixed(2)}±${r.byDiff[d].ci95.toFixed(2)} (${r.byDiff[d].trades.toFixed(1)} tr)`,
          )
          .join(' '),
    );
  }
  writeJson('research/advisor-tuning.json', { games, particles, seeds: 'validation', rows });
}

/** Advisor-bot results on held-out test seeds with production settings (spec §8.4). */
async function advisorResults() {
  const games = numArg('games', 2000);
  const particles = numArg('particles', 5000);
  const diffs = (arg('diffs') ?? 'easy,medium,hard,expert').split(',') as Difficulty[];
  const tasks = diffs.flatMap((d) => advisorTasks(d, games, testSeed, DEFAULT_ADVISOR_PARAMS, particles));
  const res = await sims(tasks, 'advisor');
  const rows = diffs.map((d, di) => {
    const slice = res.slice(di * games, (di + 1) * games);
    const pnl = meanCI(slice.map((r) => r.pnl.player));
    const traded = slice.filter((r) => r.playerTrades > 0);
    const statements = slice.flatMap((r) => r.advisorStatements);
    return {
      difficulty: d,
      games,
      meanPnl: pnl.mean,
      ci95: pnl.ci95,
      winRate: slice.filter((r) => r.pnl.player > 0).length / games,
      winRateWhenTrading: traded.length ? traded.filter((r) => r.pnl.player > 0).length / traded.length : 0,
      tradesPerGame: slice.reduce((a, r) => a + r.playerTrades, 0) / games,
      unitsPerGame: slice.reduce((a, r) => a + r.volume.player, 0) / games,
      mmPnl: meanCI(slice.map((r) => r.pnl.mm)).mean,
      calibration: probabilityBuckets(
        statements.map((s) => s.p),
        statements.map((s) => s.hit),
        10,
        20,
      ),
    };
  });
  for (const r of rows) {
    console.log(
      `${r.difficulty.padEnd(7)} P&L ${r.meanPnl.toFixed(2)} ± ${r.ci95.toFixed(2)}  win ${(r.winRate * 100).toFixed(0)}%  trades/game ${r.tradesPerGame.toFixed(1)}`,
    );
  }
  writeJson('research/advisor.json', {
    games,
    particles,
    seeds: 'test',
    params: DEFAULT_ADVISOR_PARAMS,
    rows,
  });
}

// ---- Market-maker experiments (spec §8.2) ------------------------------------------------------------------

function mmKinds(): MMKind[] {
  return (arg('mms') ?? 'naive,analytical,learned').split(',') as MMKind[];
}

function botConfig(i: number, mmKind: MMKind, alpha: number, mm: MMParams = {}): GameConfig {
  return makeConfig('medium', testSeed(i), { mmKind, alpha, mmLearnsFromPlayer: false, mm });
}

function summarizeMM(slice: GameSummary[]) {
  const sd = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
  };
  const mean = (f: (r: GameSummary) => number) => slice.reduce((a, r) => a + f(r), 0) / slice.length;
  return {
    pnl: meanCI(slice.map((r) => r.pnl.mm)),
    pnlSd: sd(slice.map((r) => r.pnl.mm)),
    spread: mean((r) => r.avgSpread),
    /** MM losses to informed bots (their P&L), and gains from noise bots (minus their P&L). */
    lossToInformed: mean((r) => r.pnl.informed),
    gainFromNoise: mean((r) => -r.pnl.noise),
    meanAbsInventory: mean((r) => r.meanAbsInventory),
    maxAbsInventory: mean((r) => r.maxAbsInventory),
    finalAbsInventory: mean((r) => Math.abs(r.finalInventory)),
    volume: mean((r) => r.volume.noise + r.volume.informed),
  };
}

async function runCells<C>(cells: C[], games: number, toTasks: (c: C) => SimTask[], label: string) {
  const tasks = cells.flatMap(toTasks);
  const res = await sims(tasks, label);
  return cells.map((c, ci) => ({ cell: c, slice: res.slice(ci * games, (ci + 1) * games) }));
}

/** α sweep: profit, spread and losses to informed traders, per market maker. */
async function alphaSweep() {
  const games = numArg('games', 800);
  const particles = numArg('particles', 5000);
  const alphas = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const cells = mmKinds().flatMap((mm) => alphas.map((alpha) => ({ mm, alpha })));
  const out = await runCells(
    cells,
    games,
    (c) =>
      Array.from({ length: games }, (_, i) => ({
        config: botConfig(i, c.mm, c.alpha, { particles }),
        player: 'pass' as const,
      })),
    'alpha-sweep',
  );
  const rows = out.map(({ cell, slice }) => ({ ...cell, ...summarizeMM(slice) }));
  for (const r of rows) {
    console.log(
      `${r.mm.padEnd(10)} α=${r.alpha} pnl ${r.pnl.mean.toFixed(1)}±${r.pnl.ci95.toFixed(1)} spread ${r.spread.toFixed(2)} informed ${r.lossToInformed.toFixed(1)}`,
    );
  }
  writeJson('research/alpha-sweep.json', { games, particles, seeds: 'test', player: 'passes', rows });
}

/** γ sweep: profit against inventory variability for the analytical MM (α = 0.25). */
async function gammaSweep() {
  const games = numArg('games', 800);
  const particles = numArg('particles', 5000);
  const gammas = [0, 0.0025, 0.005, 0.01, 0.02, 0.04];
  const out = await runCells(
    gammas,
    games,
    (gamma) =>
      Array.from({ length: games }, (_, i) => ({
        config: botConfig(i, 'analytical', 0.25, { particles, gamma }),
        player: 'pass' as const,
      })),
    'gamma-sweep',
  );
  const rows = out.map(({ cell, slice }) => ({ gamma: cell, ...summarizeMM(slice) }));
  for (const r of rows) {
    console.log(
      `γ=${r.gamma} pnl ${r.pnl.mean.toFixed(1)}±${r.pnl.ci95.toFixed(1)} sd ${r.pnlSd.toFixed(1)} |inv| ${r.meanAbsInventory.toFixed(2)} spread ${r.spread.toFixed(2)}`,
    );
  }
  writeJson('research/gamma-sweep.json', { games, particles, alpha: 0.25, seeds: 'test', rows });
}

/** Model mismatch: the MM's assumed α is wrong by ±50%. */
async function mismatch() {
  const games = numArg('games', 800);
  const particles = numArg('particles', 5000);
  const cells = [0.15, 0.35].flatMap((trueAlpha) => [0.5, 1, 1.5].map((factor) => ({ trueAlpha, factor })));
  const out = await runCells(
    cells,
    games,
    (c) =>
      Array.from({ length: games }, (_, i) => ({
        config: botConfig(i, 'analytical', c.trueAlpha, { particles, assumedAlpha: c.trueAlpha * c.factor }),
        player: 'pass' as const,
      })),
    'mismatch',
  );
  const rows = out.map(({ cell, slice }) => ({
    ...cell,
    assumedAlpha: cell.trueAlpha * cell.factor,
    ...summarizeMM(slice),
  }));
  for (const r of rows) {
    console.log(
      `true α=${r.trueAlpha} assumed ${r.assumedAlpha.toFixed(3)} pnl ${r.pnl.mean.toFixed(1)}±${r.pnl.ci95.toFixed(1)} spread ${r.spread.toFixed(2)} informed ${r.lossToInformed.toFixed(1)}`,
    );
  }
  writeJson('research/mismatch.json', { games, particles, seeds: 'test', rows });
}

/** P&L attribution per MM, with the Advisor bot playing (α = 0.25). */
async function attribution() {
  const games = numArg('games', 600);
  const particles = numArg('particles', 5000);
  const out = await runCells(
    mmKinds(),
    games,
    (mm) =>
      Array.from({ length: games }, (_, i) => ({
        config: makeConfig('medium', testSeed(i), {
          mmKind: mm,
          alpha: 0.25,
          mmLearnsFromPlayer: false,
          mm: { particles },
        }),
        player: 'advisor' as const,
        advisor: { particles },
      })),
    'attribution',
  );
  const rows = out.map(({ cell, slice }) => {
    const m = (f: (r: GameSummary) => number) => meanCI(slice.map(f));
    const parts = {
      spreadCapture: m((r) => r.mmAttribution.spreadCapture),
      adverseSelection: m((r) => r.mmAttribution.adverseSelection),
      inventory: m((r) => r.mmAttribution.inventory),
      player: m((r) => r.mmAttribution.player),
      total: m((r) => r.pnl.mm),
    };
    return {
      mm: cell,
      spreadCapture: parts.spreadCapture.mean,
      adverseSelection: parts.adverseSelection.mean,
      inventory: parts.inventory.mean,
      player: parts.player.mean,
      total: parts.total.mean,
      ci95: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.ci95])),
      spread: slice.reduce((a, r) => a + r.avgSpread, 0) / slice.length,
    };
  });
  for (const r of rows) console.log(r);
  writeJson('research/attribution.json', {
    games,
    particles,
    alpha: 0.25,
    player: 'advisor bot',
    seeds: 'test',
    rows,
  });
}

// ---- Faithfulness (spec §8.3) ------------------------------------------------------------------------------

/** Ablations: remove one analytical component at a time and check the effect its explanation claims. */
async function ablations() {
  const games = numArg('games', 800);
  const particles = numArg('particles', 5000);
  const variants: { name: string; mm: MMParams; claim: string }[] = [
    { name: 'Full analytical MM', mm: {}, claim: '' },
    { name: 'No inventory skew', mm: { disableSkew: true }, claim: 'inventory variability rises' },
    {
      name: 'No adverse-selection spread',
      mm: { disableAdverseSelection: true },
      claim: 'losses to informed traders rise',
    },
    {
      name: 'No risk half-spread',
      mm: { disableRiskSpread: true },
      claim: 'profit from noise traders falls',
    },
  ];
  const out = await runCells(
    variants,
    games,
    (v) =>
      Array.from({ length: games }, (_, i) => ({
        config: botConfig(i, 'analytical', 0.25, { particles, ...v.mm }),
        player: 'pass' as const,
      })),
    'ablations',
  );
  const rows = out.map(({ cell, slice }) => ({
    variant: cell.name,
    claim: cell.claim,
    ...summarizeMM(slice),
  }));
  for (const r of rows) {
    console.log(
      `${r.variant.padEnd(28)} pnl ${r.pnl.mean.toFixed(1)}±${r.pnl.ci95.toFixed(1)} sd ${r.pnlSd.toFixed(1)} |inv| ${r.meanAbsInventory.toFixed(2)} informed ${r.lossToInformed.toFixed(1)} noise ${r.gainFromNoise.toFixed(1)} spread ${r.spread.toFixed(2)}`,
    );
  }
  writeJson('research/ablations.json', { games, particles, alpha: 0.25, seeds: 'test', rows });
}

/** Counterfactual accuracy and Advisor attribution checks over random game states. */
async function faithfulness() {
  const states = numArg('states', 1000);
  const diffs: Difficulty[] = ['easy', 'medium', 'hard'];
  const tasks = Array.from({ length: states }, (_, i) => ({
    config: makeConfig(diffs[i % 3], testSeed(10_000 + i)),
    steps: 1 + (i % 31),
    seed: i,
  }));
  const cf = await runPool<(typeof tasks)[number], CounterfactualCheck>('cfcheck', tasks, {
    label: 'counterfactuals',
  });
  const at = await runPool<(typeof tasks)[number], AttributionCheck>('attrcheck', tasks, {
    label: 'attribution',
  });
  const checked = cf.reduce((a, r) => a + r.checked, 0);
  const matched = cf.reduce((a, r) => a + r.matched, 0);
  const diffsAbs = at.map((r) => Math.abs(r.claimed - r.independent)).sort((a, b) => a - b);
  const result = {
    counterfactual: { states, checked, matched, maxAbsDiff: Math.max(...cf.map((r) => r.maxAbsDiff)) },
    advisorAttribution: {
      states,
      meanAbsClaimed: at.reduce((a, r) => a + Math.abs(r.claimed), 0) / states,
      meanAbsDiff: diffsAbs.reduce((a, b) => a + b, 0) / states,
      p95AbsDiff: diffsAbs[Math.floor(0.95 * states)],
      within05: diffsAbs.filter((d) => d <= 0.5).length / states,
      sample: at.slice(0, 200),
    },
  };
  console.log(
    JSON.stringify(
      { ...result, advisorAttribution: { ...result.advisorAttribution, sample: undefined } },
      null,
      1,
    ),
  );
  writeJson('research/faithfulness.json', result);
}

/** Belief calibration over 2,000 games: market maker's view and player's view (spec §3). */
async function calibration() {
  const games = numArg('games', 2000);
  const tasks = Array.from({ length: games }, (_, i) => ({
    config: makeConfig('hard', testSeed(20_000 + i), { mmLearnsFromPlayer: false }),
  }));
  const res = await runPool<(typeof tasks)[number], CalibrationSample>('calib', tasks, {
    label: 'calibration',
  });
  const view = (k: 'mm' | 'player') => {
    const mus = res.map((r) => r[k].mu);
    const vs = res.map((r) => r.value);
    const mv = vs.reduce((a, b) => a + b, 0) / vs.length;
    const sst = vs.reduce((a, v) => a + (v - mv) ** 2, 0);
    const sse = vs.reduce((a, v, i) => a + (v - mus[i]) ** 2, 0);
    return {
      meanBuckets: quantileBuckets(mus, vs, 10),
      probBuckets: probabilityBuckets(
        res.map((r) => r[k].p),
        res.map((r) => (r.value > r[k].x ? 1 : 0)),
      ),
      r2: 1 - sse / sst,
      rmse: Math.sqrt(sse / vs.length),
    };
  };
  const out = { games, particles: 5000, alpha: 0.35, mm: view('mm'), player: view('player') };
  for (const k of ['mm', 'player'] as const) {
    console.log(
      `${k}: R² ${out[k].r2.toFixed(3)}, RMSE ${out[k].rmse.toFixed(2)}, mean buckets ok ${out[k].meanBuckets.filter((b) => b.ok).length}/10, prob buckets ok ${out[k].probBuckets.filter((b) => b.ok).length}/${out[k].probBuckets.length}`,
    );
  }
  writeJson('research/calibration.json', out);
}

async function all() {
  for (const e of [
    'calibration',
    'alpha',
    'gamma',
    'mismatch',
    'ablations',
    'attribution',
    'faithfulness',
    'advisor',
  ]) {
    console.log(`\n=== ${e} ===`);
    await experiments[e]();
  }
}

export const experiments: Record<string, () => Promise<void>> = {
  'advisor-tune': advisorTune,
  advisor: advisorResults,
  alpha: alphaSweep,
  gamma: gammaSweep,
  mismatch,
  attribution,
  ablations,
  faithfulness,
  calibration,
  all,
};
