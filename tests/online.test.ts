import { describe, expect, it } from 'vitest';
import { createMultiGame } from '../src/agents/factory';
import { toSeatView } from '../src/engine/multiGame';
import { Rng } from '../src/engine/rng';
import { makeMultiConfig } from '../src/engine/rules';
import { decodePublicView, encodePublicView } from '../src/online/codec';
import {
  act,
  joinRoom,
  leaveRoom,
  newRoom,
  normalizeCode,
  randomCode,
  roomSeatView,
  RoomError,
  startGame,
  timeoutPass,
  TURN_TIMEOUT_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type PrivateDoc,
  type RoomDoc,
  type SeatDoc,
} from '../src/online/rooms';
import { ALL_DIFFICULTIES, randomAction } from './helpers';

const PLAYERS = [
  { uid: 'u-ana', name: 'Ana' },
  { uid: 'u-ben', name: 'Ben' },
  { uid: 'u-cy', name: 'Cy' },
  { uid: 'u-dee', name: 'Dee' },
];

function tableOf(n: number, difficulty = ALL_DIFFICULTIES[1]): RoomDoc {
  let room = newRoom('ABC234', PLAYERS[0], difficulty, true, 0);
  for (const p of PLAYERS.slice(1, n)) room = joinRoom(room, p, 0);
  return room;
}

/** Plays a whole online game with random legal actions, each from the player whose turn it is. */
function playOut(room: RoomDoc, priv: PrivateDoc, seats: SeatDoc[], seed: number): RoomDoc {
  const rng = new Rng(seed);
  while (room.status === 'playing') {
    const pub = decodePublicView(room.pub!);
    const seat = pub.turn.seat!;
    const view = roomSeatView(pub, room.accounts, seats[seat]);
    room = act(room, priv, room.playerUids[seat], room.gameNo, pub.events.length, randomAction(view, rng), 1);
  }
  return room;
}

describe('online codec', () => {
  it('round-trips the public view exactly, at every difficulty and table size', () => {
    for (const d of ALL_DIFFICULTIES) {
      for (const seats of [2, 3, 4]) {
        const g = createMultiGame(makeMultiConfig(d, seats, 1000 + seats));
        const rng = new Rng(seats);
        while (g.phase !== 'settled') g.act(randomAction(g.seatView(g.currentSeat!), rng));
        const v = g.publicView();
        const packed = encodePublicView(v);
        expect(decodePublicView(packed)).toEqual(v);
        expect(packed.length).toBeLessThan(JSON.stringify(v).length / 2);
      }
    }
  });
});

