/** Calls to the online game server. Each request carries the player's Firebase ID token. */
import type { ActionSide, Difficulty } from '../engine/types';
import { idToken } from '../store/authStore';
import { GAME_SERVER_URL } from './config';

async function call<T>(op: string, body: Record<string, unknown>): Promise<T> {
  const token = await idToken();
  let res: Response;
  try {
    res = await fetch(`${GAME_SERVER_URL}/${op}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the game server. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `The game server answered ${res.status}`);
  return data;
}

export const api = {
  create: (difficulty: Difficulty, advisorOn: boolean) =>
    call<{ code: string }>('create', { difficulty, advisorOn }),
  join: (code: string) => call<{ code: string }>('join', { code }),
  leave: (code: string) => call<object>('leave', { code }),
  start: (code: string) => call<{ gameNo: number }>('start', { code }),
  act: (code: string, gameNo: number, seq: number, side: ActionSide, size: number) =>
    call<object>('act', { code, gameNo, seq, side, size }),
  timeout: (code: string, gameNo: number) => call<object>('timeout', { code, gameNo }),
};
