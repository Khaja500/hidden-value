/** Quick check (plan step 4): naive vs analytical MM P&L across α, bots only. `npx tsx scripts/quickcheck.ts [games]` */
import { createGame } from '../src/agents/factory';
import { makeConfig } from '../src/engine/rules';
import type { MMKind } from '../src/engine/types';

const GAMES = Number(process.argv[2] ?? 300);
const extra = process.argv[3] ? JSON.parse(process.argv[3]) : {};
function run(mmKind: MMKind, alpha: number) {
  const pnl: number[] = [];
  let spread = 0;
  let nq = 0;
  let inf = 0;
  let noise = 0;
  for (let g = 0; g < GAMES; g++) {
    const config = makeConfig('medium', 5000 + g, { mmKind, alpha, mm: { particles: 2000, ...extra } });
    const game = createGame(config);
    while (game.phase !== 'settled') {
      const q = game.view().quote;
      if (q.bid !== null && q.ask !== null) {
        spread += q.ask - q.bid;
        nq++;
      }
      game.act({ side: 'pass', size: 0 });
    }
    const s = game.settlement();
    pnl.push(s.pnl.mm);
    inf += s.pnl.informed;
    noise += s.pnl.noise;
  }
  const m = pnl.reduce((a, b) => a + b, 0) / GAMES;
  const sd = Math.sqrt(pnl.reduce((a, x) => a + (x - m) ** 2, 0) / (GAMES - 1));
  return {
    m,
    ci: (1.96 * sd) / Math.sqrt(GAMES),
    spread: spread / nq,
    inf: inf / GAMES,
    noise: noise / GAMES,
  };
}
const t0 = Date.now();
for (const alpha of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
  const row = [`α=${alpha.toFixed(1)}`];
  for (const k of ['naive', 'analytical'] as MMKind[]) {
    const r = run(k, alpha);
    row.push(
      `${k.padEnd(10)} pnl ${r.m.toFixed(1).padStart(6)} ±${r.ci.toFixed(1).padStart(4)} spread ${r.spread.toFixed(2)} noise ${r.noise.toFixed(1).padStart(6)} informed ${r.inf.toFixed(1).padStart(6)}`,
    );
  }
  console.log(row.join(' | '));
}
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
