/**
 * The multiplayer game driver: 2–4 players share one screen, each holding one of the five cards (player i holds
 * position i). Each step: one bot arrives and acts, the MM requotes, then every player acts once in turn, with the
 * MM requoting after each of them. The first player to act rotates every step, so nobody always sees the fresh
 * quote first. Rounds 2–4 start with a public reveal; with 3–4 players there are not enough unheld cards, so the
 * late reveals expose players' cards (see dealCards).
 *
 * Everything random comes from the same seeded streams as the single-player game, so (config, actions) replays the
 * identical event log, and the bots are the same whatever the players do.
 */
import { HAND_SIZE, rankOf } from './cards';
import { applyTrade, botDecision, dealCards, drawTickets, freezeQuote, nextAvgPrice } from './game';
import { newAccount, settleAccount, type Account, type BotRecord, type BotTicket } from './state';
import type {
  ActionEvent,
  Card,
  GameConfig,
  MarketMaker,
  Phase,
  PlayerAction,
  PlayerView,
  PublicConfig,
  PublicEvent,
  PublicView,
  Quote,
  Revealed,
} from './types';
import { maxBuyFor, maxSellFor, publicConfig } from './views';

export const MIN_SEATS = 2;
export const MAX_SEATS = 4;

/** A player's action, with the seat that took it (for replays and logs). */
export interface SeatAction extends PlayerAction {
  seat: number;
}

export interface MultiState {
  config: GameConfig;
  cards: Card[];
  revealOrder: number[];
  tickets: BotTicket[];
  phase: Phase;
  round: number;
  step: number;
  events: PublicEvent[];
  revealed: Revealed[];
  botRecords: BotRecord[];
  actions: SeatAction[];
  quote: Quote;
  players: Account[];
  avgPrices: (number | null)[];
  accounts: { mm: Account; noise: Account; informed: Account };
  /** Seats still to act this step, in order; the first is the player whose turn it is. */
  queue: number[];
  /** Seats that have acted this step, in order. */
  acted: number[];
}

/** Public facts about one player: everything here follows from the trade feed and the reveals. */
export interface SeatPublic {
  seat: number;
  /** The card position this player holds. */
  position: number;
  /** Net units held (public: it is the sum of this player's trades in the feed). */
  units: number;
  trades: number;
  /** Whether this player's card has been revealed to everyone. */
  cardRevealed: boolean;
}

export interface MultiPublicView extends PublicView {
  seats: SeatPublic[];
  /** Whose turn it is (null once settled), and the order for this step. */
  turn: { seat: number | null; order: number[]; acted: number[] };
}

export interface MultiSettlement {
  cards: Card[];
  value: number;
  pnl: { players: number[]; mm: number; noise: number; informed: number };
}

/** The order in which the players act at a step: rotates by one seat every step. */
export function seatOrder(seats: number, round: number, step: number, stepsPerRound: number): number[] {
  const first = ((round - 1) * stepsPerRound + (step - 1)) % seats;
  return Array.from({ length: seats }, (_, i) => (first + i) % seats);
}

function currentSeatOf(s: MultiState): number | null {
  return s.phase === 'awaitingPlayer' ? s.queue[0] : null;
}

/** The public view of a multiplayer game, built as plain data from the full state. */
export function toMultiPublicView(s: MultiState): MultiPublicView {
  const seats = s.players.length;
  const revealedPositions = new Set(s.revealed.map((r) => r.position));
  const trades = new Array<number>(seats).fill(0);
  for (const e of s.events) {
    if (e.kind === 'action' && e.taker === 'player' && e.side !== 'pass') trades[e.seat!]++;
  }
  return {
    config: publicConfig(s.config),
    phase: s.phase,
    round: s.round,
    step: s.step,
    revealed: s.revealed.slice(),
    events: s.events.slice(),
    quote: s.quote,
    mmPosition: s.accounts.mm.position,
    seats: s.players.map((p, seat) => ({
      seat,
      position: seat,
      units: p.position,
      trades: trades[seat],
      cardRevealed: revealedPositions.has(seat),
    })),
    turn: {
      seat: currentSeatOf(s),
      order: seatOrder(seats, s.round, s.step, s.config.stepsPerRound),
      acted: s.acted.slice(),
    },
  };
}

/** One player's view, built as plain data from the full state: public information plus their own card and account. */
export function toSeatView(s: MultiState, seat: number): PlayerView {
  const p = s.players[seat];
  const myTurn = currentSeatOf(s) === seat;
  return {
    config: publicConfig(s.config),
    phase: s.phase,
    round: s.round,
    step: s.step,
    revealed: s.revealed.slice(),
    events: s.events.slice(),
    quote: s.quote,
    mmPosition: s.accounts.mm.position,
    privateCards: [Object.freeze({ position: seat, card: s.cards[seat] })],
    player: { position: p.position, cash: p.cash, avgPrice: s.avgPrices[seat] },
    maxBuy: myTurn ? maxBuyFor(p.position, s.quote) : 0,
    maxSell: myTurn ? maxSellFor(p.position, s.quote) : 0,
    seat,
  };
}

