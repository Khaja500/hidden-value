/**
 * The online game server (Cloud Run). It verifies the caller's Firebase ID token, runs one room transition from
 * src/online/rooms.ts inside a Firestore transaction, and writes the room, the private deal, the players' seat
 * documents and, when a game settles, each player's history entry. Clients never write game state themselves;
 * they read the room and their own seat document directly from Firestore (see firestore.rules).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { randomSeed } from '../../src/engine/rng';
import { DIFFICULTY_ORDER } from '../../src/engine/rules';
import type { ActionSide, Difficulty } from '../../src/engine/types';
import { onlineHistoryEntry } from '../../src/online/history';
import {
  act,
  cleanName,
  joinRoom,
  leaveRoom,
  newRoom,
  normalizeCode,
  randomCode,
  RoomError,
  startGame,
  timeoutPass,
  ROOM_CODE_LENGTH,
  type PrivateDoc,
  type RoomDoc,
} from '../../src/online/rooms';

const PROJECT_ID = process.env.PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);
/** Rooms, deals and seats are deleted by a Firestore TTL policy this long after their last update. */
const ROOM_TTL_MS = 7 * 24 * 3600 * 1000;

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

const roomRef = (code: string) => db.collection('rooms').doc(code);
const dealRef = (code: string) => roomRef(code).collection('private').doc('deal');
const seatRef = (code: string, uid: string) => roomRef(code).collection('seats').doc(uid);

function expireAt(now: number) {
  return { expireAt: Timestamp.fromMillis(now + ROOM_TTL_MS) };
}

interface Caller {
  uid: string;
  name: string;
}

async function caller(req: IncomingMessage): Promise<Caller> {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!m) throw new RoomError(403, 'Sign in to play online');
  let token;
  try {
    token = await auth.verifyIdToken(m[1]);
  } catch {
    throw new RoomError(403, 'Your sign-in has expired: sign in again');
  }
  const profile = await db.collection('users').doc(token.uid).get();
  const fallback = (token.email ?? 'Player').split('@')[0];
  return {
    uid: token.uid,
    name: cleanName(profile.get('displayName') ?? token.name, cleanName(fallback, 'Player')),
  };
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new RoomError(400, `Missing ${field}`);
  return v;
}

function int(v: unknown, field: string): number {
  if (!Number.isInteger(v)) throw new RoomError(400, `Missing ${field}`);
  return v as number;
}

function codeOf(body: Record<string, unknown>): string {
  const code = normalizeCode(str(body.code, 'code'));
  if (code.length !== ROOM_CODE_LENGTH) throw new RoomError(404, 'No table with that code');
  return code;
}

async function getRoom(tx: Transaction, code: string): Promise<RoomDoc> {
  const snap = await tx.get(roomRef(code));
  if (!snap.exists) throw new RoomError(404, 'No table with that code');
  return snap.data() as RoomDoc;
}

async function getDeal(tx: Transaction, code: string): Promise<PrivateDoc> {
  const snap = await tx.get(dealRef(code));
  if (!snap.exists) throw new Error(`Room ${code} has no deal`);
  return snap.data() as PrivateDoc;
}

/** Writes the room, and each player's history entry if this write settled the game. */
function writeRoom(tx: Transaction, before: RoomDoc, room: RoomDoc): void {
  tx.set(roomRef(room.code), { ...room, ...expireAt(room.updatedAt) });
  if (before.status === 'playing' && room.status === 'settled' && room.result) {
    room.players.forEach((p, seat) => {
      const entry = onlineHistoryEntry(room, seat);
      tx.set(db.collection('users').doc(p.uid).collection('games').doc(entry.id), entry);
    });
  }
}

type Handler = (who: Caller, body: Record<string, unknown>, now: number) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  create: async (who, body, now) => {
    const difficulty = str(body.difficulty, 'difficulty') as Difficulty;
    if (!DIFFICULTY_ORDER.includes(difficulty)) throw new RoomError(400, 'Unknown table');
    const advisorOn = body.advisorOn !== false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomCode();
      const created = await db.runTransaction(async (tx) => {
        const snap = await tx.get(roomRef(code));
        // A code is reused only once its room has gone quiet long enough to be on its way out.
        if (snap.exists && now - (snap.get('updatedAt') as number) < ROOM_TTL_MS) return false;
        tx.set(roomRef(code), { ...newRoom(code, who, difficulty, advisorOn, now), ...expireAt(now) });
        return true;
      });
      if (created) return { code };
    }
    throw new Error('Could not find a free table code');
  },

  join: (who, body, now) =>
    db.runTransaction(async (tx) => {
      const code = codeOf(body);
      const room = await getRoom(tx, code);
      const next = joinRoom(room, who, now);
      if (next !== room) tx.set(roomRef(code), { ...next, ...expireAt(now) });
      return { code };
    }),

  leave: (who, body, now) =>
    db.runTransaction(async (tx) => {
      const code = codeOf(body);
      const room = await getRoom(tx, code);
      const next = leaveRoom(room, who.uid, now);
      if (next === null) {
        tx.delete(roomRef(code));
        tx.delete(dealRef(code));
      } else if (next !== room) tx.set(roomRef(code), { ...next, ...expireAt(now) });
      tx.delete(seatRef(code, who.uid));
      return {};
    }),

  start: (who, body, now) =>
    db.runTransaction(async (tx) => {
      const code = codeOf(body);
      const room = await getRoom(tx, code);
      const { room: next, priv, seats } = startGame(room, who.uid, randomSeed(), now);
      tx.set(dealRef(code), { ...priv, ...expireAt(now) });
      for (const s of seats) tx.set(seatRef(code, s.uid), { ...s.doc, ...expireAt(now) });
      writeRoom(tx, room, next);
      return { gameNo: next.gameNo };
    }),

  act: (who, body, now) =>
    db.runTransaction(async (tx) => {
      const code = codeOf(body);
      const side = str(body.side, 'side') as ActionSide;
      if (side !== 'buy' && side !== 'sell' && side !== 'pass') throw new RoomError(400, 'Unknown side');
      const room = await getRoom(tx, code);
      const deal = await getDeal(tx, code);
      const next = act(
        room,
        deal,
        who.uid,
        int(body.gameNo, 'gameNo'),
        int(body.seq, 'seq'),
        {
          side,
          size: int(body.size, 'size'),
        },
        now,
      );
      writeRoom(tx, room, next);
      return {};
    }),

  timeout: (who, body, now) =>
    db.runTransaction(async (tx) => {
      const code = codeOf(body);
      const room = await getRoom(tx, code);
      const deal = await getDeal(tx, code);
      writeRoom(tx, room, timeoutPass(room, deal, who.uid, int(body.gameNo, 'gameNo'), now));
      return {};
    }),
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new RoomError(400, 'Request too large');
  }
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new RoomError(400, 'Bad request');
  }
}

const server = createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();
  const op = (req.url ?? '/').replace(/^\/+|\/+$/g, '').split('?')[0];
  if (req.method === 'GET' && op === '') return send(res, 200, { ok: true });
  const handler = req.method === 'POST' ? HANDLERS[op] : undefined;
  if (!handler) return send(res, 404, { error: 'Not found' });
  void (async () => {
    try {
      const who = await caller(req);
      const result = await handler(who, await readBody(req), Date.now());
      send(res, 200, result);
    } catch (e) {
      if (e instanceof RoomError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Something went wrong on the server' });
    }
  })();
});

server.listen(Number(process.env.PORT ?? 8080), () => {
  console.log(`Game server listening on ${process.env.PORT ?? 8080}`);
});
