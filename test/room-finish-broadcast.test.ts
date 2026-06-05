// Regression: a winning guess must reveal the win to the client IMMEDIATELY — the
// best-effort USER-DO writes (game record append + gold ledger mint) must NOT gate the
// snapshot broadcast. When they did, a slow/cold USER DO froze the board for seconds after
// the player solved (and, on the race/duel path, a re-press surfaced "game not in progress"
// because phase had already flipped to "finished" but no snapshot had been sent yet).
//
// These tests drive the two completion paths (finishGame for race/duel, scorePlayer for
// daily) with a USER-DO fetch that never resolves, and assert the reveal happens anyway.

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

function makeHarness() {
  const storagePuts: Array<{ key: string; value: unknown }> = [];
  const store = new Map<string, unknown>();

  // One controllable USER-DO fetch shared by record-append and ledger-mint. It stays
  // PENDING for the whole test — the whole point is that the reveal must not wait on it.
  let settled = false;
  const pending = new Promise((res) => {
    // captured but intentionally never called during the test
    void res;
  });
  pending.then(() => {
    settled = true;
  });
  const userFetch = vi.fn(() => pending);

  const ctx = {
    storage: {
      get: async (key: string) => store.get(key),
      put: async (key: string, value: unknown) => {
        store.set(key, value);
        storagePuts.push({ key, value });
      },
    },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    getWebSockets: () => [] as unknown[],
    waitUntil: vi.fn((_p: Promise<unknown>) => {}),
  };

  const env = {
    USER: { idFromName: (n: string) => n, get: () => ({ fetch: userFetch }) },
    WORDSTATS: { idFromName: (n: string) => n, get: () => ({ fetch: userFetch }) },
  };

  const room = new Room(ctx as never, env as never);
  return { room, ctx, env, storagePuts, userFetch, isFetchSettled: () => settled };
}

const hotMask = ["hot", "hot", "hot", "hot", "hot"];

describe("win reveal is never gated behind best-effort USER-DO writes", () => {
  it("finishGame (race/duel) completes without waiting on the record/mint write", async () => {
    const h = makeHarness();
    (h.room as never as { state: unknown }).state = {
      path: "yan/duel",
      owner: "yan",
      slug: "duel",
      name: "duel",
      phase: "finished",
      players: [
        {
          username: "yan",
          status: "won",
          guesses: [{ word: "CRANE", mask: hotMask }],
          points: 120,
          pointsSpent: 0,
          isBot: false,
        },
      ],
      word: "CRANE",
      winner: "yan",
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

    let finished = false;
    // Private method — called directly to isolate the completion path.
    (h.room as never as { finishGame: () => Promise<void> }).finishGame().then(() => {
      finished = true;
    });
    await flushMicro();

    // The finish resolves immediately even though the USER-DO write is still in flight,
    // so onGuess's persistAndBroadcast (the win snapshot) lands right after — no freeze.
    expect(finished).toBe(true);
    expect(h.userFetch).toHaveBeenCalled(); // the write WAS scheduled (best-effort)
    expect(h.isFetchSettled()).toBe(false); // ...but the finish did not block on it
  });

  it("scorePlayer (daily) broadcasts the win before awaiting the gold mint", async () => {
    const h = makeHarness();
    (h.room as never as { state: unknown }).state = {
      path: "daily/2026-06-04",
      owner: "daily",
      slug: "2026-06-04",
      name: "daily",
      phase: "playing",
      players: [
        {
          username: "yan",
          status: "won",
          guesses: [{ word: "CRANE", mask: hotMask }],
          points: 50,
          pointsSpent: 0,
          isBot: false,
          scored: false,
        },
      ],
      word: "CRANE",
      winner: "yan",
      startedAt: 1,
      finishedAt: null,
      round: 1,
      chat: [],
      wordLength: 5,
      maxGuesses: 6,
      mode: "daily",
      scoreboard: [],
      history: [],
      edition: "default",
      isDaily: true,
      story: null,
      challengeId: null,
    };

    const player = (h.room as never as { state: { players: unknown[] } }).state.players[0];
    // Do NOT await — the mint stays pending; we only care that the reveal happened first.
    (h.room as never as { scorePlayer: (p: unknown) => Promise<void> }).scorePlayer(player);
    await flushMicro();

    // The board state (won + scoreboard) is persisted/broadcast before the pending mint,
    // so the daily win shows instantly instead of after a multi-second USER-DO stall.
    expect(h.storagePuts.length).toBeGreaterThan(0);
    expect(h.isFetchSettled()).toBe(false);
  });
});
