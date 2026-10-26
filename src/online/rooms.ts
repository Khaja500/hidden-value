/**
 * Online rooms: friends on their own devices play one multiplayer game through the game server. The server is the
 * only place the deal exists. It keeps the config (with the seed) in a private document, rebuilds the game from
 * the config and the players' actions on every request (a full replay takes well under 100 ms), and publishes:
 *
 * - the room document, readable by the room's players: the public view (packed), every player's public account,
 *   and whose turn it is. Everything in it follows from the trade feed and the reveals.
 * - one seat document per player, readable only by that player: their card.
 *
 * This module is pure (no Firestore), so the server's transitions can be tested directly.
 */
import { createMarketMaker, createMultiGame } from '../agents/factory';
import {
  MAX_SEATS,
  MIN_SEATS,
  replayMultiGame,
  type MultiGame,
  type MultiPublicView,
  type SeatAction,
} from '../engine/multiGame';
import { makeMultiConfig } from '../engine/rules';
import type { Card, Difficulty, GameConfig, PlayerAccount, PlayerAction, PlayerView } from '../engine/types';
import { maxBuyFor, maxSellFor } from '../engine/views';
import { gradeFinishedGame, type PartyResult } from '../store/partyResult';
import { encodePublicView } from './codec';

/** A player whose turn has lasted this long can be passed by anyone in the room. */
export const TURN_TIMEOUT_MS = 60_000;
export const ROOM_CODE_LENGTH = 6;
/** No 0/O, 1/I/L: codes are read out loud and typed on phones. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_NAME_LENGTH = 16;

export type RoomStatus = 'lobby' | 'playing' | 'settled';

export interface RoomPlayer {
  uid: string;
  name: string;
}

export interface RoomDoc {
  code: string;
  hostUid: string;
  status: RoomStatus;
  difficulty: Difficulty;
  advisorOn: boolean;
  /** In seat order: player i holds card position i. */
  players: RoomPlayer[];
  /** The players' uids, for the security rules. */
  playerUids: string[];
  /** Counts the games dealt in this room (0 in the lobby before the first deal). */
  gameNo: number;
  /** The public view, packed (see codec.ts). Null before the first deal. */
  pub: string | null;
  /** Each player's account. Public: it follows from their trades in the feed. */
  accounts: PlayerAccount[];
  actions: SeatAction[];
  /** When the current turn began (ms), for the turn timeout. */
  turnStartedAt: number | null;
  result: PartyResult | null;
  createdAt: number;
  updatedAt: number;
}

export interface SeatDoc {
  gameNo: number;
  seat: number;
  card: Card;
}

export interface PrivateDoc {
  gameNo: number;
  config: GameConfig;
}

export class RoomError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export function cleanName(name: string | null | undefined, fallback: string): string {
  const n = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return n || fallback;
}

export function randomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++)
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  return code;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function newRoom(
  code: string,
  host: RoomPlayer,
  difficulty: Difficulty,
  advisorOn: boolean,
  now: number,
): RoomDoc {
  return {
    code,
    hostUid: host.uid,
    status: 'lobby',
    difficulty,
    advisorOn,
    players: [host],
    playerUids: [host.uid],
    gameNo: 0,
    pub: null,
    accounts: [],
    actions: [],
    turnStartedAt: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Distinct display names, so the trade feed is never ambiguous. */
function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; ; i++) {
    const n = `${name.slice(0, MAX_NAME_LENGTH - 4)} (${i})`;
    if (!taken.includes(n)) return n;
  }
}

export function joinRoom(room: RoomDoc, p: RoomPlayer, now: number): RoomDoc {
  if (room.playerUids.includes(p.uid)) return room;
  if (room.status !== 'lobby') throw new RoomError(409, 'This game has already started');
  if (room.players.length >= MAX_SEATS) throw new RoomError(409, `This table is full (${MAX_SEATS} players)`);
  const player = {
    uid: p.uid,
    name: uniqueName(
      p.name,
      room.players.map((x) => x.name),
    ),
  };
  return {
    ...room,
    players: [...room.players, player],
    playerUids: [...room.playerUids, p.uid],
    updatedAt: now,
  };
}

/** Leaving is allowed between games. Returns null when the room is now empty. */
export function leaveRoom(room: RoomDoc, uid: string, now: number): RoomDoc | null {
  if (!room.playerUids.includes(uid)) return room;
  if (room.status === 'playing') throw new RoomError(409, 'You can leave once this game is settled');
  const players = room.players.filter((p) => p.uid !== uid);
  if (players.length === 0) return null;
  return {
    ...room,
    // Seats are renumbered, so the last game's results no longer line up with the players.
    status: 'lobby',
    hostUid: room.hostUid === uid ? players[0].uid : room.hostUid,
    players,
    playerUids: players.map((p) => p.uid),
    pub: null,
    accounts: [],
    actions: [],
    turnStartedAt: null,
    result: null,
    updatedAt: now,
  };
}

