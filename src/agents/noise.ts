/** Noise traders trade for reasons unrelated to value: buy, sell or pass at fixed rates, whatever the price. */
import { NOISE_BUY_PROB, NOISE_SELL_PROB } from '../engine/rules';
import type { ActionSide, Quote } from '../engine/types';

export function noiseDecision(uNoise: number, quote: Quote): ActionSide {
  if (uNoise < NOISE_BUY_PROB) return quote.ask !== null && quote.askSize > 0 ? 'buy' : 'pass';
  if (uNoise < NOISE_BUY_PROB + NOISE_SELL_PROB)
    return quote.bid !== null && quote.bidSize > 0 ? 'sell' : 'pass';
  return 'pass';
}
