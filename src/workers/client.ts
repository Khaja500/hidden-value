/** Promise-based calls into the simulation worker, with a main-thread fallback when Workers are unavailable. */
import { handlers } from './handlers';

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as {
      id: number;
      kind: string;
      result?: unknown;
      message?: string;
      done?: number;
      total?: number;
    };
    const p = pending.get(m.id);
    if (!p) return;
    if (m.kind === 'progress') p.onProgress?.(m.done!, m.total!);
    else {
      pending.delete(m.id);
      if (m.kind === 'result') p.resolve(m.result);
      else p.reject(new Error(m.message));
    }
  };
  return worker;
}

export function callWorker<T>(
  type: string,
  payload: unknown,
  onProgress?: (done: number, total: number) => void,
): Promise<T> {
  const w = getWorker();
  if (!w) {
    // No Worker (tests, very old browsers): run on the main thread after the current task.
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        try {
          const h = (handlers as Record<string, (p: unknown, pr: (d: number, t: number) => void) => unknown>)[
            type
          ];
          resolve(h(payload, onProgress ?? (() => {})) as T);
        } catch (err) {
          reject(err as Error);
        }
      }, 0);
    });
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    w.postMessage({ id, type, payload });
  });
}
