/**
 * The multiplayer ("same screen") store. Several players share one device and take turns. Between turns a
 * hand-off screen hides everything private, so the store holds no private card at all until the next player
 * asks to see theirs; during a turn it holds only that player's view. The MultiGame (which knows every card)
 * and each player's Advisor live in this module's closure and are never put into React state. Once the game is
 * settled every card is public and the full results become available.
 */
import { create } from 'zustand';
import { Advisor, type Advice } from '../agents/advisor';
import { createMultiGame } from '../agents/factory';
import type { MultiGame, MultiPublicView, MultiSettlement } from '../engine/multiGame';
import { randomSeed } from '../engine/rng';
import { makeMultiConfig } from '../engine/rules';
import type { Difficulty, GameConfig, PlayerAction, PlayerView, Side } from '../engine/types';
import type { Belief } from './gameStore';

export interface PartyOptions {
  names: string[];
  difficulty: Difficulty;
  /** Whether players may ask the Advisor (each ask counts as a hint). */
  advisorOn: boolean;
}

/** One player trade, graded with that player's own estimate at the time (revealed only after settlement). */
export interface GradedTrade {
  seat: number;
  round: number;
  step: number;
  side: Side;
  size: number;
  price: number;
  /** The player's estimate of V when they traded, from their Advisor's filter. */
  estimate: number;
  /** Expected profit of the trade at the time: size × (estimate − price) for a buy, size × (price − estimate) for a sell. */
  expected: number;
  /** What it actually made at settlement. */
  actual: number;
}

export interface PartyStanding {
  seat: number;
  name: string;
  card: number;
  pnl: number;
  /** Sum of the trades' expected profit at the time: the part of the score that was skill rather than luck. */
  expected: number;
  trades: number;
  finalUnits: number;
  hints: number;
}

export interface PartyResult {
  settlement: MultiSettlement;
  /** Best P&L first. */
  standings: PartyStanding[];
  trades: GradedTrade[];
}

export type Stage = 'handoff' | 'turn';

export interface PartyState {
  status: 'idle' | 'playing' | 'settled';
  options: PartyOptions | null;
  /** Public information only: quotes, reveals, the trade feed, every player's units and whose turn it is. */
  pub: MultiPublicView | null;
  stage: Stage;
  /** The current player's view, only while they are looking (stage 'turn'). */
  seatView: PlayerView | null;
  belief: Belief | null;
  advice: Advice | null;
  hints: number[];
  /** Per seat: the event count when they last looked, so their turn can highlight what happened since. */
  lastSeen: number[];
  size: number;
  result: PartyResult | null;
  start: (o: PartyOptions, seed?: number) => void;
  showTurn: () => void;
  hideTurn: () => void;
  act: (a: PlayerAction) => void;
  askAdvisor: () => void;
  setSize: (n: number) => void;
  /** New deal for the same players. `sameDeal` replays the same cards and bots instead. */
  rematch: (sameDeal?: boolean) => void;
  quit: () => void;
}

// ---- Engine-side state: never exposed to React ---------------------------------------------------------------
let game: MultiGame | null = null;
let config: GameConfig | null = null;
let advisors: Advisor[] = [];
let currentAdvice: Advice | null = null;
let graded: Omit<GradedTrade, 'actual'>[] = [];

function beliefOf(a: Advice | null): Belief | null {
  return a ? { mean: a.estimate.mean, sd: a.estimate.sd, distribution: a.distribution } : null;
}

const PRIVATE_CLEARED = { stage: 'handoff' as Stage, seatView: null, belief: null, advice: null };

const INITIAL = {
  status: 'idle' as const,
  options: null,
  pub: null,
  ...PRIVATE_CLEARED,
  hints: [] as number[],
  lastSeen: [] as number[],
  size: 1,
  result: null,
};

