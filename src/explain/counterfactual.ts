/** Replays a market maker with one change, to check (or compute) a counterfactual quote. */
import { createMarketMaker } from '../agents/factory';
import { replayView } from '../agents/quoting';
import type { Counterfactual, GameConfig, MarketEvent, PublicEvent, Quote } from '../engine/types';

/**
 * Builds a fresh market maker for `config`, feeds it every market event in `events` except the removed ones, and
 * returns the quote it posts. `events` must be the public log up to (and including) the quote being explained.
 */
export function replayCounterfactual(
  config: GameConfig,
  events: readonly PublicEvent[],
  change: Counterfactual['change'],
  round: number,
  step: number,
): Quote {
  const cfg: GameConfig =
    change.kind === 'inventory'
      ? { ...config, mm: { ...config.mm, inventoryOverride: change.value } }
      : config;
  const mm = createMarketMaker(cfg);
  const removed = new Set(change.kind === 'remove' ? change.seqs : []);
  for (const e of events) {
    if (e.kind === 'quote' || removed.has(e.seq)) continue;
    mm.onEvent(e as MarketEvent);
  }
  return mm.quote(replayView(round, step));
}
