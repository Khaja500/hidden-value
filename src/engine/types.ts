/** Types shared by the engine, agents, explanations, workers and UI. No runtime code lives here. */

/** A card is an integer 0..51; see cards.ts for rank and suit. */
export type Card = number;

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export type MMKind = 'naive' | 'analytical' | 'learned';

/** A taker's side: buy at the ask, sell at the bid. */
export type Side = 'buy' | 'sell';
export type ActionSide = Side | 'pass';
export type TakerKind = 'bot' | 'player';
export type BotType = 'noise' | 'informed';

/** Two-sided quote. A side is null (size 0) when the MM is at its position limit on that side. */
export interface Quote {
  bid: number | null;
  ask: number | null;
  bidSize: number;
  askSize: number;
}

export interface RevealEvent {
  kind: 'reveal';
  seq: number;
  round: number;
  position: number;
  card: Card;
}

/** A taker arriving at the quote: a trade (buy/sell) or a pass. Trader type is never included. */
export interface ActionEvent {
  kind: 'action';
  seq: number;
  round: number;
  step: number;
  taker: TakerKind;
  side: ActionSide;
  size: number;
  price: number | null;
  /** The quote the taker faced. */
  quote: Quote;
  /** Multiplayer: which player (0-based seat) acted. Absent in single-player games. */
  seat?: number;
}

export interface QuoteEvent {
  kind: 'quote';
  seq: number;
  round: number;
  step: number;
  quote: Quote;
}

export type PublicEvent = RevealEvent | ActionEvent | QuoteEvent;
/** Events agents learn from (quotes are produced by the MM itself). */
export type MarketEvent = RevealEvent | ActionEvent;

/** Market-maker settings that experiments may override. Not visible to the player. */
export interface MMParams {
  /** The MM's model of the informed share; defaults to the game's true α. */
  assumedAlpha?: number;
  /** Inventory risk aversion γ. */
  gamma?: number;
  /** Multiplier on γ·Var for the risk half-spread. */
  riskCoef?: number;
  particles?: number;
  /** Ablations used by the research experiments. */
  disableSkew?: boolean;
  disableAdverseSelection?: boolean;
  disableRiskSpread?: boolean;
  /** Learned MM variant. */
  learnedVariant?: 'linear' | 'mlp';
  /** Counterfactual replays: quote as if the inventory were this value. */
  inventoryOverride?: number;
}

export interface GameConfig {
  seed: number;
  difficulty: Difficulty;
  rounds: number;
  stepsPerRound: number;
  /** True share of informed bot traders. */
  alpha: number;
  playerCards: 1 | 2;
  mmKind: MMKind;
  /** Hard mode: the MM treats the player as a possibly informed taker. */
  mmLearnsFromPlayer: boolean;
  mm: MMParams;
  /** Multiplayer: the number of players sharing one screen (2–4), each holding one card. Absent in single-player games. */
  seats?: number;
}

/** The parts of the config that the player (and everyone else) can see. */
export interface PublicConfig {
  difficulty: Difficulty;
  rounds: number;
  stepsPerRound: number;
  alpha: number;
  playerCards: 1 | 2;
  mmKind: MMKind;
  mmLearnsFromPlayer: boolean;
  seats?: number;
}

export type Phase = 'awaitingPlayer' | 'settled';

export interface Revealed {
  position: number;
  card: Card;
  round: number;
}

/** What everyone can see: revealed cards, every trade and quote, and the MM's inventory (implied by the trades). */
export interface PublicView {
  config: PublicConfig;
  phase: Phase;
  round: number;
  step: number;
  revealed: readonly Revealed[];
  events: readonly PublicEvent[];
  quote: Quote;
  mmPosition: number;
}

export interface PlayerAccount {
  position: number;
  cash: number;
  /** Average entry price of the open position, null when flat. */
  avgPrice: number | null;
}

/** What the player can see: the public view plus their own private card(s) and account. */
export interface PlayerView extends PublicView {
  privateCards: readonly { position: number; card: Card }[];
  player: PlayerAccount;
  /** Largest legal buy / sell size right now. */
  maxBuy: number;
  maxSell: number;
  /** Multiplayer: the player (0-based seat) this view belongs to. */
  seat?: number;
}

export interface Settlement {
  cards: Card[];
  value: number;
  pnl: { player: number; mm: number; noise: number; informed: number };
}

export interface SettledView extends PlayerView {
  settlement: Settlement;
}

export interface PlayerAction {
  side: ActionSide;
  size: number;
}

export interface FairValueReason {
  cause: 'reveal' | 'orderFlow' | 'playerFlow';
  card?: Card;
  detail?: string;
  delta: number;
}

export interface Counterfactual {
  if: string;
  bid: number | null;
  ask: number | null;
  /** What was changed, so the counterfactual can be checked against a real replay. */
  change: { kind: 'inventory'; value: number } | { kind: 'remove'; seqs: number[] };
}

/** A per-feature breakdown of a learned-MM quote via its distilled linear model. */
export interface LearnedContribution {
  feature: string;
  value: number;
  offset: number;
  halfSpread: number;
}

/**
 * Breakdown of one quote. For every side that is quoted:
 *   bid = fairValue + adverseSelection.bidOffset + learnedOffset + inventory.skew − riskHalfSpread − fixedHalfSpread + rounding.bid
 *   ask = fairValue + adverseSelection.askOffset + learnedOffset + inventory.skew + riskHalfSpread + fixedHalfSpread + rounding.ask
 */
export interface QuoteExplanation {
  mmKind: MMKind;
  round: number;
  step: number;
  fairValue: number;
  fairValueChange: { from: number; reasons: FairValueReason[] };
  adverseSelection: { bidOffset: number; askOffset: number };
  inventory: { position: number; skew: number };
  riskHalfSpread: number;
  fixedHalfSpread: number;
  learnedOffset: number;
  rounding: { bid: number; ask: number };
  bid: number | null;
  ask: number | null;
  bidSize: number;
  askSize: number;
  counterfactuals: Counterfactual[];
  learned?: {
    fidelity: number;
    contributions: LearnedContribution[];
    distilledOffset: number;
    distilledHalfSpread: number;
    /** How much one more unit of inventory moves both prices right now (distilled model). */
    inventoryPerUnit: number;
  };
}

export interface MarketMaker {
  readonly kind: MMKind;
  onEvent(e: MarketEvent): void;
  quote(view: PublicView): Quote;
  /** Breakdown of the last quote. Counterfactuals need replays, so they can be skipped when not displayed. */
  explain(opts?: { counterfactuals?: boolean }): QuoteExplanation;
  /** Current fair value μ without building a full explanation. */
  fairValue(): number;
}
