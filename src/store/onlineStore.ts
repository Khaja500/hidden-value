/**
 * The online table, seen from one player's device. It listens to the room document (public) and this player's
 * seat document (their card), and builds their PlayerView from the two. The deal itself never reaches the
 * browser. The Advisor runs here, on that view, exactly as in the other modes.
 */
import { create } from 'zustand';
import { Advisor, type Advice } from '../agents/advisor';
import type { MultiPublicView } from '../engine/multiGame';
import type { Difficulty, PlayerAction, PlayerView } from '../engine/types';
import { api } from '../online/api';
import { decodePublicView } from '../online/codec';
import { roomSeatView, type RoomDoc, type SeatDoc } from '../online/rooms';
import type { Belief } from './gameStore';

export interface OnlineState {
  code: string | null;
  /** 'missing': the room does not exist, or this player is not at it (the rules hide it either way). */
  roomStatus: 'idle' | 'loading' | 'ready' | 'missing';
  room: RoomDoc | null;
  pub: MultiPublicView | null;
  /** This player's view of the current game, once their seat document has caught up with the room. */
  view: PlayerView | null;
  belief: Belief | null;
  advice: Advice | null;
  hints: number;
  size: number;
  busy: boolean;
  /**
   * The event count this player's last action was sent at, until the server answers. The room can reach the
   * player's next turn before that answer does (they act last in one step and first in the next), so only an
   * action at this same point in the game is blocked.
   */
  sentAt: number | null;
  error: string | null;
  /** Start listening to a room (after creating or joining it, or when opening its link). */
  watch: (code: string, uid: string) => void;
  unwatch: () => void;
  create: (difficulty: Difficulty, advisorOn: boolean) => Promise<string>;
  join: (code: string) => Promise<string>;
  leave: () => Promise<void>;
  start: () => Promise<void>;
  act: (a: PlayerAction) => Promise<void>;
  timeout: () => Promise<void>;
  askAdvisor: () => void;
  setSize: (n: number) => void;
  clearError: () => void;
}

// ---- Listener and Advisor: never put into React state ---------------------------------------------------------
let stop: (() => void) | null = null;
let advisor: Advisor | null = null;
let advisorKey = '';
let currentAdvice: Advice | null = null;
let seatDoc: SeatDoc | null = null;
/** Bumped on every watch/unwatch, so late callbacks from an old room are ignored. */
let generation = 0;

function beliefOf(a: Advice | null): Belief | null {
  return a ? { mean: a.estimate.mean, sd: a.estimate.sd, distribution: a.distribution } : null;
}

const EMPTY = {
  code: null,
  roomStatus: 'idle' as const,
  room: null,
  pub: null,
  view: null,
  belief: null,
  advice: null,
  hints: 0,
  size: 1,
  busy: false,
  sentAt: null,
  error: null,
};

export const useOnline = create<OnlineState>((set, get) => {
  /** Rebuilds this player's view whenever the room or their seat changes. */
  const refresh = () => {
    const { room, pub } = get();
    if (!room || !pub || !seatDoc || seatDoc.gameNo !== room.gameNo || room.status === 'lobby') {
      currentAdvice = null;
      return set({ view: null, belief: null, advice: null });
    }
    const view = roomSeatView(pub, room.accounts, seatDoc);
    const key = `${room.code}-${room.gameNo}`;
    if (key !== advisorKey) {
      advisor = new Advisor();
      advisorKey = key;
      set({ hints: 0 });
    }
    const myTurn = pub.phase === 'awaitingPlayer' && pub.turn.seat === seatDoc.seat;
    const prevSeq = get().view?.events.length;
    currentAdvice = room.advisorOn && myTurn ? advisor!.advise(view) : null;
    const st = get();
    set({
      view,
      belief: beliefOf(currentAdvice),
      // Advice the player asked for stays up only while the market has not moved.
      advice: st.advice && prevSeq === view.events.length ? currentAdvice : null,
      size: Math.min(st.size, Math.max(1, Math.max(view.maxBuy, view.maxSell))),
    });
  };

  const run = async (p: () => Promise<unknown>) => {
    set({ busy: true, error: null });
    try {
      await p();
    } catch (e) {
      set({ error: (e as Error).message });
      throw e;
    } finally {
      set({ busy: false });
    }
  };

  return {
    ...EMPTY,

    watch: (code, uid) => {
      // A denied listener has stopped for good, so a player who just joined listens again.
      if (get().code === code && stop && get().roomStatus !== 'missing') return;
      get().unwatch();
      const gen = ++generation;
      set({ ...EMPTY, code, roomStatus: 'loading' });
      void Promise.all([import('../online/firebase'), import('firebase/firestore')]).then(
        ([{ db }, { doc, onSnapshot }]) => {
          if (gen !== generation) return;
          const roomRef = doc(db, 'rooms', code);
          const unRoom = onSnapshot(
            roomRef,
            (snap) => {
              if (gen !== generation) return;
              if (!snap.exists()) return set({ roomStatus: 'missing', room: null, pub: null });
              const room = snap.data() as RoomDoc;
              set({ roomStatus: 'ready', room, pub: room.pub ? decodePublicView(room.pub) : null });
              refresh();
            },
            // Permission denied: the player is not at this table (yet).
            () => gen === generation && set({ roomStatus: 'missing', room: null, pub: null }),
          );
          const unSeat = onSnapshot(
            doc(db, 'rooms', code, 'seats', uid),
            (snap) => {
              if (gen !== generation) return;
              seatDoc = snap.exists() ? (snap.data() as SeatDoc) : null;
              refresh();
            },
            () => {},
          );
          stop = () => {
            unRoom();
            unSeat();
          };
        },
      );
    },

    unwatch: () => {
      generation++;
      stop?.();
      stop = null;
      advisor = null;
      advisorKey = '';
      currentAdvice = null;
      seatDoc = null;
      set({ ...EMPTY });
    },

    create: async (difficulty, advisorOn) => {
      let code = '';
      await run(async () => {
        code = (await api.create(difficulty, advisorOn)).code;
      });
      return code;
    },

    join: async (code) => {
      let joined = '';
      await run(async () => {
        joined = (await api.join(code)).code;
      });
      return joined;
    },

    leave: async () => {
      const code = get().code;
      if (code) await run(() => api.leave(code));
    },

    start: async () => {
      const code = get().code;
      if (code) await run(() => api.start(code));
    },

    act: async (a) => {
      const { code, room, view, sentAt } = get();
      if (!code || !room || !view) return;
      const seq = view.events.length;
      if (sentAt === seq) return;
      if (a.side === 'buy' ? a.size > view.maxBuy : a.side === 'sell' ? a.size > view.maxSell : false) return;
      set({ sentAt: seq, error: null });
      try {
        await api.act(code, room.gameNo, seq, a.side, a.size);
      } catch (e) {
        set({ error: (e as Error).message });
      } finally {
        if (get().sentAt === seq) set({ sentAt: null });
      }
    },

    timeout: async () => {
      const { code, room } = get();
      if (code && room) await run(() => api.timeout(code, room.gameNo)).catch(() => {});
    },

    askAdvisor: () => {
      const st = get();
      if (!currentAdvice || st.advice || !st.room?.advisorOn) return;
      set({ advice: currentAdvice, hints: st.hints + 1 });
    },

    setSize: (n) => set({ size: Math.max(1, Math.min(3, n)) }),

    clearError: () => set({ error: null }),
  };
});
