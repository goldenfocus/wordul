// DO-LEVEL INTEGRATION TEST for the host model (hostId — first connected human,
// join-order succession, no reclaim). Drives the real Room DO through webSocketMessage
// and webSocketClose so a future de-integration fails here instead of shipping silent.

import { describe, it, expect, vi } from "vitest";

// The Room DO extends DurableObject from the workers runtime; stub it so the module imports
// under the plain-node vitest environment (mirrors room-duel.test.ts).
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
    chat: Array<{ kind: string; text: string }>;
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

function makeRoom(slug = "lobby") {
  const sockets: WebSocket[] = [];
  const ctx = {
    storage: {
      get: async () => undefined,
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
  room.state.path = `alice/${slug}`;
  room.state.owner = "alice";
  room.state.slug = slug;
  room.state.name = slug;
  return { room, sockets };
}

const join = async (room: AnyRoom, ws: WebSocket, username: string) =>
  room.webSocketMessage(ws, JSON.stringify({ type: "hello", username }));

describe("host model", () => {
  it("first human to hello becomes host, silently", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    expect(room.state.hostId).toBe("alice");
    // initial assignment is not announced
    expect(room.state.chat.some((c) => /is now the host/.test(c.text ?? ""))).toBe(false);
  });

  it("host passes to the next connected human in join order on disconnect", async () => {
    const { room } = makeRoom();
    const [a, b, c] = [mockWs(), mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await join(room, c, "cara");
    await room.webSocketClose(a);
    expect(room.state.hostId).toBe("bob");
    expect(room.state.chat.some((m) => /bob is now the host/.test(m.text ?? ""))).toBe(true);
  });

  it("clears when the room empties; next joiner becomes host", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    await room.webSocketClose(a);
    expect(room.state.hostId).toBe(null);
    const b = mockWs();
    await join(room, b, "bob");
    expect(room.state.hostId).toBe("bob");
  });

  it("no reclaim: a returning ex-host stays guest", async () => {
    const { room } = makeRoom();
    const [a, b] = [mockWs(), mockWs()];
    await join(room, a, "alice");
    await join(room, b, "bob");
    await room.webSocketClose(a);
    expect(room.state.hostId).toBe("bob");
    const a2 = mockWs();
    await join(room, a2, "alice"); // reconnect path (existing roster entry)
    expect(room.state.hostId).toBe("bob");
  });

  it("snapshot carries hostId to clients", async () => {
    const { room } = makeRoom();
    await join(room, mockWs(), "alice");
    expect(room.snapshotFor("alice").hostId).toBe("alice");
  });

  it("daily rooms never get a host", async () => {
    const { room } = makeRoom();
    room.state.path = "daily/2026-06-06";
    const a = mockWs();
    await join(room, a, "alice");
    expect(room.state.hostId).toBe(null);
  });

  it("bots never host", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    room.state.players.push({
      username: "botty", connected: true, isBot: true, guesses: [], status: "playing",
      ready: true, role: "duelist", revealHints: 0, vowelHints: 0, points: 0, pointsSpent: 0,
    });
    await room.webSocketClose(a);
    expect(room.state.hostId).toBe(null);
  });
});

describe("challenge rooms pin the word — size is locked", () => {
  it("rejects set_length and set_rows when challengeId is set", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    room.state.challengeId = "abc12";
    const len = room.state.wordLength as number;
    const rows = room.state.maxGuesses as number;
    await room.webSocketMessage(a, JSON.stringify({ type: "set_length", wordLength: len === 5 ? 6 : 5 }));
    await room.webSocketMessage(a, JSON.stringify({ type: "set_rows", rows: rows === 6 ? 7 : 6 }));
    expect(room.state.wordLength).toBe(len);
    expect(room.state.maxGuesses).toBe(rows);
  });

  it("still accepts them in a normal room", async () => {
    const { room } = makeRoom();
    const a = mockWs();
    await join(room, a, "alice");
    await room.webSocketMessage(a, JSON.stringify({ type: "set_rows", rows: 7 }));
    expect(room.state.maxGuesses).toBe(7);
  });
});
