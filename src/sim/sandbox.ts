/** In-browser Sandbox runs (spec §2.8, §9.1): small simulations with user-chosen settings, in a Web Worker. */
import { hashSeed } from '../engine/rng';
import { makeConfig } from '../engine/rules';
import type { MMKind } from '../engine/types';
import { meanCI, simulateGame, type GameSummary, type MeanCI, type MMAttribution } from './simulate';

export interface SandboxRequest {
  alpha: number;
  mmKind: MMKind;
  gamma: number;
  games: number;
  player: 'pass' | 'advisor';
  /** Which set of deals to use; the same number replays the same deals, so settings can be compared fairly. */
  dealSet: number;
  particles: number;
}

export interface SandboxResult {
  request: SandboxRequest;
  mmPnl: MeanCI;
  mmPnls: number[];
  playerPnl: MeanCI | null;
  spread: number;
  lossToInformed: number;
  gainFromNoise: number;
  meanAbsInventory: number;
  maxAbsInventory: number;
  attribution: MMAttribution;
  playerTrades: number;
}

export function runSandbox(
  req: SandboxRequest,
  progress?: (done: number, total: number) => void,
): SandboxResult {
  const res: GameSummary[] = [];
  for (let i = 0; i < req.games; i++) {
    const config = makeConfig('medium', hashSeed('sandbox', req.dealSet, i), {
      mmKind: req.mmKind,
      alpha: req.alpha,
      mmLearnsFromPlayer: false,
      mm: { gamma: req.gamma, particles: req.particles },
    });
    res.push(simulateGame({ config, player: req.player, advisor: { particles: req.particles } }));
    if (progress && (i % 2 === 1 || i === req.games - 1)) progress(i + 1, req.games);
  }
  const mean = (f: (r: GameSummary) => number) => res.reduce((a, r) => a + f(r), 0) / res.length;
  return {
    request: req,
    mmPnl: meanCI(res.map((r) => r.pnl.mm)),
    mmPnls: res.map((r) => r.pnl.mm),
    playerPnl: req.player === 'advisor' ? meanCI(res.map((r) => r.pnl.player)) : null,
    spread: mean((r) => r.avgSpread),
    lossToInformed: mean((r) => r.pnl.informed),
    gainFromNoise: mean((r) => -r.pnl.noise),
    meanAbsInventory: mean((r) => r.meanAbsInventory),
    maxAbsInventory: mean((r) => r.maxAbsInventory),
    attribution: {
      spreadCapture: mean((r) => r.mmAttribution.spreadCapture),
      adverseSelection: mean((r) => r.mmAttribution.adverseSelection),
      inventory: mean((r) => r.mmAttribution.inventory),
      player: mean((r) => r.mmAttribution.player),
    },
    playerTrades: mean((r) => r.playerTrades),
  };
}
