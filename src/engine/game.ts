/**
 * The game driver (spec §2.3–2.6). Each step: the MM quotes, one bot arrives and acts, the MM requotes, then the
 * player acts once and the MM requotes again. Rounds 2–4 start with one public reveal. Everything random comes from
 * seeded streams, so (config, player actions) replays the identical event log.
 */
import { informedDecision, valuationFromPositions } from '../agents/informed';
import { noiseDecision } from '../agents/noise';
import { DECK_SIZE, expectedValue, HAND_SIZE, rankOf } from './cards';
import { hashSeed, Rng } from './rng';
import { BOT_MAX_SIZE, INFORMED_K_PROBS } from './rules';
import { newAccount, type Account, type BotTicket, type FullState } from './state';
import type {
  ActionEvent,
  ActionSide,
  GameConfig,
  MarketMaker,
  PlayerAction,
  PlayerView,
  PublicConfig,
  PublicEvent,
  PublicView,
  Quote,
  Revealed,
  SettledView,
  Side,
} from './types';
import {
  maxBuyFor,
  maxSellFor,
  privatePositions,
  publicConfig,
  settlementOf,
  toPlayerView,
  toPublicView,
  toSettledView,
} from './views';

export interface GameHooks {
  /** Called after every MM quote (used by Review to capture explanations). */
  onQuote?: (quote: Quote, mm: MarketMaker, state: Readonly<FullState>) => void;
}

export function publicExpectedValue(revealed: readonly { card: number }[]): number {
  let sum = 0;
  for (const r of revealed) sum += rankOf(r.card);
  return expectedValue(sum, revealed.length);
}

export function freezeQuote(q: Quote): Quote {
  return Object.freeze({ bid: q.bid, ask: q.ask, bidSize: q.bidSize, askSize: q.askSize });
}

/**
 * Deals the 5 cards and the reveal order. Reveals come from positions no player holds. Only in multiplayer games
 * with 3–4 players are there too few of those; the remaining reveals are then players' cards, in random order.
 */
export function dealCards(config: GameConfig): { cards: number[]; revealOrder: number[] } {
  const rng = new Rng(hashSeed(config.seed, 'deal'));
  const deck = rng.shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i));
  const cards = deck.slice(0, HAND_SIZE);
  const priv = privatePositions(config);
  const revealable = rng.shuffle([0, 1, 2, 3, 4].filter((p) => !priv.includes(p)));
  if (config.seats && revealable.length < config.rounds - 1) revealable.push(...rng.shuffle(priv));
  return { cards, revealOrder: revealable.slice(0, config.rounds - 1) };
}

/** What a bot does at a quote: its side, the size and price it trades at, and an informed bot's valuation. */
export function botDecision(
  t: BotTicket,
  q: Quote,
  cards: readonly number[],
  revealed: readonly Revealed[],
): { side: ActionSide; size: number; price: number | null; valuation: number | null } {
  let side: ActionSide;
  let valuation: number | null = null;
  if (t.type === 'noise') {
    side = noiseDecision(t.uNoise, t.uTol, q, publicExpectedValue(revealed));
  } else {
    const known = [...revealed.map((r) => r.position), ...t.positions];
    valuation = valuationFromPositions(cards, known);
    side = informedDecision(valuation, q);
  }
  if (side === 'buy') return { side, size: Math.min(t.size, q.askSize), price: q.ask, valuation };
  if (side === 'sell') return { side, size: Math.min(t.size, q.bidSize), price: q.bid, valuation };
  return { side, size: 0, price: null, valuation };
}

/** Books a taker's trade against the market maker. */
export function applyTrade(taker: Account, mm: Account, side: Side, size: number, price: number): void {
  const dir = side === 'buy' ? 1 : -1;
  taker.position += dir * size;
  taker.cash -= dir * size * price;
  mm.position -= dir * size;
  mm.cash += dir * size * price;
}

/** The average entry price of a position after a trade (null when the trade leaves it flat). */
export function nextAvgPrice(
  pos: number,
  avg: number | null,
  side: Side,
  size: number,
  price: number,
): number | null {
  const delta = side === 'buy' ? size : -size;
  const next = pos + delta;
  if (next === 0) return null;
  if (pos === 0 || Math.sign(pos) !== Math.sign(next)) return price;
  if (Math.sign(delta) === Math.sign(pos))
    return ((avg ?? price) * Math.abs(pos) + price * size) / Math.abs(next);
  return avg;
}

/** Bot arrivals are drawn up front with a fixed number of draws per step (common random numbers across α). */
export function drawTickets(config: GameConfig): BotTicket[] {
  const rng = new Rng(hashSeed(config.seed, 'bots'));
  const tickets: BotTicket[] = [];
  for (let i = 0; i < config.rounds * config.stepsPerRound; i++) {
    const uType = rng.next();
    const uK = rng.next();
    const perm = rng.shuffle([0, 1, 2, 3, 4]);
    const uNoise = rng.next();
    const uTol = rng.next();
    const size = 1 + rng.int(BOT_MAX_SIZE);
    const informed = uType < config.alpha;
    const k = uK < INFORMED_K_PROBS[0] ? 1 : 2;
    tickets.push({ type: informed ? 'informed' : 'noise', positions: perm.slice(0, k), uNoise, uTol, size });
  }
  return tickets;
}

export class Game {
  readonly config: GameConfig;
  private readonly s: FullState;
  private readonly mm: MarketMaker;
  private readonly hooks: GameHooks;
  private readonly pubConfig: PublicConfig;

