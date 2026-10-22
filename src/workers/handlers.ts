/** Work done off the main thread. Pure functions, so tests can call them directly. */
import { playAdvisorBot } from '../agents/advisorBot';
import type { GameConfig } from '../engine/types';

export type Progress = (done: number, total: number) => void;

export const handlers = {
  /** Advisor-bot P&L on the same deal, for the luck-adjusted skill score. */
  skill: (payload: { config: GameConfig }): number => playAdvisorBot(payload.config).pnl,
};

export type HandlerName = keyof typeof handlers;
