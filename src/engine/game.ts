/**
 * The game driver (spec §2.3–2.6). Each step: the MM quotes, one bot arrives and acts, the MM requotes, then the
 * player acts once and the MM requotes again. Rounds 2–4 start with one public reveal. Everything random comes from
 * seeded streams, so (config, player actions) replays the identical event log.
 */
import { informedDecision, valuationFromPositions } from '../agents/informed';
import { noiseDecision } from '../agents/noise';
import { DECK_SIZE, HAND_SIZE } from './cards';
import { hashSeed, Rng } from './rng';
import { BOT_MAX_SIZE, INFORMED_K_PROBS } from './rules';
import { newAccount, type Account, type BotTicket, type FullState } from './state';
import type {
  ActionEvent,
  GameConfig,
  MarketMaker,
  PlayerAction,
  PlayerView,
  PublicConfig,
  PublicEvent,
  PublicView,
  Quote,
  SettledView,
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

function freezeQuote(q: Quote): Quote {
  return Object.freeze({ bid: q.bid, ask: q.ask, bidSize: q.bidSize, askSize: q.askSize });
}

export function dealCards(config: GameConfig): { cards: number[]; revealOrder: number[] } {
  const rng = new Rng(hashSeed(config.seed, 'deal'));
  const deck = rng.shuffle(Array.from({ length: DECK_SIZE }, (_, i) => i));
  const cards = deck.slice(0, HAND_SIZE);
  const priv = privatePositions(config);
  const revealable = rng.shuffle([0, 1, 2, 3, 4].filter((p) => !priv.includes(p)));
  return { cards, revealOrder: revealable.slice(0, config.rounds - 1) };
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
    const size = 1 + rng.int(BOT_MAX_SIZE);
    const informed = uType < config.alpha;
    const k = uK < INFORMED_K_PROBS[0] ? 1 : 2;
    tickets.push({ type: informed ? 'informed' : 'noise', positions: perm.slice(0, k), uNoise, size });
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

  private trade(taker: Account, side: 'buy' | 'sell', size: number, price: number): void {
    const mm = this.s.accounts.mm;
    const dir = side === 'buy' ? 1 : -1;
    taker.position += dir * size;
    taker.cash -= dir * size * price;
    mm.position -= dir * size;
    mm.cash += dir * size * price;
  }

  private botStep(): void {
    const s = this.s;
    const idx = (s.round - 1) * this.config.stepsPerRound + (s.step - 1);
    const t = s.tickets[idx];
    const q = s.quote;
    let side;
    let valuation: number | null = null;
    if (t.type === 'noise') {
      side = noiseDecision(t.uNoise, q);
    } else {
      const known = [...s.revealed.map((r) => r.position), ...t.positions];
      valuation = valuationFromPositions(s.cards, known);
      side = informedDecision(valuation, q);
    }
    let size = 0;
    let price: number | null = null;
    if (side === 'buy') {
      size = Math.min(t.size, q.askSize);
      price = q.ask;
    } else if (side === 'sell') {
      size = Math.min(t.size, q.bidSize);
      price = q.bid;
    }
    if (side !== 'pass') this.trade(s.accounts[t.type], side, size, price as number);
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
      this.updateAvgPrice(action.side, action.size, price);
      this.trade(player, action.side, action.size, price);
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

  private updateAvgPrice(side: 'buy' | 'sell', size: number, price: number): void {
    const s = this.s;
    const pos = s.accounts.player.position;
    const delta = side === 'buy' ? size : -size;
    const next = pos + delta;
    if (next === 0) s.playerAvgPrice = null;
    else if (pos === 0 || Math.sign(pos) !== Math.sign(next)) s.playerAvgPrice = price;
    else if (Math.sign(delta) === Math.sign(pos)) {
      s.playerAvgPrice = ((s.playerAvgPrice ?? price) * Math.abs(pos) + price * size) / Math.abs(next);
    }
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
