/**
 * Noise traders trade for liquidity reasons unrelated to the cards. Each one wants to buy (probability 0.4), sell
 * (0.4) or do nothing (0.2), and has a random price tolerance τ ~ Exponential(mean τ̄). It trades only if the price is
 * at most τ worse than the expected value given the public cards, so wider spreads lose noise volume.
 */
import { NOISE_BUY_PROB, NOISE_SELL_PROB, NOISE_TOLERANCE_MEAN } from '../engine/rules';
import type { ActionSide, Quote } from '../engine/types';

export function noiseTolerance(uTol: number): number {
  return -NOISE_TOLERANCE_MEAN * Math.log(1 - uTol);
}

export function noiseDecision(uNoise: number, uTol: number, quote: Quote, publicEV: number): ActionSide {
  const tol = noiseTolerance(uTol);
  if (uNoise < NOISE_BUY_PROB) {
    return quote.ask !== null && quote.askSize > 0 && quote.ask - publicEV <= tol ? 'buy' : 'pass';
  }
  if (uNoise < NOISE_BUY_PROB + NOISE_SELL_PROB) {
    return quote.bid !== null && quote.bidSize > 0 && publicEV - quote.bid <= tol ? 'sell' : 'pass';
  }
  return 'pass';
}

/** P(a noise trader buys at `ask`), the same for every hidden-card assignment. */
export function noiseBuyProb(ask: number, publicEV: number): number {
  return NOISE_BUY_PROB * Math.exp(-Math.max(0, ask - publicEV) / NOISE_TOLERANCE_MEAN);
}

export function noiseSellProb(bid: number, publicEV: number): number {
  return NOISE_SELL_PROB * Math.exp(-Math.max(0, publicEV - bid) / NOISE_TOLERANCE_MEAN);
}
