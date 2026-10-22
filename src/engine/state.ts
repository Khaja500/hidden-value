/** The full, hidden game state. Only the engine (and tests or post-settlement review) ever sees this. */
import type { BotType, Card, GameConfig, Phase, PlayerAction, PublicEvent, Quote, Revealed } from './types';

export interface Account {
  position: number;
  cash: number;
}

/** One bot arrival, drawn up front from the bot RNG so the same seed gives the same bots whatever the player does. */
export interface BotTicket {
  type: BotType;
  /** Card positions an informed bot sees (unused for noise bots). */
  positions: number[];
  /** Uniform draw that decides a noise bot's side. */
  uNoise: number;
  /** Uniform draw for a noise bot's price tolerance. */
  uTol: number;
  /** Desired trade size 1..3, capped by the quoted size. */
  size: number;
}

/** What actually happened at each bot arrival, including the hidden trader type. */
export interface BotRecord {
  round: number;
  step: number;
  type: BotType;
  positions: number[];
  valuation: number | null;
  seq: number;
}

export interface FullState {
  config: GameConfig;
  /** The 5 hidden cards, by position. Position 0 (and 1 in Easy) are the player's private cards. */
  cards: Card[];
  /** Positions revealed at the start of rounds 2, 3, 4, in order. */
  revealOrder: number[];
  tickets: BotTicket[];
  phase: Phase;
  round: number;
  step: number;
  events: PublicEvent[];
  revealed: Revealed[];
  botRecords: BotRecord[];
  actions: PlayerAction[];
  quote: Quote;
  accounts: { player: Account; mm: Account; noise: Account; informed: Account };
  playerAvgPrice: number | null;
}

export function newAccount(): Account {
  return { position: 0, cash: 0 };
}

export function settleAccount(a: Account, value: number): number {
  return a.cash + a.position * value;
}
