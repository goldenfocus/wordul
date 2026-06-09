// Daily settlement receipt: scorePlayer builds a real ÷9 receipt and attaches it only
// after the USER-DO ledger write confirms — the same honest-mint contract as races
// (test/room-settle-receipt.test.ts). The receipt drives the client's supernova ritual.
import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

import { Room } from "../src/room.ts";
import { DAILY_GOLD_RATE, speedBonusPoints, goldFromPoints } from "../src/economy.ts";

const greens = ["hot", "hot", "hot", "hot", "hot"];
const grays = ["cold", "cold", "cold", "cold", "cold"];

type AnyPlayer = Record<string, unknown>;

// Daily gold mints ONLY for TODAY's date — past dailies are practice (no mint). These
// mint-contract tests therefore run on today's date; the past-date case is asserted below.
const TODAY = new Date().toISOString().slice(0, 10);

function makeRoom(player: AnyPlayer, { mintOk = true, date = TODAY } = {}) {
  const store = new Map<string, unknown>();
  const ledgerBodies: Array<Record<string, unknown>> = [];
  const userFetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/ledger/append")) {
      ledgerBodies.push(JSON.parse(String(init?.body)));
      return new Response(mintOk ? "ok" : "boom", { status: mintOk ? 200 : 500 });
    }
    return new Response("ok", { status: 200 }); // record append
  });
  const ctx = {
    storage: { get: async (k: string) => store.get(k), put: async (k: string, v: unknown) => { store.set(k, v); } },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    getWebSockets: () => [] as unknown[],
    waitUntil: vi.fn(),
  };
  const env = {
    USER: { idFromName: (n: string) => n, get: () => ({ fetch: userFetch }) },
    WORDSTATS: { idFromName: (n: string) => n, get: () => ({ fetch: userFetch }) },
  };
  const room = new Room(ctx as never, env as never) as never as {
    state: Record<string, unknown>;
    scorePlayer: (p: AnyPlayer) => Promise<void>;
  };
  room.state = {
    path: `daily/${date}`, owner: "daily", slug: date, name: "daily",
    phase: "playing", word: "PENNE", winner: null, startedAt: 1, finishedAt: null,
    round: 1, chat: [], wordLength: 5, maxGuesses: 6, mode: "daily", scoreboard: [],
    history: [], edition: "default", isDaily: true, story: null, challengeId: null,
    rotation: "koth", queue: [], throne: null,
    players: [player],
  };
  return { room, ledgerBodies };
}

const solver = (over: AnyPlayer = {}): AnyPlayer => ({
  username: "yan", status: "won", points: 2300, pointsSpent: 0, isBot: false,
  scored: false, resigned: false, firstGuessAt: 1000, finishedAt: 31000, // 30s solve
  guesses: [{ word: "GONGS", mask: grays }, { word: "PENNE", mask: greens }],
  ...over,
});

describe("daily settlement receipt (÷9, honest-mint contract)", () => {
  it("confirmed mint → ÷9 receipt attached; parts sum to the payout", async () => {
    const p = solver();
    const { room, ledgerBodies } = makeRoom(p);
    await room.scorePlayer(p);
    const speedGold = goldFromPoints(speedBonusPoints(30000), DAILY_GOLD_RATE);
    const receipt = p.receipt as { minted: number; bonus: number; payout: number };
    expect(receipt).toBeDefined();
    expect(receipt.minted).toBe(256);                       // 2300/9 → 256
    expect(receipt.bonus).toBe(100 + speedGold);            // flat goody + ÷9 speed
    expect(receipt.payout).toBe(256 + 100 + speedGold);
    expect(p.goldAwarded).toBe(receipt.payout);
    expect(p.scored).toBe(true);
    // The ledger legs carry the same split and sum exactly to the mint.
    const parts = ledgerBodies[0].parts as Array<{ label: string; delta: number }>;
    expect(parts.map((x) => x.label)).toEqual(["score", "daily", "speed"]);
    expect(parts.reduce((s, x) => s + x.delta, 0)).toBe(receipt.payout);
    expect(ledgerBodies[0].delta).toBe(receipt.payout);
  });

  it("failed mint → NO receipt, NOT scored (retry-able), no goldAwarded", async () => {
    const p = solver();
    const { room } = makeRoom(p, { mintOk: false });
    await room.scorePlayer(p);
    expect(p.receipt).toBeUndefined();
    expect(p.scored).toBe(false);
    expect(p.goldAwarded).toBeUndefined();
  });

  it("resigner → 0 gold, no receipt, no ledger write", async () => {
    const p = solver({ status: "lost", resigned: true, points: 0 });
    const { room, ledgerBodies } = makeRoom(p);
    await room.scorePlayer(p);
    expect(p.goldAwarded).toBe(0);
    expect(p.receipt).toBeUndefined();
    expect(ledgerBodies.length).toBe(0);
  });

  it("bot → computed gold for ranking, no receipt, no ledger write", async () => {
    const p = solver({ username: "botanist", isBot: true });
    const { room, ledgerBodies } = makeRoom(p);
    await room.scorePlayer(p);
    expect(typeof p.goldAwarded).toBe("number");
    expect(p.receipt).toBeUndefined();
    expect(ledgerBodies.length).toBe(0);
  });

  it("a loser who ran out (not resigned) still mints and gets the ritual receipt", async () => {
    const p = solver({ status: "lost", resigned: false, points: 450 });
    const { room } = makeRoom(p);
    await room.scorePlayer(p);
    const receipt = p.receipt as { minted: number };
    expect(receipt.minted).toBe(50); // 450/9
    expect(p.goldAwarded).toBeGreaterThan(0);
  });

  // Anti gold-farm: a PAST daily reveals its answer (home carousel + archive), so a win is
  // free — it must mint NOTHING. The player is still marked scored (no retry storm) and the
  // record/leaderboard above still save; only the gold ledger write is skipped.
  it("past daily → 0 gold, no receipt, no ledger write (practice only)", async () => {
    const p = solver();
    const { room, ledgerBodies } = makeRoom(p, { date: "2020-01-01" });
    await room.scorePlayer(p);
    expect(p.goldAwarded).toBe(0);
    expect(p.receipt).toBeUndefined();
    expect(p.scored).toBe(true);
    expect(ledgerBodies.length).toBe(0);
  });
});
