/**
 * A persistent worker-thread pool: tasks are split into chunks and run on all cores. Workers are created once per
 * process and unref'd, so they never keep the process alive.
 */
import os from 'node:os';
import { Worker } from 'node:worker_threads';

export interface PoolOptions {
  workers?: number;
  chunk?: number;
  label?: string;
}

const workers: Worker[] = [];

function getWorkers(n: number): Worker[] {
  while (workers.length < n) {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { execArgv: ['--import', 'tsx'] });
    w.unref();
    workers.push(w);
  }
  return workers.slice(0, n);
}

function call<R>(w: Worker, kind: string, tasks: unknown[]): Promise<R[]> {
  return new Promise<R[]>((resolve, reject) => {
    const onMsg = (m: { results: R[] }) => {
      w.off('error', onErr);
      resolve(m.results);
    };
    const onErr = (e: Error) => {
      w.off('message', onMsg);
      reject(e);
    };
    w.once('message', onMsg);
    w.once('error', onErr);
    w.postMessage({ kind, tasks });
  });
}

export async function runPool<T, R>(kind: string, tasks: T[], opts: PoolOptions = {}): Promise<R[]> {
  const nWorkers = Math.max(1, Math.min(opts.workers ?? os.cpus().length - 1, tasks.length));
  const chunk = opts.chunk ?? Math.max(1, Math.min(25, Math.ceil(tasks.length / (nWorkers * 4))));
  const results: R[] = new Array(tasks.length);
  let next = 0;
  let done = 0;
  const started = Date.now();
  const report = () => {
    if (!opts.label || !process.stderr.isTTY) return;
    process.stderr.write(
      `\r${opts.label}: ${done}/${tasks.length} (${((Date.now() - started) / 1000).toFixed(0)}s)   `,
    );
  };
  await Promise.all(
    getWorkers(nWorkers).map(async (w) => {
      while (next < tasks.length) {
        const start = next;
        const batch = tasks.slice(start, start + chunk);
        next += batch.length;
        const out = await call<R>(w, kind, batch);
        out.forEach((r, i) => (results[start + i] = r));
        done += batch.length;
        report();
      }
    }),
  );
  if (opts.label && process.stderr.isTTY) process.stderr.write('\n');
  return results;
}