  constructor(config: GameConfig, mm: MarketMaker, hooks: GameHooks = {}) {
    if (config.rounds - 1 > HAND_SIZE - config.playerCards) throw new Error('Not enough cards to reveal');
    this.config = config;
    this.mm = mm;
    this.hooks = hooks;
    this.pubConfig = Object.freeze(publicConfig(config));
    const { cards, revealOrder } = dealCards(config);
    this.s = {
      config,
      cards,
      revealOrder,
      tickets: drawTickets(config),
      phase: 'awaitingPlayer',
      round: 1,
      step: 1,
      events: [],
      revealed: [],
      botRecords: [],
      actions: [],
      quote: freezeQuote({ bid: null, ask: null, bidSize: 0, askSize: 0 }),
      accounts: { player: newAccount(), mm: newAccount(), noise: newAccount(), informed: newAccount() },
      playerAvgPrice: null,
    };
    this.startRound(1);
  }

  get phase() {
    return this.s.phase;
  }

  get marketMaker(): MarketMaker {
    return this.mm;
  }

  /** The player's view: private cards, public information and their account. Never any hidden card. */
  view(): PlayerView {
    return toPlayerView(this.s);
  }

  publicView(): PublicView {
    return toPublicView(this.s);
  }

  /** Every card and P&L. Throws until the game is settled. */
  settledView(): SettledView {
    return toSettledView(this.s);
  }

  settlement() {
    return settlementOf(this.s);
  }

  /** The complete hidden state, deep-copied. For tests, simulations and post-game review only. */
  fullState(): FullState {
    return structuredClone(this.s);
  }

  actions(): PlayerAction[] {
    return this.s.actions.map((a) => ({ ...a }));
  }

  /** Cheap view for the MM: shares the (frozen) event list instead of copying it on every quote. */
  private mmView(): PublicView {
    const s = this.s;
    return {
      config: this.pubConfig,
      phase: s.phase,
      round: s.round,
      step: s.step,
      revealed: s.revealed,
      events: s.events,
      quote: s.quote,
      mmPosition: s.accounts.mm.position,
    };
  }

  private push<E extends PublicEvent>(e: E): E {
    Object.freeze(e);
    this.s.events.push(e);
    return e;
  }

  private requote(): void {
    const q = freezeQuote(this.mm.quote(this.mmView()));
    this.s.quote = q;
    this.push({ kind: 'quote', seq: this.s.events.length, round: this.s.round, step: this.s.step, quote: q });
    this.hooks.onQuote?.(q, this.mm, this.s);
  }

  private startRound(round: number): void {
    const s = this.s;
    s.round = round;
    s.step = 1;
    if (round >= 2) {
      const position = s.revealOrder[round - 2];
      const card = s.cards[position];
      const ev = this.push({ kind: 'reveal', seq: s.events.length, round, position, card });
      s.revealed.push(Object.freeze({ position, card, round }));
      this.mm.onEvent(ev);
    }
    this.requote();
    this.botStep();
  }

  private botStep(): void {
    const s = this.s;
    const idx = (s.round - 1) * this.config.stepsPerRound + (s.step - 1);
    const t = s.tickets[idx];
    const q = s.quote;
    const { side, size, price, valuation } = botDecision(t, q, s.cards, s.revealed);
    if (side !== 'pass') applyTrade(s.accounts[t.type], s.accounts.mm, side, size, price as number);
    const ev = this.push<ActionEvent>({
      kind: 'action',
      seq: s.events.length,
      round: s.round,
      step: s.step,
      taker: 'bot',
      side,
      size,
      price,
      quote: q,
    });
    s.botRecords.push({
      round: s.round,
      step: s.step,
      type: t.type,
      positions: t.positions,
      valuation,
      seq: ev.seq,
    });
    this.mm.onEvent(ev);
    this.requote();
  }

  /** Apply the player's action for this step, then run the game forward to the next player decision. */
  act(action: PlayerAction): void {
    const s = this.s;
    if (s.phase !== 'awaitingPlayer') throw new Error('The game is over');
    const q = s.quote;
    const player = s.accounts.player;
    let price: number | null = null;
    if (action.side === 'pass') {
      if (action.size !== 0) throw new Error('A pass has size 0');
    } else {
      const max = action.side === 'buy' ? maxBuyFor(player.position, q) : maxSellFor(player.position, q);
      if (!Number.isInteger(action.size) || action.size < 1 || action.size > max) {
        throw new Error(`Illegal ${action.side} of ${action.size} (max ${max})`);
      }
      price = (action.side === 'buy' ? q.ask : q.bid) as number;
      s.playerAvgPrice = nextAvgPrice(player.position, s.playerAvgPrice, action.side, action.size, price);
      applyTrade(player, s.accounts.mm, action.side, action.size, price);
    }
    s.actions.push({ side: action.side, size: action.size });
    const ev = this.push<ActionEvent>({
      kind: 'action',
      seq: s.events.length,
      round: s.round,
      step: s.step,
      taker: 'player',
      side: action.side,
      size: action.size,
      price,
      quote: q,
    });
    this.mm.onEvent(ev);
    this.requote();
    this.advance();
  }

  private advance(): void {
    const s = this.s;
    if (s.step < this.config.stepsPerRound) {
      s.step += 1;
      this.botStep();
    } else if (s.round < this.config.rounds) {
      this.startRound(s.round + 1);
    } else {
      s.phase = 'settled';
    }
  }
}

/** Replays a game from its config and the player's actions. */
export function replayGame(
  config: GameConfig,
  actions: readonly PlayerAction[],
  mm: MarketMaker,
  hooks: GameHooks = {},
): Game {
  const g = new Game(config, mm, hooks);
  for (const a of actions) {
    if (g.phase === 'settled') break;
    g.act(a);
  }
  return g;
}
