// The daily room is a 24h shared space: hundreds of players flow through, and every
// mobile background/foreground flap closed+reopened a WS. Each flap persisted a
// "X left" / "X reconnected" line into the 40-slot chat ring (room.ts pushSystem),
// drowning real chat entirely (screenshot: 18 presence lines, 1 actual message).
// Rule (Yan, Jun 7 2026): NO room persists presence lines (joined/left/reconnected) —
// chat lists only people who actually spoke, plus real game notices. The seat list
// is what shows who's at the table. (Originally daily-only, Jun 5 2026.)

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
    chat: Array<{ kind: string; text?: string }>;
    isDaily?: boolean;
  };
  webSocketClose: (ws: WebSocket) => Promise<void>;
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

function makeRoom({ daily = false } = {}) {
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
  if (daily) {
    room.state.path = "daily/2026-06-05";
    room.state.isDaily = true;
  } else {
    room.state.path = "alice/race";
    room.state.owner = "alice";
  }
  return room;
}

const join = async (room: AnyRoom, ws: WebSocket, username: string) =>
  room.webSocketMessage(ws, JSON.stringify({ type: "hello", username }));

const systemTexts = (room: AnyRoom) =>
  room.state.chat.filter((c) => c.kind === "system").map((c) => c.text);

// Other system lines (e.g. the daily "warming up" notice) are fine; presence is the noise.
const presenceLines = (room: AnyRoom) =>
  systemTexts(room).filter((t) => /\b(joined|left|reconnected)$/.test(t ?? ""));

describe("daily room chat — presence flaps are not persisted", () => {
  it("join → leave → rejoin writes ZERO presence lines in a daily room", async () => {
    const room = makeRoom({ daily: true });
    const ws = mockWs();
    await join(room, ws, "mike");
    await room.webSocketClose(ws);
    const ws2 = mockWs();
    await join(room, ws2, "mike"); // wasOffline → would have been "mike reconnected"
    expect(presenceLines(room)).toEqual([]);
  });

  it("real user chat still lands in a daily room", async () => {
    const room = makeRoom({ daily: true });
    const ws = mockWs();
    await join(room, ws, "mike");
    await room.webSocketMessage(ws, JSON.stringify({ type: "chat", text: "taffy wut?!" }));
    const userLines = room.state.chat.filter((c) => c.kind !== "system");
    expect(userLines.length).toBe(1);
  });
});

describe("race room chat — presence lines are gone here too (chat = people who spoke)", () => {
  it("join / leave / rejoin writes ZERO presence lines in a non-daily room", async () => {
    const room = makeRoom();
    const ws = mockWs();
    await join(room, ws, "alice");
    await room.webSocketClose(ws);
    const ws2 = mockWs();
    await join(room, ws2, "alice");
    expect(presenceLines(room)).toEqual([]);
  });
});
