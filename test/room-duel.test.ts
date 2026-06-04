// DO-LEVEL INTEGRATION TEST for the duel feature (Plan 1 ready-gate + 3-2-1 countdown,
// Plan 2 1v1 seats + king-of-the-hill queue + W/L/T). This is the regression guard that
// was MISSING when a merge silently dropped all the room.ts duel wiring: the pure modules
// (rotation/duel/scoreboard) kept passing while the integration was gone. This drives the
// real Room DO through webSocketMessage (hello → ready → countdown → alarm go-live → guess →
// finish → rotation), so a future de-integration fails here instead of shipping dead.

import { describe, it, expect, vi } from "vitest";

// The Room DO extends DurableObject from the workers runtime; stub it so the module imports
// under the plain-node vitest environment (mirrors room-finish-broadcast.test.ts).
vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

import { Room } from "../src/room.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
const okFetch = () => Promise.resolve({ ok: true, json: async () => ({}) } as unknown as Response);

type AnyRoom = Room & {
  state: Record<string, unknown> & { players: Array<Record<string, unknown>>; queue: string[]; throne: unknown; phase: string; word: string | null; goAt: number | null };
  alarm: () => Promise<void>;
};

function mockWs(): WebSocket {
  let attach: unknown = null;
  return {
    serializeAttachment: (v: unknown) => { attach = v; },
    deserializeAttachment: () => attach,
    send: () => {},
    close: () => {},
  } as unknown as WebSocket;
}

function makeRoom(slug = "duel") {
  const sockets: WebSocket[] = [];
  let alarmAt: number | null = null;
  const ctx = {
    storage: {
      get: async () => undefined,
      put: async () => {},
      setAlarm: (t: number) => { alarmAt = t; },
      deleteAlarm: () => { alarmAt = null; },
    },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    getWebSockets: () => sockets,
    acceptWebSocket: (ws: WebSocket) => sockets.push(ws),
    waitUntil: () => {},
  };
  const stub = { idFromName: (n: string) => n, get: () => ({ fetch: okFetch }) };
  const env = {
    DIRECTORY: { put: async () => {}, get: async () => null },
    USER: stub, WORDSTATS: stub, SCIENCE: stub, ARENA: stub, CHALLENGE: stub, DAILY: stub,
  };
  const room = new Room(ctx as never, env as never) as unknown as AnyRoom;
  // Stamp identity the way fetch()/ws would (a normal room → a duel room).
  room.state.path = `alice/${slug}`;
  room.state.owner = "alice";
  room.state.slug = slug;
  room.state.name = slug;
  return { room, sockets, getAlarm: () => alarmAt };
}

const join = async (room: AnyRoom, ws: WebSocket, username: string) =>
  room.webSocketMessage(ws, JSON.stringify({ type: "hello", username }));
const player = (room: AnyRoom, u: string) => room.state.players.find((p) => p.username === u)!;

