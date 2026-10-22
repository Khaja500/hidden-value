/**
 * The game store. The UI only ever receives a PlayerView before settlement: the Game object (which holds the
 * hidden cards) lives in this module's closure and is never put into React state. After settlement the full
 * SettledView (all cards) becomes available.
 */
import { create } from 'zustand';
import { Advisor, type Advice } from '../agents/advisor';
import { createGame } from '../agents/factory';
import type { Game } from '../engine/game';
import { dailySeed, randomSeed } from '../engine/rng';
import { makeConfig } from '../engine/rules';
import type { Difficulty, GameConfig, PlayerAction, PlayerView, SettledView } from '../engine/types';
import { tradeVerdict } from '../explain/render';
import { callWorker } from '../workers/client';
import type { Pacing } from './settings';
import { load, save } from './storage';

export type Mode = 'practice' | 'daily' | 'tutorial';

export interface StartOptions {
  difficulty: Difficulty;
  mode: Mode;
  pacing: Pacing;
  seed?: number;
}

export interface GameLog {
  id: string;
  createdAt: number;
  mode: Mode;
  difficulty: Difficulty;
  pacing: Pacing;
  config: GameConfig;
  actions: PlayerAction[];
  hintsUsed: number;
  result: { pnl: number; value: number; mmPnl: number };
  /** Advisor bot's P&L on the same deal, and player P&L minus it. Null until computed. */
  advisorPnl: number | null;
  skill: number | null;
  /** UTC date for daily challenges. */
  date?: string;
}

export interface Belief {
  mean: number;
  sd: number;
  distribution: number[];
}

export interface GameState {
  status: 'idle' | 'playing' | 'settled';
  mode: Mode;
  difficulty: Difficulty;
  pacing: Pacing;
  gameId: string | null;
  view: PlayerView | null;
  settled: SettledView | null;
  /** The player's belief about V (practice and tutorial only). */
  belief: Belief | null;
  /** Advice shown to the player: only after they ask (practice) or always (tutorial). */
  advice: Advice | null;
  hintsUsed: number;
  verdict: string | null;
  size: number;
  log: GameLog | null;
  start: (o: StartOptions) => void;
  act: (a: PlayerAction) => void;
  askAdvisor: () => void;
  setSize: (n: number) => void;
  quit: () => void;
}

// ---- Engine-side state: never exposed to React ---------------------------------------------------------------
let game: Game | null = null;
let advisor: Advisor | null = null;
let config: GameConfig | null = null;
let currentAdvice: Advice | null = null;

const MAX_LOGS = 20;

export function loadLogs(): GameLog[] {
  return load<GameLog[]>('games', []);
}

export function findLog(id: string): GameLog | null {
  return loadLogs().find((g) => g.id === id) ?? null;
}

function saveLog(log: GameLog): void {
  const logs = loadLogs().filter((g) => g.id !== log.id);
  logs.unshift(log);
  save('games', logs.slice(0, MAX_LOGS));
}

export interface LeaderboardEntry {
  id: string;
  pnl: number;
  skill: number | null;
  createdAt: number;
}

export function loadLeaderboard(date: string): LeaderboardEntry[] {
  return load<LeaderboardEntry[]>(`daily:${date}`, []);
}

function saveDailyScore(date: string, entry: LeaderboardEntry): void {
  const list = loadLeaderboard(date).filter((e) => e.id !== entry.id);
  list.push(entry);
  list.sort((a, b) => b.pnl - a.pnl);
  save(`daily:${date}`, list.slice(0, 50));
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function beliefOf(a: Advice | null): Belief | null {
  return a ? { mean: a.estimate.mean, sd: a.estimate.sd, distribution: a.distribution } : null;
}

const INITIAL = {
  status: 'idle' as const,
  mode: 'practice' as Mode,
  difficulty: 'medium' as Difficulty,
  pacing: 'turn' as Pacing,
  gameId: null,
  view: null,
  settled: null,
  belief: null,
  advice: null,
  hintsUsed: 0,
  verdict: null,
  size: 1,
  log: null,
};

export const useGame = create<GameState>((set, get) => ({
  ...INITIAL,

  start: ({ difficulty, mode, pacing, seed }) => {
    const s = seed ?? (mode === 'daily' ? dailySeed() : randomSeed());
    config = makeConfig(difficulty, s);
    game = createGame(config);
    const withAdvisor = mode !== 'daily';
    advisor = withAdvisor ? new Advisor() : null;
    const view = game.view();
    currentAdvice = advisor ? advisor.advise(view) : null;
    set({
      ...INITIAL,
      status: 'playing',
      mode,
      difficulty,
      pacing,
      gameId: newId(),
      view,
      belief: beliefOf(currentAdvice),
      advice: mode === 'tutorial' ? currentAdvice : null,
    });
  },

  act: (action) => {
    const st = get();
    if (!game || st.status !== 'playing' || !config) return;
    const verdict = currentAdvice ? tradeVerdict(currentAdvice, action) : null;
    game.act(action);
    if (game.phase === 'settled') {
      const settled = game.settledView();
      const s = settled.settlement;
      const log: GameLog = {
        id: st.gameId!,
        createdAt: Date.now(),
        mode: st.mode,
        difficulty: st.difficulty,
        pacing: st.pacing,
        config,
        actions: game.actions(),
        hintsUsed: st.hintsUsed,
        result: { pnl: s.pnl.player, value: s.value, mmPnl: s.pnl.mm },
        advisorPnl: null,
        skill: null,
        ...(st.mode === 'daily' ? { date: todayUTC() } : {}),
      };
      saveLog(log);
      if (log.date)
        saveDailyScore(log.date, { id: log.id, pnl: log.result.pnl, skill: null, createdAt: log.createdAt });
      currentAdvice = null;
      set({ status: 'settled', view: settled, settled, verdict, advice: null, belief: null, log });
      // Luck-adjusted skill score: replay the same deal with the Advisor bot, off the main thread.
      void callWorker<number>('skill', { config }).then((advisorPnl) => {
        const updated: GameLog = { ...log, advisorPnl, skill: log.result.pnl - advisorPnl };
        saveLog(updated);
        if (updated.date) {
          saveDailyScore(updated.date, {
            id: updated.id,
            pnl: updated.result.pnl,
            skill: updated.skill,
            createdAt: updated.createdAt,
          });
        }
        if (get().gameId === updated.id) set({ log: updated });
      });
      return;
    }
    const view = game.view();
    currentAdvice = advisor ? advisor.advise(view) : null;
    set({
      view,
      verdict,
      belief: beliefOf(currentAdvice),
      advice: st.mode === 'tutorial' ? currentAdvice : null,
      size: Math.min(st.size, Math.max(1, Math.max(view.maxBuy, view.maxSell))),
    });
  },

  askAdvisor: () => {
    const st = get();
    if (!currentAdvice || st.status !== 'playing' || st.mode === 'daily' || st.advice) return;
    set({ advice: currentAdvice, hintsUsed: st.hintsUsed + 1 });
  },

  setSize: (n) => set({ size: Math.max(1, Math.min(3, n)) }),

  quit: () => {
    game = null;
    advisor = null;
    config = null;
    currentAdvice = null;
    set({ ...INITIAL });
  },
}));

/** Test-only: the engine-side game, so tests can compare it with what the store exposes. */
export function __engineForTests(): Game | null {
  return game;
}
