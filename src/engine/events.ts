/** Helpers over the public event log. Everything here uses public information only. */
import type { ActionEvent, PublicEvent, Quote, RevealEvent } from './types';

export function isAction(e: PublicEvent): e is ActionEvent {
  return e.kind === 'action';
}

export function isTrade(e: PublicEvent): e is ActionEvent {
  return e.kind === 'action' && e.side !== 'pass';
}

export function isReveal(e: PublicEvent): e is RevealEvent {
  return e.kind === 'reveal';
}

/** Net units the takers bought from the MM (MM inventory is the negative of this). */
export function takerNetFlow(events: readonly PublicEvent[]): number {
  let net = 0;
  for (const e of events) {
    if (e.kind !== 'action' || e.side === 'pass') continue;
    net += e.side === 'buy' ? e.size : -e.size;
  }
  return net;
}

export function mmPositionFrom(events: readonly PublicEvent[]): number {
  return -takerNetFlow(events);
}

/**
 * Signed bot order-flow imbalance over the last `steps` bot arrivals: (+1 per buy, −1 per sell, 0 per pass).
 * Used as a learned-MM feature and in explanations.
 */
export function botImbalance(events: readonly PublicEvent[], steps: number): number {
  let seen = 0;
  let imb = 0;
  for (let i = events.length - 1; i >= 0 && seen < steps; i--) {
    const e = events[i];
    if (e.kind !== 'action' || e.taker !== 'bot') continue;
    seen++;
    if (e.side === 'buy') imb += 1;
    else if (e.side === 'sell') imb -= 1;
  }
  return imb;
}

export function emptyQuote(): Quote {
  return { bid: null, ask: null, bidSize: 0, askSize: 0 };
}

export function quoteMid(q: Quote): number | null {
  if (q.bid === null || q.ask === null) return q.bid ?? q.ask;
  return (q.bid + q.ask) / 2;
}

export function quoteSpread(q: Quote): number | null {
  if (q.bid === null || q.ask === null) return null;
  return q.ask - q.bid;
}

export function sameQuote(a: Quote, b: Quote): boolean {
  return a.bid === b.bid && a.ask === b.ask && a.bidSize === b.bidSize && a.askSize === b.askSize;
}

export function describeAction(e: ActionEvent, you = 'You'): string {
  const who = e.taker === 'player' ? you : 'A trader';
  if (e.side === 'pass') return `${who} passed`;
  const verb = e.side === 'buy' ? 'bought' : 'sold';
  return `${who} ${verb} ${e.size} at ${e.price?.toFixed(1)}`;
}
