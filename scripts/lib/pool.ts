/** A small worker-thread pool: splits tasks into chunks and runs them on all cores. */
import os from 'node:os';
import { Worker } from 'node:worker_threads';

export interface PoolOptions {
  workers?: number;
  chunk?: number;
  label?: string;
}

export async function runPool<T, R>(kind: string, tasks: T[], opts: PoolOptions = {}): Promise<R[]> {
  const nWorkers = Math.max(1, Math.min(opts.workers ?? os.cpus().length - 1, tasks.length));
  const chunk = opts.chunk ?? Math.max(1, Math.min(25, Math.ceil(tasks.length / (nWorkers * 4))));
  const results: R[] = new Array(tasks.length);
  let next = 0;
  let done = 0;
  const started = Date.now();
  const workerUrl = new URL('./worker.ts', import.meta.url);
  const report = () => {
    if (!opts.label || !process.stderr.isTTY) return;
    const s = (Date.now() - started) / 1000;
    process.stderr.write(`\r${opts.label}: ${done}/${tasks.length} (${s.toFixed(0)}s)   `);
  };
  await Promise.all(
    Array.from({ length: nWorkers }, async () => {
      const w = new Worker(workerUrl, { execArgv: ['--import', 'tsx'] });
      try {
        while (next < tasks.length) {
          const start = next;
          const batch = tasks.slice(start, start + chunk);
          next += batch.length;
          const out = await new Promise<R[]>((resolve, reject) => {
            const onMsg = (m: { results: R[] }) => {
              w.off('error', reject);
              resolve(m.results);
            };
            w.once('message', onMsg);
            w.once('error', reject);
            w.postMessage({ kind, tasks: batch });
          });
          out.forEach((r, i) => (results[start + i] = r));
          done += batch.length;
          report();
        }
      } finally {
        await w.terminate();
      }
    }),
  );
  if (opts.label && process.stderr.isTTY) process.stderr.write('\n');
  return results;
}
