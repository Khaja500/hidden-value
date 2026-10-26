/** The signed-in player's history in Firestore (see history.ts for what is stored). */
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import type { GameLog } from '../store/gameStore';
import { db } from './firebase';
import { soloHistoryEntry, type HistoryEntry } from './history';

export const HISTORY_LIMIT = 100;

const games = (uid: string) => collection(db, 'users', uid, 'games');

/** Firestore rejects `undefined` fields, so optional ones are dropped. */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export async function saveSoloGame(uid: string, log: GameLog): Promise<void> {
  await setDoc(doc(games(uid), log.id), clean(soloHistoryEntry(log)));
}

export async function listHistory(uid: string): Promise<HistoryEntry[]> {
  const snap = await getDocs(query(games(uid), orderBy('createdAt', 'desc'), limit(HISTORY_LIMIT)));
  return snap.docs.map((d) => d.data() as HistoryEntry);
}

export async function getSoloGame(uid: string, id: string): Promise<GameLog | null> {
  const snap = await getDoc(doc(games(uid), id));
  const e = snap.data() as HistoryEntry | undefined;
  return e?.kind === 'solo' ? e : null;
}
