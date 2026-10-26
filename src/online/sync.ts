/** Copies finished solo games to the signed-in player's history. Silent when signed out or offline. */
import type { GameLog } from '../store/gameStore';
import { useAuth } from '../store/authStore';

export function syncLog(log: GameLog): void {
  const user = useAuth.getState().user;
  if (!user) return;
  void import('./cloud').then((c) => c.saveSoloGame(user.uid, log)).catch(() => {});
}
