/** Worker entry for scripts/lib/pool.ts. Each message is a batch of tasks of one kind. */
import { parentPort } from 'node:worker_threads';
import { simulateGame, type SimTask } from '../../src/sim/simulate';
import { handlers as extra } from './handlers';

const handlers: Record<string, (task: never) => unknown> = {
  sim: (t: SimTask) => simulateGame(t),
  ...extra,
};

parentPort!.on('message', (msg: { kind: string; tasks: unknown[] }) => {
  const h = handlers[msg.kind];
  if (!h) throw new Error(`Unknown task kind ${msg.kind}`);
  parentPort!.postMessage({ results: msg.tasks.map((t) => h(t as never)) });
});
