/// <reference lib="webworker" />
/** Web Worker: runs heavy simulations so the page never freezes. */
import { handlers } from './handlers';

interface Request {
  id: number;
  type: string;
  payload: unknown;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage: (m: unknown) => void;
};

ctx.onmessage = (e) => {
  const { id, type, payload } = e.data;
  const h = (handlers as Record<string, (p: unknown, progress: (d: number, t: number) => void) => unknown>)[
    type
  ];
  try {
    if (!h) throw new Error(`Unknown job ${type}`);
    const result = h(payload, (done, total) => ctx.postMessage({ id, kind: 'progress', done, total }));
    ctx.postMessage({ id, kind: 'result', result });
  } catch (err) {
    ctx.postMessage({ id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
