/** Shared quote finishing: tick rounding, minimum spread and the MM position limit. */
import { MIN_SPREAD, MM_MAX_QUOTE_SIZE, MM_POSITION_LIMIT, roundToTick } from '../engine/rules';
import type { PublicView, Quote } from '../engine/types';

export interface FinishedQuote {
  quote: Quote;
  /** Final price minus raw price, per side (0 for an unquoted side). */
  rounding: { bid: number; ask: number };
}

/**
 * Round the bid down and the ask up to the 0.5 tick, enforce the 1.0 minimum spread, and drop the side that
 * would take the MM past ±25. The rounding adjustment includes any minimum-spread widening, so components plus
 * rounding always equal the posted price.
 */
export function finishQuote(rawBid: number, rawAsk: number, inventory: number): FinishedQuote {
  let bid = roundToTick(rawBid, 'down');
  let ask = roundToTick(rawAsk, 'up');
  if (ask - bid < MIN_SPREAD - 1e-9) {
    const mid = (rawBid + rawAsk) / 2;
    bid = roundToTick(mid - MIN_SPREAD / 2, 'down');
    ask = bid + MIN_SPREAD;
  }
  const bidSize = Math.max(0, Math.min(MM_MAX_QUOTE_SIZE, MM_POSITION_LIMIT - inventory));
  const askSize = Math.max(0, Math.min(MM_MAX_QUOTE_SIZE, MM_POSITION_LIMIT + inventory));
  const quote: Quote = {
    bid: bidSize > 0 ? bid : null,
    ask: askSize > 0 ? ask : null,
    bidSize,
    askSize,
  };
  return {
    quote,
    rounding: {
      bid: quote.bid === null ? 0 : quote.bid - rawBid,
      ask: quote.ask === null ? 0 : quote.ask - rawAsk,
    },
  };
}

/** A minimal public view for counterfactual replays, where only the round and step matter. */
export function replayView(round: number, step: number, mmPosition = 0): PublicView {
  return {
    config: {
      difficulty: 'medium',
      rounds: 4,
      stepsPerRound: 8,
      alpha: 0,
      playerCards: 1,
      mmKind: 'analytical',
      mmLearnsFromPlayer: false,
    },
    phase: 'awaitingPlayer',
    round,
    step,
    revealed: [],
    events: [],
    quote: { bid: null, ask: null, bidSize: 0, askSize: 0 },
    mmPosition,
  };
}
