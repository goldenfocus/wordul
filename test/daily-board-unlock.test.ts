// The daily "see everyone's board once you've solved" gate (Plan B). Two invariants that
// together mean today's answer can NEVER be scraped by a non-finisher:
//   1. /leaderboard returns letter rows (`words`) ONLY when the caller presents today's
//      finisher token; otherwise color-only grids (the public, un-scrapable shape).
//   2. The per-day secret never ships raw in a snapshot, and the token reaches a viewer
//      ONLY once they've finished today.
import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

import { Room } from "../src/room.ts";

// Color vocab is hot/warm/cold (a winning row is all-hot → encodes "ggggg").
const greens = ["hot", "hot", "hot", "hot", "hot"];
const grays = ["cold", "cold", "cold", "cold", "cold"];

function makeRoom(extraPlayers: unknown[] = []) {
  const store = new Map<string, unknown>();
  const ctx = {
    storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); } },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    getWebSockets: () => [] as unknown[],
    waitUntil: vi.fn(),
  };
  const env = { USER: { idFromName: (n: string) => n, get: () => ({ fetch: vi.fn() }) } };
  const room = new Room(ctx as never, env as never) as never as {
    state: Record<string, unknown>;
    fetch: (r: Request) => Promise<Response>;
    snapshotFor: (v: string | null) => Record<string, unknown>;
  };
  room.state = {
    path: "daily/2026-06-05", owner: "daily", slug: "2026-06-05", name: "daily",
    phase: "playing", word: "CRANE", winner: "yan", startedAt: 1, finishedAt: null,
    round: 1, chat: [], wordLength: 5, maxGuesses: 6, mode: "daily", scoreboard: [],
    history: [], edition: "default", isDaily: true, story: null, challengeId: null,
    rotation: "koth", queue: [], throne: null,
    finisherSecret: "secret-123",
    players: [
      // a finished solver — their winning row spells the answer (CRANE)
      { username: "yan", status: "won", guesses: [{ word: "SLOTH", mask: grays }, { word: "CRANE", mask: greens }],
        points: 120, pointsSpent: 0, isBot: false, scored: true, goldAwarded: 120, finishedAt: 5, firstGuessAt: 1 },
      // a still-playing viewer — must never get the token
      { username: "bob", status: "playing", guesses: [{ word: "SLOTH", mask: grays }],
        points: 0, pointsSpent: 0, isBot: false },
      ...extraPlayers,
    ],
  };
  return room;
}

async function board(room: ReturnType<typeof makeRoom>, query: string) {
  const res = await room.fetch(new Request(`https://do/leaderboard?${query}`));
  return res.json() as Promise<{ top: Array<{ username: string; grid?: string[]; words?: string[] }> }>;
}

describe("daily leaderboard letter-board gate", () => {
  it("WITHOUT a token: color grids only, never the answer letters", async () => {
    const { top } = await board(makeRoom(), "username=bob&n=3");
    const yan = top.find((e) => e.username === "yan")!;
    expect(yan.grid).toEqual(["xxxxx", "ggggg"]); // colors present
    expect(yan.words).toBeUndefined();             // letters absent → no leak
    expect(JSON.stringify(top)).not.toContain("CRANE");
  });

  it("WRONG token: still letterless", async () => {
    const { top } = await board(makeRoom(), "username=bob&n=3&t=nope");
    expect(top.find((e) => e.username === "yan")!.words).toBeUndefined();
  });

  it("CORRECT token: unlocks real letter rows for everyone", async () => {
    const { top } = await board(makeRoom(), "username=yan&n=3&t=secret-123");
    const yan = top.find((e) => e.username === "yan")!;
    expect(yan.words).toEqual(["SLOTH", "CRANE"]); // letters, parallel to grid
    expect(yan.grid).toEqual(["xxxxx", "ggggg"]);
  });

  it("an absent server secret can never be matched by an empty token", async () => {
    const room = makeRoom();
    room.state.finisherSecret = undefined;
    const { top } = await board(room, "username=bob&n=3&t=");
    expect(top.find((e) => e.username === "yan")!.words).toBeUndefined();
  });
});

describe("finisher secret / token delivery", () => {
  it("the raw secret is NEVER spread into a snapshot", () => {
    const room = makeRoom();
    for (const viewer of ["yan", "bob", null] as const) {
      const snap = room.snapshotFor(viewer);
      expect(snap.finisherSecret).toBeUndefined();
    }
  });

  it("only a FINISHED daily viewer receives their dailyToken", () => {
    const room = makeRoom();
    expect(room.snapshotFor("yan").dailyToken).toBe("secret-123"); // finished → gets the key
    expect(room.snapshotFor("bob").dailyToken).toBeUndefined();     // still playing → none
    expect(room.snapshotFor(null).dailyToken).toBeUndefined();      // anonymous → none
  });
});

async function roster(room: ReturnType<typeof makeRoom>, query: string) {
  const res = await room.fetch(new Request(`https://do/leaderboard?${query}`));
  return res.json() as Promise<{ players: Array<{ username: string; grid?: string[]; words?: string[] }> }>;
}

describe("full roster boards (the golden card's Show-all + replay popups)", () => {
  it("full=1 now carries color grids for every player", async () => {
    const { players } = await roster(makeRoom(), "username=bob&full=1");
    expect(players.find((e) => e.username === "yan")!.grid).toEqual(["xxxxx", "ggggg"]);
  });
  it("full=1 words stay token-gated exactly like the top view", async () => {
    const open = await roster(makeRoom(), "username=yan&full=1&t=secret-123");
    expect(open.players.find((e) => e.username === "yan")!.words).toEqual(["SLOTH", "CRANE"]);
    const closed = await roster(makeRoom(), "username=bob&full=1&t=nope");
    expect(closed.players.find((e) => e.username === "yan")!.words).toBeUndefined();
    expect(JSON.stringify(closed)).not.toContain("CRANE");
  });
});
