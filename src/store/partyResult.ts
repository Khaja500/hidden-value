/**
 * Multiplayer results: standings plus every player trade graded by its expected profit at the time. Shared by the
 * one-screen store (which grades trades as they happen) and the online game server (which grades a finished game
 * by replaying it with an Advisor for each seat).
 */
import { Advisor } from '../agents/advisor';
import { createMultiGame } from '../agents/factory';
import type { MultiGame, MultiSettlement, SeatAction } from '../engine/multiGame';
import type { GameConfig, Side } from '../engine/types';

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

/** Grades a trade with the estimate the player had when making it. */
export function gradeTrade(
  seat: number,
  round: number,
  step: number,
  side: Side,
  size: number,
  price: number,
  estimate: number,
): Omit<GradedTrade, 'actual'> {
  return {
    seat,
    round,
    step,
    side,
    size,
    price,
    estimate,
    expected: size * (side === 'buy' ? estimate - price : price - estimate),
  };
}

export function buildPartyResult(
  g: MultiGame,
  names: readonly string[],
  graded: readonly Omit<GradedTrade, 'actual'>[],
  hints: readonly number[],
): PartyResult {
  const settlement = g.settlement();
  const V = settlement.value;
  const trades: GradedTrade[] = graded.map((t) => ({
    ...t,
    actual: t.size * (t.side === 'buy' ? V - t.price : t.price - V),
  }));
  const pub = g.publicView();
  const standings: PartyStanding[] = names.map((name, seat) => {
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

/** Replays a finished game with an Advisor per seat, grading every trade with the estimate its player had. */
export function gradeFinishedGame(
  config: GameConfig,
  names: readonly string[],
  actions: readonly SeatAction[],
  hints: readonly number[] = [],
): PartyResult {
  const g = createMultiGame(config);
  const advisors = names.map(() => new Advisor());
  const graded: Omit<GradedTrade, 'actual'>[] = [];
  for (const a of actions) {
    if (a.seat !== g.currentSeat) throw new Error(`Seat ${a.seat} acted out of turn`);
    if (a.side !== 'pass') {
      const view = g.seatView(a.seat);
      const estimate = advisors[a.seat].advise(view).estimate.mean;
      const price = (a.side === 'buy' ? view.quote.ask : view.quote.bid) as number;
      graded.push(gradeTrade(a.seat, view.round, view.step, a.side, a.size, price, estimate));
    }
    g.act({ side: a.side, size: a.size });
  }
  return buildPartyResult(g, names, graded, hints);
}
