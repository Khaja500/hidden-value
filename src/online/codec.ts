/**
 * A compact encoding of the public view for the online room document. Every client downloads the whole room
 * document each time anyone acts, so the event log is packed as tuples (about a quarter of the size of plain
 * JSON). Nothing is dropped: an event's `seq` is its index, and the quote an action faced is the quote in force
 * before it, which is always the latest quote event (the market maker requotes after every bot and player).
 */
import type { MultiPublicView } from '../engine/multiGame';
import type { ActionEvent, ActionSide, PublicEvent, Quote } from '../engine/types';

type PackedQuote = [bid: number | null, ask: number | null, bidSize: number, askSize: number];
type PackedEvent =
  | [0, round: number, step: number, ...PackedQuote]
  | [
      1,
      round: number,
      step: number,
      bot: 0 | 1,
      side: 0 | 1 | 2,
      size: number,
      price: number | null,
      seat: number,
    ]
  | [2, round: number, position: number, card: number];

const SIDES: ActionSide[] = ['pass', 'buy', 'sell'];

function packQuote(q: Quote): PackedQuote {
  return [q.bid, q.ask, q.bidSize, q.askSize];
}

function unpackQuote(p: PackedQuote): Quote {
  return Object.freeze({ bid: p[0], ask: p[1], bidSize: p[2], askSize: p[3] });
}

function packEvent(e: PublicEvent): PackedEvent {
  switch (e.kind) {
    case 'quote':
      return [0, e.round, e.step, ...packQuote(e.quote)];
    case 'action':
      return [
        1,
        e.round,
        e.step,
        e.taker === 'bot' ? 0 : 1,
        SIDES.indexOf(e.side) as 0 | 1 | 2,
        e.size,
        e.price,
        e.seat ?? -1,
      ];
    case 'reveal':
      return [2, e.round, e.position, e.card];
  }
}

export function packEvents(events: readonly PublicEvent[]): PackedEvent[] {
  let quote: Quote | null = null;
  return events.map((e, i) => {
    if (e.seq !== i) throw new Error(`Event ${i} has seq ${e.seq}`);
    if (e.kind === 'quote') quote = e.quote;
    if (e.kind === 'action' && JSON.stringify(quote) !== JSON.stringify(e.quote))
      throw new Error(`Action ${i} did not face the latest quote`);
    return packEvent(e);
  });
}

export function unpackEvents(packed: readonly PackedEvent[]): PublicEvent[] {
  let quote: Quote | null = null;
  return packed.map((p, seq): PublicEvent => {
    switch (p[0]) {
      case 0: {
        quote = unpackQuote([p[3], p[4], p[5], p[6]]);
        return Object.freeze({ kind: 'quote', seq, round: p[1], step: p[2], quote });
      }
      case 1: {
        if (!quote) throw new Error(`Action ${seq} before any quote`);
        const e: ActionEvent = {
          kind: 'action',
          seq,
          round: p[1],
          step: p[2],
          taker: p[3] === 0 ? 'bot' : 'player',
          side: SIDES[p[4]],
          size: p[5],
          price: p[6],
          quote,
        };
        if (p[7] >= 0) e.seat = p[7];
        return Object.freeze(e);
      }
      case 2:
        return Object.freeze({ kind: 'reveal', seq, round: p[1], position: p[2], card: p[3] });
    }
  });
}

/** The public view as a JSON string, with the event log packed. */
export function encodePublicView(v: MultiPublicView): string {
  return JSON.stringify({ ...v, events: packEvents(v.events) });
}

export function decodePublicView(s: string): MultiPublicView {
  const raw = JSON.parse(s) as Omit<MultiPublicView, 'events'> & { events: PackedEvent[] };
  return { ...raw, events: unpackEvents(raw.events) };
}