function buildResult(g: MultiGame, o: PartyOptions, hints: number[]): PartyResult {
  const settlement = g.settlement();
  const V = settlement.value;
  const trades: GradedTrade[] = graded.map((t) => ({
    ...t,
    actual: t.size * (t.side === 'buy' ? V - t.price : t.price - V),
  }));
  const pub = g.publicView();
  const standings: PartyStanding[] = o.names.map((name, seat) => {
    const mine = trades.filter((t) => t.seat === seat);
    return {
      seat,
      name,
      card: settlement.cards[seat],
      pnl: settlement.pnl.players[seat],
      expected: mine.reduce((a, t) => a + t.expected, 0),
      trades: mine.length,
      finalUnits: pub.seats[seat].units,
      hints: hints[seat] ?? 0,
    };
  });
  standings.sort((a, b) => b.pnl - a.pnl || a.seat - b.seat);
  return { settlement, standings, trades };
}

export const useParty = create<PartyState>((set, get) => ({
  ...INITIAL,

  start: (o, seed) => {
    const seats = o.names.length;
    config = makeMultiConfig(o.difficulty, seats, seed ?? randomSeed());
    game = createMultiGame(config);
    advisors = Array.from({ length: seats }, () => new Advisor());
    currentAdvice = null;
    graded = [];
    set({
      ...INITIAL,
      status: 'playing',
      options: { ...o, names: [...o.names] },
      pub: game.publicView(),
      hints: new Array(seats).fill(0),
      lastSeen: new Array(seats).fill(0),
    });
  },

  showTurn: () => {
    const st = get();
    if (!game || st.status !== 'playing' || st.stage !== 'handoff') return;
    const seat = game.currentSeat!;
    const view = game.seatView(seat);
    currentAdvice = advisors[seat].advise(view);
    set({
      stage: 'turn',
      seatView: view,
      belief: st.options!.advisorOn ? beliefOf(currentAdvice) : null,
      advice: null,
      size: Math.min(st.size, Math.max(1, Math.max(view.maxBuy, view.maxSell))),
    });
  },

  hideTurn: () => {
    if (get().stage === 'turn') set({ ...PRIVATE_CLEARED });
  },

  act: (action) => {
    const st = get();
    if (!game || !config || st.status !== 'playing' || st.stage !== 'turn' || !currentAdvice) return;
    const seat = game.currentSeat!;
    const view = st.seatView!;
    if (action.side !== 'pass') {
      const price = (action.side === 'buy' ? view.quote.ask : view.quote.bid) as number;
      const est = currentAdvice.estimate.mean;
      graded.push({
        seat,
        round: view.round,
        step: view.step,
        side: action.side,
        size: action.size,
        price,
        estimate: est,
        expected: action.size * (action.side === 'buy' ? est - price : price - est),
      });
    }
    game.act(action);
    currentAdvice = null;
    const lastSeen = st.lastSeen.slice();
    lastSeen[seat] = game.publicView().events.length;
    if (game.phase === 'settled') {
      set({
        ...PRIVATE_CLEARED,
        status: 'settled',
        pub: game.publicView(),
        lastSeen,
        result: buildResult(game, st.options!, st.hints),
      });
      return;
    }
    set({ ...PRIVATE_CLEARED, pub: game.publicView(), lastSeen });
  },

  askAdvisor: () => {
    const st = get();
    if (!game || !currentAdvice || st.stage !== 'turn' || !st.options?.advisorOn || st.advice) return;
    const seat = game.currentSeat!;
    const hints = st.hints.slice();
    hints[seat] += 1;
    set({ advice: currentAdvice, hints });
  },

  setSize: (n) => set({ size: Math.max(1, Math.min(3, n)) }),

  rematch: (sameDeal = false) => {
    const o = get().options;
    if (!o) return;
    get().start(o, sameDeal && config ? config.seed : undefined);
  },

  quit: () => {
    game = null;
    config = null;
    advisors = [];
    currentAdvice = null;
    graded = [];
    set({ ...INITIAL });
  },
}));

/** Test-only: the engine-side game, so tests can compare it with what the store exposes. */
export function __partyEngineForTests(): MultiGame | null {
  return game;
}
