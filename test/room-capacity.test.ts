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

describe("spectator role", () => {
  it("the joiner past capacity is a spectator and NEVER enters the rotation queue", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "cara"); // capacity 2, both seats taken
    const cara = room.state.players.find((p) => p.username === "cara")!;
    expect(cara.role).toBe("spectator");
    expect(room.state.queue).toEqual([]); // never-rotated invariant: not in the queue,
    // and applyKothRotation only seats from the queue — so cara can never rotate in.
  });

  it("a spectator's ready is inert", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "cara");
    await room.webSocketMessage(c, JSON.stringify({ type: "ready", ready: true }));
    const cara = room.state.players.find((p) => p.username === "cara")!;
    expect(cara.ready).toBe(false);
    expect(room.state.phase).toBe("lobby");
  });

  it("KOTH rotation never touches a spectator", async () => {
    const { room } = makeRoom();
    const [a, b, c, d] = [mockWs(), mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    room.state.capacity = 3;          // open one queue seat…
    await join(room, c, "cara");      // …cara takes it (queued)
    room.state.capacity = 2;          // legacy-style shrink: cara stays seated (no evictions)
    await join(room, d, "dan");       // dan is past capacity → spectator
    room.state.winner = "alice";      // alice won the round
    (room as unknown as { applyRotation: () => void }).applyRotation();
    const dan = room.state.players.find((p) => p.username === "dan")!;
    expect(dan.role).toBe("spectator");                 // untouched by rotation
    expect(room.state.queue).not.toContain("dan");      // and still outside the queue
    // sanity: the queue advanced normally around him — cara stepped up, bob dropped back
    expect(room.state.players.find((p) => p.username === "cara")!.role).toBe("duelist");
    expect(room.state.queue).toEqual(["bob"]);
  });

  it("MAX_PLAYERS (8) still caps the room overall — joiner #9 is rejected", async () => {
    const { room } = makeRoom();
    const names = ["alice", "bob", "cara", "dan", "eve", "fay", "gus", "hal", "ivy"];
    for (const n of names) await join(room, mockWs(), n);
    expect(room.state.players.length).toBe(8);
    expect(room.state.players.some((p) => p.username === "ivy")).toBe(false);
  });
});

describe("set_capacity", () => {
  const setCap = (room: AnyRoom, ws: WebSocket, capacity: number) =>
    room.webSocketMessage(ws, JSON.stringify({ type: "set_capacity", capacity }));

  it("host-gated: a non-host sender is rejected, state unchanged", async () => {
    const { room } = makeRoom();
    const [a, b] = [mockWs(), mockWs()];
    await join(room, a, "alice"); // host
    await join(room, b, "bob");
    await setCap(room, b, 4);
    expect(room.state.capacity).toBe(2);
  });

  it("clamps to [2, 6]", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    await setCap(room, a, 99);
    expect(room.state.capacity).toBe(6);
    await setCap(room, a, 0);
    expect(room.state.capacity).toBe(2);
  });

  it("no evictions: lowering clamps to the seated count", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await setCap(room, a, 3);
    await join(room, c, "cara"); // seat 3 — queued
    expect(room.state.players.find((p) => p.username === "cara")!.role).toBe("queued");
    await setCap(room, a, 2); // 3 seated → floor is 3
    expect(room.state.capacity).toBe(3);
    expect(room.state.players.find((p) => p.username === "cara")!.role).toBe("queued");
  });

  it("raising promotes the longest-waiting spectators into the queue, join order", async () => {
    const { room } = makeRoom();
    const [a, b, c, d] = [mockWs(), mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "cara"); // spectator (capacity 2)
    await join(room, d, "dan");  // spectator
    await setCap(room, a, 3);    // one seat opens → cara only
    expect(room.state.players.find((p) => p.username === "cara")!.role).toBe("queued");
    expect(room.state.players.find((p) => p.username === "dan")!.role).toBe("spectator");
    expect(room.state.queue).toEqual(["cara"]);
    await setCap(room, a, 4);    // next seat → dan
    expect(room.state.players.find((p) => p.username === "dan")!.role).toBe("queued");
    expect(room.state.queue).toEqual(["cara", "dan"]);
  });

  it("lobby-only: rejected mid-game", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    room.state.phase = "playing";
    await setCap(room, a, 4);
    expect(room.state.capacity).toBe(2);
  });

  it("ignored outside duel rooms (challenge)", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    room.state.challengeId = "abc12";
    await setCap(room, a, 4);
    expect(room.state.capacity).toBe(2);
  });
});
