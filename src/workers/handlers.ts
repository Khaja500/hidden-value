/** Work done off the main thread. Pure functions, so tests can call them directly. */
import { playAdvisorBot } from '../agents/advisorBot';
import type { GameConfig, PlayerAction } from '../engine/types';
import { buildReview, type ReviewData } from '../explain/review';
import { runSandbox, type SandboxRequest, type SandboxResult } from '../sim/sandbox';

export type Progress = (done: number, total: number) => void;

export const handlers = {
  /** Advisor-bot P&L on the same deal, for the luck-adjusted skill score. */
  skill: (payload: { config: GameConfig }): number => playAdvisorBot(payload.config).pnl,
  /** Full post-game review: replays the game and explains every step. */
  review: (payload: { config: GameConfig; actions: PlayerAction[] }, progress?: Progress): ReviewData =>
    buildReview(payload.config, payload.actions, progress),
  /** Sandbox simulations with user-chosen settings. */
  sandbox: (payload: SandboxRequest, progress?: Progress): SandboxResult => runSandbox(payload, progress),
};

export type HandlerName = keyof typeof handlers;
