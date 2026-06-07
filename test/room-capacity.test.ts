// DO-LEVEL INTEGRATION TEST for Lobby v2 capacity + spectators: persisted state.capacity
// (default 2, legacy backfill), the spectator role past capacity, and host-gated
// set_capacity (clamps, promote-on-raise, no-evict). Mirrors room-host.test.ts's harness.

import { describe, it, expect, vi } from "vitest";

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

const okFetch = () => Promise.resolve({ ok: true, json: async () => ({}) } as unknown as Response);

type AnyRoom = Room & {
  state: Record<string, unknown> & {
    players: Array<Record<string, unknown>>;
    queue: string[];
    capacity: number;
    phase: string;
    hostId: string | null;
  };
  snapshotFor: (viewer: string | null) => Record<string, unknown>;
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

function makeRoom(slug = "table", stored?: Record<string, unknown>) {
  const sockets: WebSocket[] = [];
  const ctx = {
    storage: {
      get: async () => stored,
      put: async () => {},
      setAlarm: () => {},
      deleteAlarm: () => {},
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
  if (!stored) {
    room.state.path = `alice/${slug}`;
    room.state.owner = "alice";
    room.state.slug = slug;
    room.state.name = slug;
  }
  return { room, sockets };
}

const join = async (room: AnyRoom, ws: WebSocket, username: string) =>
  room.webSocketMessage(ws, JSON.stringify({ type: "hello", username }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("persisted capacity", () => {
  it("a fresh duel room defaults to capacity 2, and the snapshot carries it", async () => {
    const { room } = makeRoom();
    await join(room, mockWs(), "alice");
    expect(room.state.capacity).toBe(2);
    expect(room.snapshotFor("alice").capacity).toBe(2);
  });

  it("a seeded room's snapshot still exposes seed.capacity", async () => {
    const { room } = makeRoom();
    room.state.seed = { profile: "noob", personaIds: ["pp"], capacity: 5 };
    expect(room.snapshotFor(null).capacity).toBe(5);
  });

  it("legacy restore (stored capacity = 8 placeholder) recomputes max(2, seated)", async () => {
    const player = (username: string, role: string) => ({
      username, role, connected: false, guesses: [], status: "playing",
      ready: false, points: 0, pointsSpent: 0,
    });
    const stored = {
      path: "alice/old", owner: "alice", slug: "old", name: "old",
      phase: "lobby", round: 0, word: null, winner: null,
      startedAt: null, goAt: null, finishedAt: null,
      capacity: 8, // the pre-v2 ctor placeholder, persisted because state === snapshot
      players: [player("alice", "duelist"), player("bob", "duelist"), player("cara", "queued")],
      queue: ["cara"],
    };
    const { room } = makeRoom("old", stored);
    await flush(); // ctor restore runs async behind blockConcurrencyWhile
    expect(room.state.capacity).toBe(3); // queued players count too — capacity floor is the full rotation roster (duelists + queued), not just the two duelist seats
  });

  it("a legitimately-set capacity (≤6) survives restore untouched", async () => {
    const stored = {
      path: "alice/kept", owner: "alice", slug: "kept", name: "kept",
      phase: "lobby", round: 0, word: null, winner: null,
      startedAt: null, goAt: null, finishedAt: null,
      capacity: 4,
      players: [],
      queue: [],
    };
    const { room } = makeRoom("kept", stored);
    await flush();
    expect(room.state.capacity).toBe(4);
  });
});
