/** Benchmarks particle-filter update times: `npx tsx scripts/bench.ts`. */
import { createGame } from '../src/agents/factory';
import { ParticleFilter } from '../src/belief/particleFilter';
import { rankOf } from '../src/engine/cards';
import { makeConfig } from '../src/engine/rules';

const N = Number(process.argv[2] ?? 5000);
const times: Record<string, number[]> = { observe: [], reveal: [], gm: [] };
for (let g = 0; g < 20; g++) {
  const game = createGame(makeConfig('hard', 1000 + g));
  while (game.phase !== 'settled') game.act({ side: 'pass', size: 0 });
  const st = game.fullState();
  const f = new ParticleFilter({ alpha: 0.35, seed: g, particles: N });
  for (const e of st.events) {
    const t0 = performance.now();
    if (e.kind === 'reveal') {
      f.reveal(e.position, rankOf(e.card));
      f.mean();
      times.reveal.push(performance.now() - t0);
    } else if (e.kind === 'action') {
      f.observe(e);
      f.mean();
      times.observe.push(performance.now() - t0);
      const t1 = performance.now();
      f.glostenMilgrom();
      times.gm.push(performance.now() - t1);
    }
  }
}
const BUDGET_MS = 30;
let ok = true;
for (const [k, v] of Object.entries(times)) {
  const s = v.slice().sort((a, b) => a - b);
  const median = s[s.length >> 1];
  console.log(
    `${k.padEnd(8)} n=${s.length} median=${median.toFixed(2)}ms p95=${s[Math.floor(s.length * 0.95)].toFixed(2)}ms max=${s[s.length - 1].toFixed(2)}ms`,
  );
  if (median > BUDGET_MS) ok = false;
}
console.log(ok ? `OK: median updates under ${BUDGET_MS} ms` : `FAIL: median update over ${BUDGET_MS} ms`);
if (!ok) process.exit(1);
