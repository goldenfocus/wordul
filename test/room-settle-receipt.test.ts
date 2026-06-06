// Race settlement: when the USER-DO mint CONFIRMS (res.ok), the player gets a receipt and
// a follow-up snapshot broadcast carries it. When the mint hangs/fails, NO receipt — the
// client falls back to the plain refreshGold snap (never celebrate an unconfirmed mint).

import { describe, it, expect, vi } from "vitest";

// The Room DO extends DurableObject from the workers runtime; stub it so the module imports
// under the plain-node vitest environment. We only need ctx/env wiring, which Room sets.
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

const flushMicro = () => new Promise((r) => setTimeout(r, 0));

const hotMask = ["hot", "hot", "hot", "hot", "hot"];

// Builds a harness with a configurable USER-DO fetch so both the "confirmed" and
// "hangs forever" cases can reuse identical state setup.
function makeHarness({ userFetch }: { userFetch: (url: string, init?: RequestInit) => Promise<Response> }) {
  const store = new Map<string, unknown>();
  const broadcasts: unknown[] = [];

  // Track snapshots sent to sockets so we can inspect the last one.
  const fakeSocket = {
    send: (msg: string) => broadcasts.push(JSON.parse(msg)),
    // WebSocket-like shape; Room only calls send() on these.
  };

  const ctx = {
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => { store.set(key, value); },
    },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    getWebSockets: () => [fakeSocket] as unknown[],
    waitUntil: (p: Promise<unknown>) => {
      // Actually run the promise (unlike the broadcast test which leaves it pending)
      // so the confirmed-mint path's .then() can fire after flushMicro().
      void p;
    },
  };

  const env = {
    USER: { idFromName: (n: string) => n, get: () => ({ fetch: userFetch }) },
    WORDSTATS: { idFromName: (n: string) => n, get: () => ({ fetch: userFetch }) },
  };

  const room = new Room(ctx as never, env as never);

  // Inject a finished race state with alice winning (points=2150 → 21 gold).
  (room as never as { state: unknown }).state = {
    path: "bob/race",
    owner: "bob",
    slug: "race",
    name: "race",
    phase: "finished",
    players: [
      {
        username: "alice",
        status: "won",
        guesses: [{ word: "CRANE", mask: hotMask }],
        points: 2150,
        pointsSpent: 0,
        isBot: false,
        connected: true,
        ready: false,
        role: "duelist",
      },
    ],
    word: "CRANE",
    winner: "alice",
    startedAt: 1,
    finishedAt: 2,
    round: 1,
    chat: [],
    wordLength: 5,
    maxGuesses: 6,
    mode: "race",
    scoreboard: [],
    history: [],
    edition: "default",
    isDaily: false,
    story: null,
    challengeId: null,
  };

  const lastBroadcastSnapshot = (): { players: unknown[] } | null => {
    for (let i = broadcasts.length - 1; i >= 0; i--) {
      const msg = broadcasts[i] as { type: string; room: { players: unknown[] } };
      if (msg.type === "snapshot") return msg.room;
    }
    return null;
  };

  // Expose alice's in-memory PlayerState directly so we can assert receipt without
  // requiring a broadcast (useful for the "no receipt" / hanging-mint case).
  const aliceState = () => {
    const state = (room as never as { state: { players: Array<{ username: string; receipt?: unknown }> } }).state;
    return state.players.find((p) => p.username === "alice");
  };

  const playRaceToWin = async () => {
    // State is already set to finished (alice won); just trigger finishGame directly.
    await (room as never as { finishGame: () => Promise<void> }).finishGame();
  };

  return { room, ctx, env, broadcasts, lastBroadcastSnapshot, aliceState, playRaceToWin };
}

describe("race settlement: receipt attached only on a confirmed mint", () => {
  it("attaches receipt + re-broadcasts after a confirmed race mint", async () => {
    const ledgerBodies: string[] = [];
    const h = makeHarness({
      userFetch: async (url: string, init?: RequestInit) => {
        if (url.includes("/ledger/append") && init?.body) {
          ledgerBodies.push(init.body as string);
        }
        return new Response("{}", { status: 200 });
      },
    });
    await h.playRaceToWin();
    await flushMicro();
    await flushMicro();

    // The confirmed mint path sets player.receipt then sends a snapshot broadcast.
    const last = h.lastBroadcastSnapshot();
    expect(last).not.toBeNull();
    const alice = (last!.players as Array<{ username: string; receipt?: { payout: number; minted: number } }>)
      .find((p) => p.username === "alice");
    expect(alice).toBeDefined();
    expect(alice!.receipt).toBeDefined();
    // Phase 1: mult=1, no extras → payout === minted
    expect(alice!.receipt!.payout).toBe(alice!.receipt!.minted);

    // Pin the ledger body: parts deltas must sum to the top-level delta.
    expect(ledgerBodies.length).toBeGreaterThan(0);
    const body = JSON.parse(ledgerBodies[0]);
    expect(body.parts.reduce((s: number, p: { delta: number }) => s + p.delta, 0)).toBe(body.delta);
  });

  it("no receipt when the mint never confirms", async () => {
    const h = makeHarness({ userFetch: (_url: string, _init?: RequestInit) => new Promise(() => {}) }); // hangs forever
    await h.playRaceToWin();
    await flushMicro();
    await flushMicro();

    // No re-broadcast fires (mint pending), and the PlayerState has no receipt.
    expect(h.lastBroadcastSnapshot()).toBeNull();
    expect(h.aliceState()!.receipt).toBeUndefined();
  });
});
