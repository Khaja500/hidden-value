/**
 * A signed-in player's game history, stored at users/{uid}/games/{id}. Solo games (practice, daily, tutorial) are
 * the browser's GameLog, written by the player's own browser; online games are written by the game server when
 * they settle, so nobody can edit their own online results.
 */
import type { Difficulty } from '../engine/types';
import type { GameLog } from '../store/gameStore';
import type { RoomDoc } from './rooms';

export type SoloHistoryEntry = GameLog & { kind: 'solo' };

export interface OnlineHistoryEntry {
  kind: 'online';
  id: string;
  createdAt: number;
  difficulty: Difficulty;
  code: string;
  gameNo: number;
  /** Everyone's names in seat order. */
  players: string[];
  seat: number;
  /** 1 = best P&L at the table (ties share a rank). */
  rank: number;
  pnl: number;
  /** The skill part of the P&L: each trade's expected profit at the time. */
  expected: number;
  value: number;
  card: number;
  trades: number;
}

export type HistoryEntry = SoloHistoryEntry | OnlineHistoryEntry;

export function onlineHistoryEntry(room: RoomDoc, seat: number): OnlineHistoryEntry {
  const result = room.result!;
  const me = result.standings.find((s) => s.seat === seat)!;
  return {
    kind: 'online',
    id: `${room.code}-${room.gameNo}`,
    createdAt: room.updatedAt,
    difficulty: room.difficulty,
    code: room.code,
    gameNo: room.gameNo,
    players: room.players.map((p) => p.name),
    seat,
    rank: 1 + result.standings.filter((s) => s.pnl > me.pnl + 1e-9).length,
    pnl: me.pnl,
    expected: me.expected,
    value: result.settlement.value,
    card: me.card,
    trades: me.trades,
  };
}

export function soloHistoryEntry(log: GameLog): SoloHistoryEntry {
  return { ...log, kind: 'solo' };
}

export interface HistorySummary {
  games: number;
  totalPnl: number;
  online: { games: number; wins: number };
  bestPnl: number | null;
}

export function summarize(entries: readonly HistoryEntry[]): HistorySummary {
  const pnl = (e: HistoryEntry) => (e.kind === 'online' ? e.pnl : e.result.pnl);
  const online = entries.filter((e): e is OnlineHistoryEntry => e.kind === 'online');
  return {
    games: entries.length,
    totalPnl: entries.reduce((a, e) => a + pnl(e), 0),
    online: { games: online.length, wins: online.filter((e) => e.rank === 1).length },
    bestPnl: entries.length ? Math.max(...entries.map(pnl)) : null,
  };
}
