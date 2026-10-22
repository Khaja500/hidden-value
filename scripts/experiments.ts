/** Experiment registry for `npm run sim -- --exp <name>`. */
import { DEFAULT_ADVISOR_PARAMS, type AdvisorParams } from '../src/agents/advisor';
import { probabilityBuckets } from '../src/belief/calibration';
import { makeConfig } from '../src/engine/rules';
import type { Difficulty } from '../src/engine/types';
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

export const experiments: Record<string, () => Promise<void>> = {
  'advisor-tune': advisorTune,
  advisor: advisorResults,
};