function requirePlayer(room: RoomDoc, uid: string): number {
  const seat = room.playerUids.indexOf(uid);
  if (seat < 0) throw new RoomError(403, 'You are not at this table');
  return seat;
}

/** The room document's game fields for a game in any state. */
function publish(room: RoomDoc, g: MultiGame, config: GameConfig, now: number): RoomDoc {
  const s = g.fullState();
  const settled = g.phase === 'settled';
  return {
    ...room,
    status: settled ? 'settled' : 'playing',
    pub: encodePublicView(g.publicView()),
    accounts: s.players.map((p, seat) => ({
      position: p.position,
      cash: p.cash,
      avgPrice: s.avgPrices[seat],
    })),
    actions: s.actions,
    turnStartedAt: settled ? null : now,
    result: settled
      ? gradeFinishedGame(
          config,
          room.players.map((p) => p.name),
          s.actions,
        )
      : null,
    updatedAt: now,
  };
}

/** The host deals a new game (the first, or a rematch) for everyone at the table. */
export function startGame(
  room: RoomDoc,
  uid: string,
  seed: number,
  now: number,
): { room: RoomDoc; priv: PrivateDoc; seats: { uid: string; doc: SeatDoc }[] } {
  if (room.hostUid !== uid) throw new RoomError(403, 'Only the host can deal');
  if (room.status === 'playing') throw new RoomError(409, 'A game is already in progress');
  if (room.players.length < MIN_SEATS) throw new RoomError(409, `You need at least ${MIN_SEATS} players`);
  const gameNo = room.gameNo + 1;
  const config = makeMultiConfig(room.difficulty, room.players.length, seed);
  const g = createMultiGame(config);
  const cards = g.fullState().cards;
  return {
    room: publish({ ...room, gameNo }, g, config, now),
    priv: { gameNo, config },
    seats: room.players.map((p, seat) => ({ uid: p.uid, doc: { gameNo, seat, card: cards[seat] } })),
  };
}

function replay(room: RoomDoc, priv: PrivateDoc): MultiGame {
  if (priv.gameNo !== room.gameNo) throw new Error('Room and deal are out of sync');
  return replayMultiGame(priv.config, room.actions, createMarketMaker(priv.config));
}

/**
 * A player acts. `seq` is the number of public events the client had seen, so a repeated or stale request (a
 * double tap, or a click just after a timeout passed them) is rejected instead of being applied twice.
 */
export function act(
  room: RoomDoc,
  priv: PrivateDoc,
  uid: string,
  gameNo: number,
  seq: number,
  action: PlayerAction,
  now: number,
): RoomDoc {
  const seat = requirePlayer(room, uid);
  if (room.status !== 'playing' || gameNo !== room.gameNo) throw new RoomError(409, 'This game is over');
  const g = replay(room, priv);
  if (g.currentSeat !== seat) throw new RoomError(409, 'It is not your turn');
  if (seq !== g.publicView().events.length) throw new RoomError(409, 'The market has moved: try again');
  try {
    g.act(action);
  } catch (e) {
    throw new RoomError(400, (e as Error).message);
  }
  return publish(room, g, priv.config, now);
}

/** Anyone at the table may pass for a player whose turn has timed out. */
export function timeoutPass(
  room: RoomDoc,
  priv: PrivateDoc,
  uid: string,
  gameNo: number,
  now: number,
): RoomDoc {
  requirePlayer(room, uid);
  if (room.status !== 'playing' || gameNo !== room.gameNo) throw new RoomError(409, 'This game is over');
  if (room.turnStartedAt === null || now - room.turnStartedAt < TURN_TIMEOUT_MS)
    throw new RoomError(409, 'Their turn has not timed out yet');
  const g = replay(room, priv);
  g.act({ side: 'pass', size: 0 });
  return publish(room, g, priv.config, now);
}

/** One player's view, built on the client from the room document and their own seat document. */
export function roomSeatView(pub: MultiPublicView, accounts: PlayerAccount[], seat: SeatDoc): PlayerView {
  const p = accounts[seat.seat];
  const myTurn = pub.phase === 'awaitingPlayer' && pub.turn.seat === seat.seat;
  return {
    config: pub.config,
    phase: pub.phase,
    round: pub.round,
    step: pub.step,
    revealed: pub.revealed,
    events: pub.events,
    quote: pub.quote,
    mmPosition: pub.mmPosition,
    privateCards: [Object.freeze({ position: seat.seat, card: seat.card })],
    player: { ...p },
    maxBuy: myTurn ? maxBuyFor(p.position, pub.quote) : 0,
    maxSell: myTurn ? maxSellFor(p.position, pub.quote) : 0,
    seat: seat.seat,
  };
}