export class MultiGame {
  readonly config: GameConfig;
  readonly seats: number;
  private readonly s: MultiState;
  private readonly mm: MarketMaker;
  private readonly pubConfig: PublicConfig;

  constructor(config: GameConfig, mm: MarketMaker) {
    const seats = config.seats ?? 0;
    if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) {
      throw new Error(`Multiplayer needs ${MIN_SEATS}–${MAX_SEATS} players`);
    }
    if (config.playerCards !== 1) throw new Error('In multiplayer each player holds exactly one card');
    if (config.rounds - 1 > HAND_SIZE) throw new Error('Not enough cards to reveal');
    this.config = config;
    this.seats = seats;
    this.mm = mm;
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
      players: Array.from({ length: seats }, newAccount),
      avgPrices: Array.from({ length: seats }, () => null),
      accounts: { mm: newAccount(), noise: newAccount(), informed: newAccount() },
      queue: [],
      acted: [],
    };
    this.startRound(1);
  }

  get phase(): Phase {
    return this.s.phase;
  }

  get marketMaker(): MarketMaker {
    return this.mm;
  }

  /** The seat whose turn it is, or null once the game is settled. */
  get currentSeat(): number | null {
    return currentSeatOf(this.s);
  }

  publicView(): MultiPublicView {
    return toMultiPublicView(this.s);
  }

  /** One player's view: the public information plus their own card and account. Never anyone else's card. */
  seatView(seat: number): PlayerView {
    this.checkSeat(seat);
    return toSeatView(this.s, seat);
  }

  /** Every card and P&L. Throws until the game is settled. */
  settlement(): MultiSettlement {
    const s = this.s;
    if (s.phase !== 'settled') throw new Error('Game is not settled yet');
    const value = s.cards.reduce((a, c) => a + rankOf(c), 0);
    return {
      cards: [...s.cards],
      value,
      pnl: {
        players: s.players.map((p) => settleAccount(p, value)),
        mm: settleAccount(s.accounts.mm, value),
        noise: settleAccount(s.accounts.noise, value),
        informed: settleAccount(s.accounts.informed, value),
      },
    };
  }

  /** The complete hidden state, deep-copied. For tests and post-game summaries only. */
  fullState(): MultiState {
    return structuredClone(this.s);
  }

  actions(): SeatAction[] {
    return this.s.actions.map((a) => ({ ...a }));
  }

  private checkSeat(seat: number): void {
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.seats)
      throw new Error(`No player in seat ${seat}`);
  }

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
    s.queue = seatOrder(this.seats, s.round, s.step, this.config.stepsPerRound);
    s.acted = [];
  }

  /** Apply the current player's action, then run the game forward to the next player's decision. */
  act(action: PlayerAction): void {
    const s = this.s;
    if (s.phase !== 'awaitingPlayer') throw new Error('The game is over');
    const seat = s.queue[0];
    const q = s.quote;
    const player = s.players[seat];
    let price: number | null = null;
    if (action.side === 'pass') {
      if (action.size !== 0) throw new Error('A pass has size 0');
    } else {
      const max = action.side === 'buy' ? maxBuyFor(player.position, q) : maxSellFor(player.position, q);
      if (!Number.isInteger(action.size) || action.size < 1 || action.size > max) {
        throw new Error(`Illegal ${action.side} of ${action.size} (max ${max})`);
      }
      price = (action.side === 'buy' ? q.ask : q.bid) as number;
      s.avgPrices[seat] = nextAvgPrice(player.position, s.avgPrices[seat], action.side, action.size, price);
      applyTrade(player, s.accounts.mm, action.side, action.size, price);
    }
    s.actions.push({ seat, side: action.side, size: action.size });
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
      seat,
    });
    this.mm.onEvent(ev);
    this.requote();
    s.queue.shift();
    s.acted.push(seat);
    if (s.queue.length === 0) this.advance();
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
      s.queue = [];
    }
  }
}

/** Replays a multiplayer game from its config and the players' actions (each must come from the seat to act). */
export function replayMultiGame(
  config: GameConfig,
  actions: readonly SeatAction[],
  mm: MarketMaker,
): MultiGame {
  const g = new MultiGame(config, mm);
  for (const a of actions) {
    if (g.phase === 'settled') break;
    if (a.seat !== g.currentSeat) throw new Error(`Seat ${a.seat} acted out of turn`);
    g.act({ side: a.side, size: a.size });
  }
  return g;
}