describe('online rooms', () => {
  it('makes readable codes and normalises what people type', () => {
    const code = randomCode(() => 0.999);
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect([...code].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
    expect(normalizeCode(' abc-234 ')).toBe('ABC234');
  });

  it('seats players in join order, gives repeated names a number, and caps the table at 4', () => {
    let room = tableOf(1);
    room = joinRoom(room, { uid: 'u-2', name: 'Ana' }, 0);
    expect(room.players.map((p) => p.name)).toEqual(['Ana', 'Ana (2)']);
    expect(joinRoom(room, { uid: 'u-2', name: 'Ana' }, 0)).toBe(room);
    room = joinRoom(joinRoom(room, PLAYERS[2], 0), PLAYERS[3], 0);
    expect(() => joinRoom(room, { uid: 'u-5', name: 'Eve' }, 0)).toThrow(RoomError);
  });

  it('only lets the host deal, and only with at least 2 players', () => {
    expect(() => startGame(tableOf(1), 'u-ana', 1, 0)).toThrow(/at least 2/);
    expect(() => startGame(tableOf(2), 'u-ben', 1, 0)).toThrow(/host/);
  });

  it('plays the same game as the one-screen engine, and never puts a hidden card in the room document', () => {
    for (const n of [2, 3, 4]) {
      const { room: dealt, priv, seats } = startGame(tableOf(n), 'u-ana', 77 + n, 0);
      const seatDocs = seats.map((s) => s.doc);
      expect(seatDocs.map((s) => s.seat)).toEqual(seats.map((_, i) => i));
      // The room document holds exactly the engine's public view (which the no-leak tests cover), the public
      // accounts and the actions; no seed, deal or result until settlement.
      expect(decodePublicView(dealt.pub!)).toEqual(createMultiGame(priv.config).publicView());
      expect(Object.keys(dealt).sort()).toEqual(
        Object.keys(newRoom('X', PLAYERS[0], 'easy', true, 0)).sort(),
      );
      expect(dealt.result).toBeNull();
      expect(JSON.stringify(dealt)).not.toMatch(/seed|cards|tickets|botRecords/);

      const done = playOut(dealt, priv, seatDocs, n);
      expect(done.status).toBe('settled');
      expect(done.result!.standings).toHaveLength(n);
      // Replaying the actions in the one-screen engine gives the same results.
      const g = createMultiGame(priv.config);
      for (const a of done.actions) g.act({ side: a.side, size: a.size });
      expect(g.settlement()).toEqual(done.result!.settlement);
      // A player's view built from the documents matches the engine's own seat view.
      const v = roomSeatView(decodePublicView(done.pub!), done.accounts, seatDocs[1]);
      expect(v).toEqual(toSeatView(g.fullState(), 1));
    }
  });

  it('rejects out-of-turn, stale and repeated actions', () => {
    const { room, priv } = startGame(tableOf(2), 'u-ana', 5, 0);
    const pub = decodePublicView(room.pub!);
    const seat = pub.turn.seat!;
    const me = room.playerUids[seat];
    const other = room.playerUids[1 - seat];
    const seq = pub.events.length;
    expect(() => act(room, priv, other, 1, seq, { side: 'pass', size: 0 }, 1)).toThrow(/not your turn/);
    expect(() => act(room, priv, 'u-zed', 1, seq, { side: 'pass', size: 0 }, 1)).toThrow(/not at this table/);
    expect(() => act(room, priv, me, 1, seq - 1, { side: 'pass', size: 0 }, 1)).toThrow(/moved/);
    expect(() => act(room, priv, me, 1, seq, { side: 'buy', size: 9 }, 1)).toThrow(/Illegal/);
    const after = act(room, priv, me, 1, seq, { side: 'pass', size: 0 }, 1);
    expect(() => act(after, priv, me, 1, seq, { side: 'pass', size: 0 }, 1)).toThrow(RoomError);
  });

  it('lets anyone pass for a player only once their turn has timed out', () => {
    const { room, priv } = startGame(tableOf(3), 'u-ana', 9, 1000);
    const waiting = room.playerUids.find((_, i) => i !== decodePublicView(room.pub!).turn.seat)!;
    expect(() => timeoutPass(room, priv, waiting, 1, 1000 + TURN_TIMEOUT_MS - 1)).toThrow(/not timed out/);
    const after = timeoutPass(room, priv, waiting, 1, 1000 + TURN_TIMEOUT_MS);
    expect(after.actions).toHaveLength(1);
    expect(after.actions[0].side).toBe('pass');
  });

  it('allows leaving only between games, and hands the table to the next player', () => {
    const { room, priv, seats } = startGame(tableOf(3), 'u-ana', 3, 0);
    expect(() => leaveRoom(room, 'u-ben', 0)).toThrow(/settled/);
    const done = playOut(
      room,
      priv,
      seats.map((s) => s.doc),
      3,
    );
    const left = leaveRoom(done, 'u-ana', 0)!;
    expect(left.hostUid).toBe('u-ben');
    expect(left.status).toBe('lobby');
    expect(left.result).toBeNull();
    expect(leaveRoom(leaveRoom(left, 'u-ben', 0)!, 'u-cy', 0)).toBeNull();
  });
});
