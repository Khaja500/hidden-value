/**
 * The information boundaries. Views are built as plain data from the full state: PublicView for the MM,
 * PlayerView for the player, the Advisor and the UI. Events are frozen when created and contain no hidden
 * information, so views may share them; arrays are copied so a view never changes after it is built.
 */
import { rankOf } from './cards';
import { PLAYER_MAX_TRADE, PLAYER_POSITION_LIMIT } from './rules';
import { settleAccount, type FullState } from './state';
import type {
  GameConfig,
  PlayerView,
  PublicConfig,
  PublicView,
  Quote,
  SettledView,
  Settlement,
} from './types';

export function publicConfig(c: GameConfig): PublicConfig {
  return {
    difficulty: c.difficulty,
    rounds: c.rounds,
    stepsPerRound: c.stepsPerRound,
    alpha: c.alpha,
    playerCards: c.playerCards,
    mmKind: c.mmKind,
    mmLearnsFromPlayer: c.mmLearnsFromPlayer,
  };
}

export function toPublicView(s: FullState): PublicView {
  return {
    config: publicConfig(s.config),
    phase: s.phase,
    round: s.round,
    step: s.step,
    revealed: s.revealed.slice(),
    events: s.events.slice(),
    quote: s.quote,
    mmPosition: s.accounts.mm.position,
  };
}

export function privatePositions(config: Pick<GameConfig, 'playerCards'>): number[] {
  return config.playerCards === 2 ? [0, 1] : [0];
}

export function maxBuyFor(position: number, q: Quote): number {
  if (q.ask === null) return 0;
  return Math.max(0, Math.min(PLAYER_MAX_TRADE, q.askSize, PLAYER_POSITION_LIMIT - position));
}

export function maxSellFor(position: number, q: Quote): number {
  if (q.bid === null) return 0;
  return Math.max(0, Math.min(PLAYER_MAX_TRADE, q.bidSize, PLAYER_POSITION_LIMIT + position));
}

export function toPlayerView(s: FullState): PlayerView {
  const pub = toPublicView(s);
  const p = s.accounts.player;
  const open = s.phase === 'awaitingPlayer';
  return {
    ...pub,
    privateCards: privatePositions(s.config).map((position) =>
      Object.freeze({ position, card: s.cards[position] }),
    ),
    player: { position: p.position, cash: p.cash, avgPrice: s.playerAvgPrice },
    maxBuy: open ? maxBuyFor(p.position, s.quote) : 0,
    maxSell: open ? maxSellFor(p.position, s.quote) : 0,
  };
}

export function settlementOf(s: FullState): Settlement {
  if (s.phase !== 'settled') throw new Error('Game is not settled yet');
  const value = s.cards.reduce((a, c) => a + rankOf(c), 0);
  return {
    cards: [...s.cards],
    value,
    pnl: {
      player: settleAccount(s.accounts.player, value),
      mm: settleAccount(s.accounts.mm, value),
      noise: settleAccount(s.accounts.noise, value),
      informed: settleAccount(s.accounts.informed, value),
    },
  };
}

/** Only callable after settlement, when every card is public. */
export function toSettledView(s: FullState): SettledView {
  return { ...toPlayerView(s), settlement: settlementOf(s) };
}
