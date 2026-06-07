// test/room-tape.test.ts — tape upload + serving on the daily Room DO. Invariants:
//   1. Only a FINISHED daily player's own tape is stored; first write wins.
//   2. GET /tape returns events only with the finisher token (the letters gate).
// Harness modeled on test/daily-board-unlock.test.ts.
import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

import { Room } from "../src/room.ts";

const greens = ["hot", "hot", "hot", "hot", "hot"];

function makeRoom() {
  const store = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => { store.set(k, v); },
    },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    getWebSockets: () => [] as unknown[],
    waitUntil: vi.fn(),
  };
  const env = { USER: { idFromName: (n: string) => n, get: () => ({ fetch: vi.fn() }) } };
  const room = new Room(ctx as never, env as never) as never as {
    state: Record<string, unknown>;
    fetch: (r: Request) => Promise<Response>;
    webSocketMessage: (ws: unknown, raw: string) => Promise<void>;
  };
  room.state = {
    path: "daily/2026-06-07", owner: "daily", slug: "2026-06-07", name: "daily",
    phase: "playing", word: "CRANE", winner: "yan", startedAt: 1, finishedAt: null,
    round: 1, chat: [], wordLength: 5, maxGuesses: 6, mode: "daily", scoreboard: [],
    history: [], edition: "default", isDaily: true, story: null, challengeId: null,
    rotation: "koth", queue: [], throne: null,
    finisherSecret: "secret-123",
    players: [
      { username: "yan", status: "won", guesses: [{ word: "CRANE", mask: greens }],
        points: 120, pointsSpent: 0, isBot: false, scored: true, goldAwarded: 120 },
      { username: "bob", status: "playing", guesses: [],
        points: 0, pointsSpent: 0, isBot: false },
    ],
  };
  return { room, store };
}

const wsFor = (username: string) => ({
  deserializeAttachment: () => ({ username }),
  send: vi.fn(),
});

const upload = (room: ReturnType<typeof makeRoom>["room"], who: string, events: unknown) =>
  room.webSocketMessage(wsFor(who) as never, JSON.stringify({ type: "tape", events }));

const EVENTS = [[0, "k", "C"], [80, "k", "R"], [160, "k", "A"], [240, "k", "N"], [320, "k", "E"], [900, "e"]];

describe("tape upload", () => {
  it("stores a finished player's valid tape under tape:<username>", async () => {
    const { room, store } = makeRoom();
    await upload(room, "yan", EVENTS);
    expect(store.get("tape:yan")).toEqual({ events: EVENTS, truncated: false });
  });
  it("rejects a still-playing player (no spoiler tapes mid-game)", async () => {
    const { room, store } = makeRoom();
    await upload(room, "bob", EVENTS);
    expect(store.get("tape:bob")).toBeUndefined();
  });
  it("first write wins — a second upload never overwrites", async () => {
    const { room, store } = makeRoom();
    await upload(room, "yan", EVENTS);
    await upload(room, "yan", [[0, "b"]]);
    expect(store.get("tape:yan")).toEqual({ events: EVENTS, truncated: false });
  });
  it("drops malformed events", async () => {
    const { room, store } = makeRoom();
    await upload(room, "yan", [[0, "zap"]]);
    expect(store.get("tape:yan")).toBeUndefined();
  });
});

describe("GET /tape", () => {
  it("returns the tape only with the finisher token", async () => {
    const { room } = makeRoom();
    await upload(room, "yan", EVENTS);
    const okRes = await room.fetch(new Request("https://do/tape?u=yan&t=secret-123"));
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ events: EVENTS, truncated: false });
    const noTok = await room.fetch(new Request("https://do/tape?u=yan"));
    expect(noTok.status).toBe(403);
    const badTok = await room.fetch(new Request("https://do/tape?u=yan&t=wrong"));
    expect(badTok.status).toBe(403);
  });
  it("404s when the player has no tape", async () => {
    const { room } = makeRoom();
    const res = await room.fetch(new Request("https://do/tape?u=bob&t=secret-123"));
    expect(res.status).toBe(404);
  });
});