describe("duel room — full DO integration (seats → ready → countdown → KOTH)", () => {
  it("seats the first two as duelists and queues the rest", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "carol");

    expect(player(room, "alice").role).toBe("duelist");
    expect(player(room, "bob").role).toBe("duelist");
    expect(player(room, "carol").role).toBe("queued");
    expect(room.state.queue).toEqual(["carol"]);
    expect(room.state.phase).toBe("lobby");
  });

  it("ready-gate fires the countdown only when BOTH duelists are ready", async () => {
    const { room, getAlarm } = makeRoom();
    const [a, b] = [mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");

    await room.webSocketMessage(a, JSON.stringify({ type: "ready", ready: true }));
    expect(room.state.phase).toBe("lobby"); // bob not ready yet

    await room.webSocketMessage(b, JSON.stringify({ type: "ready", ready: true }));
    expect(room.state.phase).toBe("countdown");
    expect(typeof room.state.goAt).toBe("number");
    expect(getAlarm()).toBe(room.state.goAt); // alarm armed to flip the round live
  });

  it("the countdown alarm goes the round live through runStart", async () => {
    const { room } = makeRoom();
    const [a, b] = [mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await room.webSocketMessage(a, JSON.stringify({ type: "ready", ready: true }));
    await room.webSocketMessage(b, JSON.stringify({ type: "ready", ready: true }));

    room.state.goAt = Date.now() - 1; // simulate the 3-2-1 elapsing
    await room.alarm();
    expect(room.state.phase).toBe("playing");
    expect(typeof room.state.word).toBe("string");
    expect((room.state.word as string).length).toBe(5);
  });

  it("a win finishes the round and KOTH rotates: winner stays, loser queues, next steps up", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "carol");
    await room.webSocketMessage(a, JSON.stringify({ type: "ready", ready: true }));
    await room.webSocketMessage(b, JSON.stringify({ type: "ready", ready: true }));
    room.state.goAt = Date.now() - 1;
    await room.alarm();
    expect(room.state.phase).toBe("playing");

    const word = room.state.word as string;
    await room.webSocketMessage(a, JSON.stringify({ type: "guess", word })); // alice greens it → wins
    await flush();

    expect(room.state.phase).toBe("finished");
    expect(room.state.winner).toBe("alice");
    // KOTH: alice keeps the throne (streak 1), carol rotates in, bob drops to the back.
    expect(room.state.throne).toEqual({ username: "alice", streak: 1 });
    expect(player(room, "alice").role).toBe("duelist");
    expect(player(room, "carol").role).toBe("duelist");
    expect(player(room, "bob").role).toBe("queued");
    expect(room.state.queue).toEqual(["bob"]);
    // W/L/T is scoped to the two duelists; the spectator (carol) earns no record this round.
    const sb = (room.state.scoreboard as Array<{ username: string; wins: number; losses: number }>);
    expect(sb.find((s) => s.username === "alice")?.wins).toBe(1);
    expect(sb.find((s) => s.username === "bob")?.losses).toBe(1);
    expect(sb.find((s) => s.username === "carol")).toBeUndefined();
  });

  it("human vs worduler advances round to round (the worduler stays ready)", async () => {
    const { room } = makeRoom("robots"); // slug "robots" → ensureBot seats a worduler duelist
    const a = mockWs();
    await join(room, a, "alice");

    const bot = room.state.players.find((p) => p.isBot)!;
    expect(bot).toBeTruthy();
    expect(bot.role).toBe("duelist");
    expect(bot.ready).toBe(true); // born ready

    // Round 1: alice's single tap is enough (the worduler is always ready) → countdown → live.
    await room.webSocketMessage(a, JSON.stringify({ type: "ready", ready: true }));
    expect(room.state.phase).toBe("countdown");
    room.state.goAt = Date.now() - 1;
    await room.alarm();
    expect(room.state.phase).toBe("playing");

    // alice solves → round finishes; the worduler must NOT be left un-ready (deadlock).
    await room.webSocketMessage(a, JSON.stringify({ type: "guess", word: room.state.word as string }));
    await flush();
    expect(room.state.phase).toBe("finished");
    expect(room.state.players.find((p) => p.isBot)!.ready).toBe(true);

    // Round 2: alice's single tap re-fires the countdown — proves no round-2 deadlock.
    await room.webSocketMessage(a, JSON.stringify({ type: "ready", ready: true }));
    expect(room.state.phase).toBe("countdown");
  });

  it("a spectator in the queue cannot guess (only duelists play)", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "carol");
    await room.webSocketMessage(a, JSON.stringify({ type: "ready", ready: true }));
    await room.webSocketMessage(b, JSON.stringify({ type: "ready", ready: true }));
    room.state.goAt = Date.now() - 1;
    await room.alarm();

    const word = room.state.word as string;
    await room.webSocketMessage(c, JSON.stringify({ type: "guess", word })); // carol is queued
    expect(player(room, "carol").guesses.length).toBe(0); // rejected — spectators don't play
    expect(room.state.phase).toBe("playing");
  });

  // helper: drive a fresh /robots room to a live round with one worduler duelist.
  // Pushes the human socket into the room's socket list (the real DO does this in fetch via
  // acceptWebSocket; these tests bypass fetch) so broadcasts actually reach a client.
  async function liveRobotRoom() {
    const { room, sockets } = makeRoom("robots");
    const a = mockWs();
    sockets.push(a);
    await join(room, a, "alice");
    await room.webSocketMessage(a, JSON.stringify({ type: "ready", ready: true }));
    room.state.goAt = Date.now() - 1;
    await room.alarm();
    const bot = room.state.players.find((p) => p.isBot)!;
    return { room, sockets, bot, a };
  }

  it("emitBotTyping broadcasts a count-only typing pulse to clients", async () => {
    const { room, sockets, bot } = await liveRobotRoom();

    const got: Array<{ type: string; username?: string; len?: number }> = [];
    (sockets[0] as unknown as { send: (s: string) => void }).send = (s: string) => got.push(JSON.parse(s));

    (room as unknown as { emitBotTyping: (u: string, n: number) => void }).emitBotTyping(bot.username, 3);

    const pulse = got.find((m) => m.type === "typing");
    expect(pulse).toBeTruthy();
    expect(pulse!.username).toBe(bot.username);
    expect(pulse!.len).toBe(3);
  });
});
