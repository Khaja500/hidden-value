/**
 * Headless game simulation shared by the Node research scripts and the in-browser Sandbox worker.
 * Pure TypeScript: no DOM, no I/O.
 */
import { Advisor, type AdvisorParams } from '../agents/advisor';
import { adviceToAction } from '../agents/advisorBot';
import { createGame } from '../agents/factory';
import { rankOf } from '../engine/cards';
import { hashSeed, Rng } from '../engine/rng';
import type { GameConfig, PlayerAction, Quote } from '../engine/types';

export type PlayerPolicy = 'pass' | 'advisor' | 'random';

export interface SimTask {
  config: GameConfig;
  player: PlayerPolicy;
  advisor?: Partial<AdvisorParams>;
  /** Record (μ, V) pairs at one random bot step, for calibration. */
  calibration?: boolean;
}

/**
 * MM P&L split exactly into parts. For every trade, the MM's gain d·s·(p − V) (d = +1 when the MM sells) is
 *   d·s·(p − μ)  spread capture against its own fair value μ at the time, plus
 *   d·s·(μ − V)  how the value turned out against that fair value, booked by counterparty: informed bots
 *                (adverse selection), noise bots (inventory drift) and the player.
 */
export interface MMAttribution {
  spreadCapture: number;
  adverseSelection: number;
  inventory: number;
  player: number;
}

export interface GameSummary {
  seed: number;
  value: number;
  pnl: { player: number; mm: number; noise: number; informed: number };
  avgSpread: number;
  /** Mean |MM inventory| over the 64+ quotes, and its maximum. */
  meanAbsInventory: number;
  maxAbsInventory: number;
  finalInventory: number;
  mmAttribution: MMAttribution;
  volume: { noise: number; informed: number; player: number };
  playerTrades: number;
  /** Advisor probability statements on recommended trades: p and whether it came true. */
  advisorStatements: { p: number; hit: number }[];
  /** Belief calibration pairs (only when requested). */
  calibration: { mmMu: number; playerMu: number; value: number } | null;
}

export function simulateGame(task: SimTask): GameSummary {
  const { config } = task;
  let spreadSum = 0;
  let quotes = 0;
  let absInv = 0;
  let maxInv = 0;
  let lastMu = 0;
  const muAtQuote: number[] = [];
  const game = createGame(config, {
    onQuote: (q: Quote, mm, state) => {
      if (q.bid !== null && q.ask !== null) {
        spreadSum += q.ask - q.bid;
        quotes++;
      }
      const inv = Math.abs(state.accounts.mm.position);
      absInv += inv;
      maxInv = Math.max(maxInv, inv);
      lastMu = mm.fairValue();
      muAtQuote[state.events.length - 1] = lastMu;
    },
  });
  const advisor = task.player === 'advisor' ? new Advisor(task.advisor) : null;
  const rng = new Rng(hashSeed(config.seed, 'random-player'));
  const statements: { side: 'buy' | 'sell'; price: number; p: number }[] = [];
  const checkpoint = new Rng(hashSeed(config.seed, 'checkpoint')).int(config.rounds * config.stepsPerRound);
  let calib: { mmMu: number; playerMu: number } | null = null;
  let playerStep = 0;
  while (game.phase !== 'settled') {
    const view = game.view();
    let action: PlayerAction = { side: 'pass', size: 0 };
    if (advisor) {
      const a = advisor.advise(view);
      action = adviceToAction(a);
      if (a.action !== 'hold' && a.price !== null) {
        statements.push({
          side: a.action,
          price: a.price,
          p: (a.action === 'buy' ? a.buyProb : a.sellProb) ?? 0,
        });
      }
      if (task.calibration && playerStep === checkpoint) calib = { mmMu: lastMu, playerMu: a.estimate.mean };
    } else if (task.player === 'random') {
      const u = rng.next();
      if (u < 0.2 && view.maxBuy > 0) action = { side: 'buy', size: 1 };
      else if (u < 0.4 && view.maxSell > 0) action = { side: 'sell', size: 1 };
    }
    if (task.calibration && !advisor && playerStep === checkpoint) {
      calib = { mmMu: lastMu, playerMu: new Advisor({ particles: 1500 }).estimate(view).mean };
    }
    game.act(action);
    playerStep++;
  }

  const st = game.fullState();
  const value = st.cards.reduce((a, c) => a + rankOf(c), 0);
  const settlement = game.settlement();
  const typeBySeq = new Map(st.botRecords.map((r) => [r.seq, r.type]));
  const attribution: MMAttribution = { spreadCapture: 0, adverseSelection: 0, inventory: 0, player: 0 };
  const volume = { noise: 0, informed: 0, player: 0 };
  let playerTrades = 0;
  for (const e of st.events) {
    if (e.kind !== 'action' || e.side === 'pass' || e.price === null) continue;
    // The trade hit the quote posted just before it; μ is the MM's fair value at that quote.
    let mu = 0;
    for (let i = e.seq - 1; i >= 0; i--) {
      if (muAtQuote[i] !== undefined) {
        mu = muAtQuote[i];
        break;
      }
    }
    const d = e.side === 'buy' ? 1 : -1;
    attribution.spreadCapture += d * e.size * (e.price - mu);
    const drift = d * e.size * (mu - value);
    if (e.taker === 'player') {
      attribution.player += drift;
      volume.player += e.size;
      playerTrades++;
    } else if (typeBySeq.get(e.seq) === 'informed') {
      attribution.adverseSelection += drift;
      volume.informed += e.size;
    } else {
      attribution.inventory += drift;
      volume.noise += e.size;
    }
  }

  return {
    seed: config.seed,
    value,
    pnl: settlement.pnl,
    avgSpread: quotes ? spreadSum / quotes : 0,
    meanAbsInventory: absInv / Math.max(1, muAtQuote.filter((x) => x !== undefined).length),
    maxAbsInventory: maxInv,
    finalInventory: st.accounts.mm.position,
    mmAttribution: attribution,
    volume,
    playerTrades,
    advisorStatements: statements.map((s) => ({
      p: s.p,
      hit: s.side === 'buy' ? (value > s.price ? 1 : 0) : value < s.price ? 1 : 0,
    })),
    calibration: calib ? { ...calib, value } : null,
  };
}

export interface MeanCI {
  mean: number;
  ci95: number;
  n: number;
}

export function meanCI(xs: readonly number[]): MeanCI {
  const n = xs.length;
  if (n === 0) return { mean: 0, ci95: 0, n };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const v = n > 1 ? xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, ci95: 1.96 * Math.sqrt(v / n), n };
}

/** Seeds for tuning and for reported numbers never overlap. */
export function validationSeed(i: number): number {
  return hashSeed('validation', i);
}

export function testSeed(i: number): number {
  return hashSeed('test', i);
}
