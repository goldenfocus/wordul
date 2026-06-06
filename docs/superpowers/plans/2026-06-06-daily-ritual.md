# Daily Finish Ritual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finishing the daily mints at points÷9 and fires the Duel/Arena supernova settlement, and the golden "AND THE WORD IS" card gains a top-3+you leaderboard expandable to the full roster, where tapping any row pops up that player's auto-playing replay.

**Architecture:** The daily Room DO builds a real `SettlementReceipt` (race parity) attached only after the confirmed mint; the client's existing `cashOutDaily` arm/fire path runs `renderSettlement` off it instead of the coin rain. The leaderboard reuses the existing `/api/daily/<date>/leaderboard` endpoint (top-3 + `full=1`, finisher-token gate intact) rendered by a new small `public/daily-lb.js` module that reuses `daily-card.js` row/stamp renderers and the `stamp-replay.js` engine.

**Tech Stack:** Cloudflare Workers + Durable Objects (TypeScript, `src/`), vanilla ES modules (`public/`), vitest (`test/`, node + jsdom).

**Spec:** `docs/superpowers/specs/2026-06-06-daily-ritual-design.md`

**Spec deviation (mechanism, not behavior):** the spec says "remove the `game.isDaily` guard in `maybeRunSettlement`". In reality daily rooms never flip `phase === "finished"` (per-player async scoring), so that call site can never fire for a daily. The settlement instead runs inside `cashOutDaily` — the existing arm-on-transition / fire-on-confirmed-mint path — which is what makes it reliable (the exact bug the user hit). The `maybeRunSettlement` guard stays as dead-safe belt-and-braces.

**Working directory:** `/Users/zang/wordul/.claude/worktrees/daily-ritual` (branch `daily-ritual`). All commands run from there.

---

## File structure

| File | Responsibility |
|---|---|
| `src/economy.ts` | Pure economy math: `goldFromPoints` + `settle()` gain a `rate` divisor; new `DAILY_GOLD_RATE = 9`. |
| `src/room.ts` | `scorePlayer()` builds the daily receipt, attaches after confirmed mint; `/leaderboard?full=1` gains grids + token-gated words. |
| `public/settle.js` | New pure `dailyReceiptLines()`; supernova honors `opts.lines` + `opts.bonusCaption`. |
| `public/app.js` | `cashOutDaily` runs the supernova off `me.receipt` (coin-rain only as legacy fallback); ÷9 mirror; mounts the leaderboard in `renderDailyUnlock`. |
| `public/daily-card.js` | Exports `renderLeaderboard`, `medalGlyph` (already exports `renderStamp`, `boardRows`, `goldValue`, `fmtDuration`). |
| `public/daily-lb.js` | **New.** Golden-card leaderboard: top-3+you, Show-all roster w/ scroll, replay modal. No app.js imports (hooks in via opts, like settle.js/gold.js). |
| `public/index.html` | `#dailyLeaderboard` mount inside `#dailyUnlock`. |
| `public/style.css` | `.daily-lb*` + modal styles. |
| `public/locales/en.js` | New `settle.*` + `daily.lb*` keys. |
| `vitest.config.ts` | Alias for `/daily-lb.js`. |
| `test/economy.test.ts` | ÷9 daily formula updates. |
| `test/daily-settle-receipt.test.ts` | **New.** scorePlayer receipt contract. |
| `test/daily-board-unlock.test.ts` | full=1 grid/words gate. |
| `test/settle-lines.test.js` | `dailyReceiptLines`. |
| `test/daily-lb.test.js` | **New.** jsdom: render, expand, modal replay. |

---

### Task 1: economy.ts — rate-aware mint

**Files:**
- Modify: `src/economy.ts:160-186`
- Test: `test/economy.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe("goldFromPoints")` block and add a new describe after it in `test/economy.test.ts` (import `DAILY_GOLD_RATE` and `settle` at top — `settle` may already be imported; check the import line):

```ts
// inside describe("goldFromPoints"):
  it("honors a custom rate divisor (daily mints at ÷9)", () => {
    expect(goldFromPoints(2300, DAILY_GOLD_RATE)).toBe(256); // 2300/9 = 255.55… → 256
    expect(goldFromPoints(3500)).toBe(35);                   // default 100 unchanged
    expect(goldFromPoints(-100, DAILY_GOLD_RATE)).toBe(0);   // never negative at any rate
  });

// new top-level describe:
describe("settle with a rate divisor", () => {
  it("mints at the given rate; default callers unchanged", () => {
    const daily = settle({ buyIn: 0, points: 2300, mult: 1, spends: 0, bonus: 145, rate: DAILY_GOLD_RATE });
    expect(daily.minted).toBe(256);
    expect(daily.payout).toBe(256 + 145);
    const race = settle({ buyIn: 0, points: 2300, mult: 1, spends: 0, bonus: 0 });
    expect(race.minted).toBe(23); // ÷100 default — races untouched
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/economy.test.ts`
Expected: FAIL — `DAILY_GOLD_RATE` not exported / rate ignored.

- [ ] **Step 3: Implement** in `src/economy.ts`:

```ts
// Cash-out conversion. Tunable. Never mints negative gold from a single bad game.
// rate is the points-per-gold divisor: races stay at the classic 100; the daily mints
// at the generous DAILY_GOLD_RATE so combo play visibly pays (user decision, Jun 6 2026).
export const DAILY_GOLD_RATE = 9;
export function goldFromPoints(points: number, rate = 100): number {
  return Math.max(0, Math.round(points / rate));
}
```

Add `rate?: number;` to `SettlementInput` and change the first line of `settle()`:

```ts
  const minted = goldFromPoints(i.points, i.rate ?? 100);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/economy.test.ts`
Expected: the two new tests PASS. The existing `daily mint formula` describe still passes (it uses default-rate `goldFromPoints` and is updated in Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/economy.ts test/economy.test.ts
git commit -m "feat(economy): rate-aware goldFromPoints/settle + DAILY_GOLD_RATE=9"
```

---

### Task 2: room.ts — daily receipt at ÷9, attached after the confirmed mint

**Files:**
- Modify: `src/room.ts:1815-1876` (scorePlayer mint block), `src/room.ts:13` (import)
- Modify: `test/economy.test.ts:149-208` (daily-formula mirror tests)
- Create: `test/daily-settle-receipt.test.ts`

- [ ] **Step 1: Update the mirror tests** in `test/economy.test.ts` — the `describe("daily mint formula (spec §B + §C)")` block. Replace its two helper definitions and the two assertions that hardcode ÷100 numbers:

```ts
  const DAILY_GOLD_BONUS = 100; // mirror of room.ts constant
  const mint = (points: number, elapsedMs: number | null) =>
    goldFromPoints(points, DAILY_GOLD_RATE) + DAILY_GOLD_BONUS +
    (elapsedMs == null ? 0 : goldFromPoints(speedBonusPoints(elapsedMs), DAILY_GOLD_RATE));
```

and in the assertions: `mint(3500, 0)` is now `389 + 100 + 56` (3500/9=388.9→389; speedBonus 500/9=55.6→56); `mint(3500, SPEED_WINDOW_MS)` → `389 + 100 + 0`; `mint(3500, null)` → `389 + 100`; the half-window expectation becomes `expect(goldFromPoints(speedBonusPoints(90000), DAILY_GOLD_RATE)).toBe(28); // 250/9 → 27.8 → 28`. In `clientBreakdown`, change `Math.round(points / 100)` → `Math.round(points / DAILY_GOLD_RATE)` and the honesty assertions `expect(scoreGold).toBe(goldFromPoints(points, DAILY_GOLD_RATE))` / `expect(speedGold).toBe(goldFromPoints(speedBonusPoints(elapsedMs), DAILY_GOLD_RATE))`.

- [ ] **Step 2: Write the new failing receipt test** — `test/daily-settle-receipt.test.ts`. Daily mint: receipt attached ONLY after a confirmed (res.ok) ledger write; resigners and bots never get one. Uses the same harness style as `test/daily-board-unlock.test.ts` (inject state, call the private method):

```ts
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

function makeRoom(player: AnyPlayer, { mintOk = true } = {}) {
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
    path: "daily/2026-06-06", owner: "daily", slug: "2026-06-06", name: "daily",
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
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/daily-settle-receipt.test.ts test/economy.test.ts`
Expected: economy mirror tests FAIL on the old ÷100 numbers until you applied Step 1's edits (they should PASS after Step 1 since Task 1 shipped `DAILY_GOLD_RATE`); `daily-settle-receipt` FAILS — `p.receipt` undefined, parts/minted at ÷100.

- [ ] **Step 4: Implement** in `src/room.ts`. Add `DAILY_GOLD_RATE` to the economy import (line 13). Then in `scorePlayer` replace the gold computation block (currently lines 1820-1833):

```ts
    const endMs = player.finishedAt ?? Date.now();
    const elapsedMs = player.firstGuessAt != null ? Math.max(0, endMs - player.firstGuessAt) : null;
    // The daily mints at the generous ÷9 rate (score AND speed legs) so combo play visibly
    // pays — the flat goody stays 100. Built as a REAL SettlementReceipt (race parity): the
    // same receipt that drives the supernova ritual client-side.
    const timeBonusGold = elapsedMs == null ? 0 : goldFromPoints(speedBonusPoints(elapsedMs), DAILY_GOLD_RATE);
    const receipt = settle({
      buyIn: 0, points: player.points, mult: 1, spends: 0,
      bonus: DAILY_GOLD_BONUS + timeBonusGold, rate: DAILY_GOLD_RATE,
    });
    const scoreGold = receipt.minted;
    const gold = player.resigned ? 0 : receipt.payout;
    // Granular breakdown for the gold history — the three components above, zero legs
    // dropped (Σ parts === gold by construction). Race cash-out stays single-total.
    const parts = [
      { label: "score", delta: scoreGold },
      { label: "daily", delta: DAILY_GOLD_BONUS },
      { label: "speed", delta: timeBonusGold },
    ].filter((p) => p.delta > 0);
```

(`settle` and `speedBonusPoints` are already imported on line 13; add `DAILY_GOLD_RATE`.)

Then in the confirmed-mint branch (`if (res.ok) { ... }`, currently lines 1867-1870), attach the receipt:

```ts
      if (res.ok) {
        player.scored = true;
        player.goldAwarded = gold;
        // The ritual key: receipt rides the post-mint snapshot (onGuess broadcasts after
        // scorePlayer returns), ephemeral exactly like the race receipt (no storage.put).
        player.receipt = receipt;
      } else {
```

No other broadcast change needed — `onGuess` broadcasts after `maybeFinish`/`scorePlayer` complete, so `goldAwarded` and `receipt` ride the same snapshot, and the daily snapshot projects only the viewer's own player (`snapshotFor`, room.ts:2077-2078), so nobody else ever sees your receipt.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run test/daily-settle-receipt.test.ts test/economy.test.ts test/room-settle-receipt.test.ts test/daily-board-unlock.test.ts`
Expected: all PASS (race receipt + token gate untouched).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` — expected clean (PlayerState already has `receipt?: SettlementReceipt`, src/types.ts:62).

```bash
git add src/room.ts test/daily-settle-receipt.test.ts test/economy.test.ts
git commit -m "feat(daily): mint at ÷9 via a real settlement receipt, attached only after the confirmed mint"
```

---

### Task 3: full=1 leaderboard carries grids (+ token-gated words)

**Files:**
- Modify: `src/room.ts:219-253` (leaderboard handler)
- Test: `test/daily-board-unlock.test.ts`

- [ ] **Step 1: Write the failing tests** — append a describe to `test/daily-board-unlock.test.ts` (the `board` helper only types `top`; add a sibling helper):

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/daily-board-unlock.test.ts`
Expected: FAIL — full view is lean (no `grid`).

- [ ] **Step 3: Implement** — in the room.ts handler, hoist the token gate above the `if (full)` branch and give both branches the same enriched mapping:

```ts
      // Proof-of-finish gate: a caller who presents today's finisher token (handed only to
      // a player who completed the daily) unlocks the REAL letter rows for every board — at
      // that point the answer isn't a secret to them anyway. Anyone else gets color-only
      // grids, so the public endpoint can never leak today's word.
      const t = url.searchParams.get("t") ?? "";
      const unlock = !!this.state.finisherSecret && t === this.state.finisherSecret;
      const players = this.state.players.map((p) => ({
        ...toRankable(p),
        grid: encodeSolveGrid(p.guesses),
        words: unlock ? encodeSolveWords(p.guesses) : undefined,
      }));
      if (full) {
        return Response.json({ ...fullDaily(players, username), lane: laneSig(this.state.ruleset ?? initialRuleset(!!this.state.isDaily, this.state.mode)) });
      }
      const n = Number(url.searchParams.get("n") ?? "3");
      return Response.json({ ...topDaily(players, username, n), lane: laneSig(this.state.ruleset ?? initialRuleset(!!this.state.isDaily, this.state.mode)) });
```

(Delete the now-duplicated `t`/`unlock`/`players` lines from the old top-N branch and the stale "full roster stays lean" comment on `toRankable`.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/daily-board-unlock.test.ts test/leaderboard-core.test.ts test/daily-stats.test.js`
Expected: PASS (leaderboard-core already passes grid/words through; the stats page just gains unused fields).

- [ ] **Step 5: Commit**

```bash
git add src/room.ts test/daily-board-unlock.test.ts
git commit -m "feat(daily): full leaderboard view carries grids, words stay finisher-token-gated"
```

---

### Task 4: settle.js — daily receipt lines + line/caption overrides

**Files:**
- Modify: `public/settle.js`
- Test: `test/settle-lines.test.js`

- [ ] **Step 1: Write the failing tests** — append to `test/settle-lines.test.js`:

```js
import { dailyReceiptLines } from "../public/settle.js";

describe("dailyReceiptLines", () => {
  // Daily receipt: minted = ÷9 score gold; bonus = flat daily goody + ÷9 speed gold.
  const daily = receipt({ points: 2300, minted: 256, earned: 256, bonus: 156, payout: 412, net: 412 });
  it("splits the bonus into honest daily + speed legs", () => {
    const lines = dailyReceiptLines(daily, 100);
    expect(lines).toEqual([
      { key: "mint", text: "2,300 pts → ◆ 256", tone: "gain" },
      { key: "daily", text: "daily bonus + ◆ 100", tone: "gain" },
      { key: "speed", text: "speed + ◆ 56", tone: "gain" },
      { key: "payout", text: "◆ 412 to your wallet · net +412", tone: "gain" },
    ]);
  });
  it("drops a zero speed leg", () => {
    const lines = dailyReceiptLines(receipt({ minted: 256, bonus: 100, payout: 356, net: 356, points: 2300 }), 100);
    expect(lines.map((l) => l.key)).toEqual(["mint", "daily", "payout"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/settle-lines.test.js`
Expected: FAIL — `dailyReceiptLines` is not exported.

- [ ] **Step 3: Implement** in `public/settle.js`. After `receiptLines`, add:

```js
// Daily flavor of receiptLines: the receipt's single `bonus` leg is really the flat daily
// goody + the ÷9 speed gold (room.ts scorePlayer). Split it back into the two honest lines
// the old cash-out list showed — dailyBonus is the client's mirror constant, speed is the
// exact remainder. Pure, like receiptLines (settle-lines.test.js).
export function dailyReceiptLines(r, dailyBonus, tFn = (_key, fallback) => fallback) {
  const fmt = (n) => n.toLocaleString("en-US");
  const lines = [
    { key: "mint", text: `${fmt(r.points)} pts → ◆ ${fmt(r.minted)}`, tone: "gain" },
  ];
  const speed = Math.max(0, r.bonus - dailyBonus);
  if (dailyBonus > 0) lines.push({ key: "daily", text: `${tFn("settle.dailyBonus", "daily bonus")} + ◆ ${fmt(dailyBonus)}`, tone: "gain" });
  if (speed > 0) lines.push({ key: "speed", text: `${tFn("settle.speedBonus", "speed")} + ◆ ${fmt(speed)}`, tone: "gain" });
  const netSign = r.net >= 0 ? "+" : "−";
  lines.push({
    key: "payout",
    text: `◆ ${fmt(r.payout)} ${tFn("settle.toWallet", "to your wallet")} · ${tFn("settle.net", "net")} ${netSign}${fmt(Math.abs(r.net))}`,
    tone: r.net >= 0 ? "gain" : "loss",
  });
  return lines;
}
```

In `supernova()`, two one-line overrides:
- line 94: `const lines = Array.isArray(opts.lines) ? opts.lines : receiptLines(receipt, tFn);`
- Beat 4 caption (line ~522): `{ text: `${opts.bonusCaption || tFn("settle.caption.winBonus", "win bonus")} ` },`

Update the opts contract comment at the top of the file and above `renderSettlement`: `{ renderer?, reducedMotion, walletBefore, onWalletTick(value), playChime, lines?, bonusCaption? }`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/settle-lines.test.js`
Expected: PASS (old receiptLines tests untouched).

- [ ] **Step 5: Commit**

```bash
git add public/settle.js test/settle-lines.test.js
git commit -m "feat(settle): dailyReceiptLines + lines/bonusCaption opts for the daily ritual"
```

---

### Task 5: app.js — the daily supernova (cashOutDaily) + ÷9 mirror

**Files:**
- Modify: `public/app.js:33` (import), `public/app.js:2592-2620` (cashOutDaily)
- Modify: `public/locales/en.js` (settle caption keys)

No good unit seam exists for `cashOutDaily` (app.js is not import-safe in tests); the honest-breakdown math it mirrors is already covered by `test/economy.test.ts` (Task 2's `clientBreakdown` at ÷9), and the receipt contract by Task 2's server test. This task is wiring; verification is the full suite + manual smoke in Task 8.

- [ ] **Step 1: Update the import** (app.js line 33):

```js
import { renderSettlement, dailyReceiptLines } from "/settle.js";
```

- [ ] **Step 2: Rewrite the mint constants + cashOutDaily** (current lines 2592-2620). Keep `renderCashoutBreakdown` as-is.

```js
const DAILY_GOLD_BONUS = 100; // mirrors src/room.ts DAILY_GOLD_BONUS
const DAILY_GOLD_RATE = 9;    // mirrors src/economy.ts DAILY_GOLD_RATE (daily mints at ÷9)
function cashOutDaily(me) {
  if (game.cashedOut) return;
  game.cashedOut = true;
  const mint = (me && typeof me.goldAwarded === "number") ? Math.max(0, me.goldAwarded) : 0;
  // Honest breakdown components (sum === mint).
  const scoreGold = Math.max(0, Math.round((me?.points || 0) / DAILY_GOLD_RATE));
  const dailyBonus = mint > 0 ? DAILY_GOLD_BONUS : 0;
  const speedGold = Math.max(0, mint - scoreGold - dailyBonus);
  renderCashoutBreakdown({ scoreGold, dailyBonus, speedGold });
  const reducedMotion = getSettings().reducedMotion;
  // Reconcile from the server (source of truth), then run the ritual. The receipt
  // (server-confirmed, attached only after the mint ledger write) drives the same
  // supernova settlement Duel/Arena get — daily-flavored lines. No receipt (old
  // server / mint raced the snapshot)? The legacy coin-rain still fires, so the
  // moment is never silent. ONLY-UP either way: pin HUD to (balance − mint) first.
  const name = getUsername();
  if (!name) { refreshGold(); return; }
  fetch(`/api/user/${encodeURIComponent(name)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => {
      const balance = p && typeof p.gold === "number" ? p.gold : null;
      if (balance == null) { refreshGold(); return; }
      if (mint <= 0) { setGold(balance); renderGoldHud(); return; }
      const pre = Math.max(0, balance - mint);
      if (me.receipt) {
        setGold(pre); renderGoldHud();
        renderSettlement(me.receipt, {
          reducedMotion, // supernova handles reduced motion with its static lines path
          walletBefore: pre,
          onWalletTick: (v) => { setGold(v); renderGoldHud(); },
          playChime,
          lines: dailyReceiptLines(me.receipt, dailyBonus, t),
          bonusCaption: t("settle.caption.dailyBonus"),
        });
        return;
      }
      if (reducedMotion) { setGold(balance); renderGoldHud(); return; }
      setGold(pre); renderGoldHud();
      awardGold(mint, false); // legacy fallback: tween (balance − mint) → balance, coins fly
    })
    .catch(() => refreshGold());
}
```

- [ ] **Step 3: Add the caption/line keys** to `public/locales/en.js` next to the existing `settle.*` keys (search for `"settle.`; if none exist yet — the supernova passes English fallbacks — add a small block near the `daily.*` keys):

```js
  "settle.dailyBonus": "daily bonus",
  "settle.speedBonus": "speed",
  "settle.caption.dailyBonus": "daily goody + speed",
```

- [ ] **Step 4: Run the suite for regressions**

Run: `npx vitest run`
Expected: PASS (no app.js unit tests exist; gold-payout/celebrate/i18n suites must stay green).

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/locales/en.js
git commit -m "feat(daily): supernova settlement ritual on the confirmed daily mint (coin-rain kept as fallback)"
```

---

### Task 6: daily-lb.js — the golden card's leaderboard (top-3+you, Show-all w/ scroll)

**Files:**
- Modify: `public/daily-card.js:42,127` (export `medalGlyph`, `renderLeaderboard`)
- Create: `public/daily-lb.js`
- Modify: `public/index.html:281` (mount), `public/style.css` (styles), `public/locales/en.js` (keys), `vitest.config.ts` (alias), `public/app.js` (renderDailyUnlock wiring)
- Test: `test/daily-lb.test.js`

- [ ] **Step 1: Export the shared renderers** — in `public/daily-card.js` change `function medalGlyph(rank)` → `export function medalGlyph(rank)` and `function renderLeaderboard(view, me)` → `export function renderLeaderboard(view, me)`.

- [ ] **Step 2: Add the vitest alias** in `vitest.config.ts`, next to the `/daily-card.js` entry:

```ts
      { find: /^\/daily-lb\.js$/, replacement: new URL("./public/daily-lb.js", import.meta.url).pathname },
```

- [ ] **Step 3: Write the failing tests** — `test/daily-lb.test.js`:

```js
// @vitest-environment jsdom
// The golden card's leaderboard: top-3+you medals, Show-all roster (scroll past 25),
// and tap-a-row → modal replay (Task 7's describe lives here too).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountDailyLeaderboard } from "../public/daily-lb.js";

const entry = (username, gold, over = {}) => ({
  username, gold, guesses: 3, won: true, grid: ["xxxxx", "ggggg"], words: ["SLOTH", "PENNE"], ...over,
});
const topView = {
  top: [entry("ada", 400), entry("bob", 300), entry("cyd", 200)],
  you: { ...entry("yan", 150), rank: 7 },
  total: 40,
};
const fullView = {
  players: Array.from({ length: 40 }, (_, i) => ({ ...entry(`p${i}`, 400 - i), rank: i + 1 })),
  youRank: 7, total: 40,
};

function mockFetch() {
  return vi.fn(async (url) => ({
    ok: true,
    json: async () => (String(url).includes("full=1") ? fullView : topView),
  }));
}

beforeEach(() => {
  document.body.innerHTML = `<div id="dailyLeaderboard" hidden></div>`;
  localStorage.setItem("wr.dailyToken:2026-06-06", "tok-1");
  globalThis.fetch = mockFetch();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("mountDailyLeaderboard", () => {
  it("renders top-3 medals + pinned you, with a Show-all footer", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    expect(mount.hidden).toBe(false);
    expect(mount.querySelectorAll(".daily-top-row").length).toBe(4); // 3 medals + pinned you
    expect(mount.querySelector(".daily-top-row.is-pinned .daily-top-rank").textContent).toBe("#7");
    expect(mount.querySelector("#dailyLbShowAll").textContent).toContain("40");
    // The finisher token rides the request — letters unlock server-side.
    expect(String(globalThis.fetch.mock.calls[0][0])).toContain("t=tok-1");
  });

  it("is idempotent per mount (renderDailyUnlock runs per snapshot)", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    expect(globalThis.fetch.mock.calls.length).toBe(1);
  });

  it("Show-all expands to the full roster with the scroll class past 25 rows", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    mount.querySelector("#dailyLbShowAll").click();
    await flush();
    expect(String(globalThis.fetch.mock.calls[1][0])).toContain("full=1");
    const roster = mount.querySelector(".daily-lb-roster");
    expect(roster.querySelectorAll(".daily-top-row").length).toBe(40);
    expect(roster.classList.contains("is-scroll")).toBe(true); // >25 rows → internal scroll
    expect(mount.querySelector("#dailyLbShowAll")).toBeNull(); // footer consumed
  });

  it("a failed fetch leaves the mount hidden (recap still renders without it)", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false }));
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    expect(mount.hidden).toBe(true);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run test/daily-lb.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Implement `public/daily-lb.js`:**

```js
// public/daily-lb.js — the golden card's "today's winners" board. Lives inside
// #dailyUnlock (the post-finish reveal), so every caller has ALREADY finished —
// the finisher token unlocks real letters; the server still enforces the gate.
// Three beats: top-3 medals + you (reuses the home card's renderer) → "Show all
// (N)" swaps in the full roster (internal scroll past SCROLL_AT rows) → tapping
// any row pops the player's auto-playing replay (replay-modal, Task 7).
// Decoupling: NEVER imports app.js — i18n comes in via opts.t (settle.js pattern).
import { renderLeaderboard, renderStamp, boardRows, goldValue, medalGlyph } from "/daily-card.js";
import { GLYPH } from "/hub-glyphs.js";
import { playStampReplay } from "/stamp-replay.js";

const SCROLL_AT = 25; // past this many rows the roster scrolls inside the card
function escAttr(s) { return String(s).replace(/[^a-z0-9_-]/gi, ""); } // usernames are [a-z0-9_-]

// One full-roster row — same vocabulary as the home card's medal rows (medals for the
// podium, plain #N beyond), so the expanded list reads as "more of the same board".
function rosterRow(e, me) {
  const u = escAttr(e.username);
  const mine = u === escAttr(me);
  const result = e.won
    ? `in ${e.guesses}`
    : e.resigned
      ? `<span class="daily-top-mark is-quit" role="img" aria-label="gave up" title="gave up">${GLYPH.skull}</span>`
      : `<span class="daily-top-mark is-out" role="img" aria-label="ran out of guesses" title="ran out of guesses">${GLYPH.cross}</span>`;
  return `<li class="daily-top-row${mine ? " is-you" : ""}" data-user="${u}">
    <span class="daily-top-rank" aria-hidden="true">${e.rank <= 3 ? medalGlyph(e.rank) : `#${e.rank}`}</span>
    <a class="daily-top-name" href="/@${u}" data-profile="${u}">${mine ? `you (@${u})` : `@${u}`}</a>
    <span class="daily-top-gold">${goldValue(e.gold)}</span>
    <span class="daily-top-guesses">${result}</span>
  </li>`;
}

// Tap a row → that player's board pops up and replays itself. The stamp is built from
// the row's leaderboard entry (grid always; words only when the server unlocked them
// for this finisher). Scrim tap / ✕ / Esc dismiss; focus returns to the opener row.
function openReplayModal(entry, opener) {
  document.getElementById("dailyLbModal")?.remove();
  const u = escAttr(entry.username);
  const cols = Array.isArray(entry.grid) && entry.grid[0] ? String(entry.grid[0]).length : 5;
  const overlay = document.createElement("div");
  overlay.id = "dailyLbModal";
  overlay.className = "daily-lb-modal";
  overlay.innerHTML = `<div class="daily-lb-modal-card" role="dialog" aria-modal="true" aria-label="@${u} board replay">
    <div class="daily-lb-modal-head">
      <a class="daily-top-name" href="/@${u}" data-profile="${u}">@${u}</a>
      <span class="daily-top-gold">${goldValue(entry.gold)}</span>
      <button type="button" class="daily-lb-modal-close" aria-label="Close">✕</button>
    </div>
    ${renderStamp(entry.grid, entry.words, boardRows(cols))}
  </div>`;
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    opener?.focus?.();
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest(".daily-lb-modal-close")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  const stamp = overlay.querySelector(".daily-stamp");
  if (stamp) playStampReplay(stamp); // auto-play on open; tap snaps to final (existing engine)
  return overlay;
}

// Mount once per finished daily (idempotent — renderDailyUnlock runs on every snapshot).
// opts: { mount, date, username, t? } — t is the i18n fn (identity fallback keeps tests hermetic).
export function mountDailyLeaderboard({ mount, date, username, t = (_k, f) => f }) {
  if (!mount || mount.dataset.wired) return;
  mount.dataset.wired = "1";
  const token = localStorage.getItem(`wr.dailyToken:${date}`) || "";
  const tq = token ? `&t=${encodeURIComponent(token)}` : "";
  const api = (extra) => `/api/daily/${date}/leaderboard?username=${encodeURIComponent(username)}${extra}${tq}`;
  // Row index by escaped username → entry, so a tap can open the right board.
  const entries = new Map();
  const wireRows = (root) => {
    root.querySelectorAll(".daily-top-row").forEach((row) => {
      row.setAttribute("tabindex", "0");
      const open = () => {
        const hit = entries.get(row.getAttribute("data-user"));
        if (hit && Array.isArray(hit.grid) && hit.grid.length) openReplayModal(hit, row);
      };
      row.addEventListener("click", (e) => { if (!e.target.closest("a")) open(); });
      row.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.target.closest("a")) { e.preventDefault(); open(); }
      });
    });
  };
  fetch(api("&n=3"))
    .then((r) => (r.ok ? r.json() : null))
    .then((view) => {
      if (!view || !Array.isArray(view.top) || view.top.length === 0) return;
      view.top.forEach((e) => entries.set(escAttr(e.username), e));
      if (view.you) entries.set(escAttr(view.you.username), view.you);
      const more = view.total > view.top.length + (view.you ? 1 : 0);
      mount.innerHTML = renderLeaderboard(view, username) +
        (more ? `<button type="button" class="daily-lb-showall" id="dailyLbShowAll">${t("daily.lbShowAll", "Show all")} (${view.total}) →</button>` : "");
      mount.hidden = false;
      wireRows(mount);
      const showAll = mount.querySelector("#dailyLbShowAll");
      if (showAll) showAll.addEventListener("click", () => {
        showAll.disabled = true;
        fetch(api("&full=1"))
          .then((r) => (r.ok ? r.json() : null))
          .then((fullV) => {
            if (!fullV || !Array.isArray(fullV.players) || fullV.players.length === 0) { showAll.disabled = false; return; }
            fullV.players.forEach((e) => entries.set(escAttr(e.username), e));
            const list = mount.querySelector(".daily-top-list");
            if (!list) return;
            const roster = document.createElement("ul");
            roster.className = `daily-top-list daily-lb-roster${fullV.players.length > SCROLL_AT ? " is-scroll" : ""}`;
            roster.innerHTML = fullV.players.map((e) => rosterRow(e, username)).join("");
            list.replaceWith(roster);
            showAll.remove();
            wireRows(roster);
          })
          .catch(() => { showAll.disabled = false; });
      });
    })
    .catch(() => {}); // recap renders fine without a board
}
```

- [ ] **Step 6: Add the mount** in `public/index.html`, after the `#dailyCashout` `</ul>` (line 281), before `#dailyStory`:

```html
        <!-- Today's winners — the golden card's leaderboard (daily-lb.js): top-3 medals +
             your row; "Show all (N)" expands the full roster; tap a row → replay popup. -->
        <div class="daily-lb" id="dailyLeaderboard" hidden></div>
```

- [ ] **Step 7: Wire from `renderDailyUnlock`** in `public/app.js` — import at top (next to the daily-card import if present, else with the other `/x.js` imports):

```js
import { mountDailyLeaderboard } from "/daily-lb.js";
```

and at the end of `renderDailyUnlock` (after the `#dailyArchiveLink` wiring, ~line 2523) — only once the mint confirmed, so the token (stored from the same finished snapshot, app.js:2044) is guaranteed present:

```js
  // Today's winners board — mounted once the mint confirms (the finisher token from the
  // same snapshot is already in localStorage by now; see wr.dailyToken storage above).
  const lb = $("#dailyLeaderboard");
  if (lb && confirmed && game.dailyDate && getUsername()) {
    mountDailyLeaderboard({ mount: lb, date: game.dailyDate, username: getUsername(), t });
  }
```

- [ ] **Step 8: Styles** — append to `public/style.css` (match the existing `.daily-top-*` vocabulary, which the room view now reuses):

```css
/* ── Golden-card leaderboard (daily-lb.js) ─────────────────────────────────── */
.daily-lb { margin-top: 18px; }
.daily-lb .daily-top-row { cursor: pointer; }
.daily-lb-roster.is-scroll { max-height: 50vh; overflow-y: auto; overscroll-behavior: contain; }
.daily-lb-showall {
  display: block; width: 100%; margin-top: 10px; padding: 10px 12px;
  background: none; border: 1px solid rgba(240, 193, 75, 0.25); border-radius: 10px;
  color: #f0c14b; font: inherit; font-size: 14px; letter-spacing: 0.04em; cursor: pointer;
}
.daily-lb-showall:hover { border-color: rgba(240, 193, 75, 0.55); }
.daily-lb-modal {
  position: fixed; inset: 0; z-index: 10001; /* above #settleOverlay's 10000 */
  display: flex; align-items: center; justify-content: center;
  background: rgba(10, 10, 14, 0.78); backdrop-filter: blur(3px);
}
.daily-lb-modal-card {
  background: #15151c; border: 1px solid rgba(240, 193, 75, 0.25); border-radius: 16px;
  padding: 18px 20px 22px; box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
  display: flex; flex-direction: column; gap: 12px; align-items: center;
}
.daily-lb-modal-head { display: flex; align-items: center; gap: 12px; width: 100%; }
.daily-lb-modal-close {
  margin-left: auto; background: none; border: 0; color: #8a8a8f;
  font-size: 18px; line-height: 1; cursor: pointer; padding: 4px;
}
.daily-lb-modal-close:hover { color: #f4f2ec; }
```

- [ ] **Step 9: i18n key** — add to `public/locales/en.js` next to the other `daily.*` keys:

```js
  "daily.lbShowAll": "Show all",
```

- [ ] **Step 10: Run to verify pass**

Run: `npx vitest run test/daily-lb.test.js test/module-graph.test.ts test/daily.test.js`
Expected: PASS. If `module-graph.test.ts` fails, it enforces the import graph — add `daily-lb.js` wherever it registers public modules, following the error message.

- [ ] **Step 11: Commit**

```bash
git add public/daily-lb.js public/daily-card.js public/index.html public/style.css public/locales/en.js public/app.js vitest.config.ts test/daily-lb.test.js
git commit -m "feat(daily): today's winners board inside the golden card — top-3+you, Show-all roster with scroll"
```

---

### Task 7: Replay popup — tap a row, the board plays itself

**Files:**
- Modify: `test/daily-lb.test.js` (the module code shipped in Task 6 — this task proves it)

- [ ] **Step 1: Write the failing tests** — append to `test/daily-lb.test.js`:

```js
describe("replay popup", () => {
  it("tapping a row opens an auto-playing modal with that player's board", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    mount.querySelector('.daily-top-row[data-user="ada"]').click();
    const modal = document.getElementById("dailyLbModal");
    expect(modal).toBeTruthy();
    expect(modal.querySelector('[role="dialog"]').getAttribute("aria-label")).toContain("ada");
    const stamp = modal.querySelector(".daily-stamp");
    expect(stamp).toBeTruthy();
    expect(stamp.classList.contains("has-letters")).toBe(true);   // finisher → real letters
    expect(stamp.querySelectorAll(".is-veiled").length).toBeGreaterThan(0); // replay started
  });

  it("Esc closes and focus returns to the opener row", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    const row = mount.querySelector('.daily-top-row[data-user="ada"]');
    row.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.getElementById("dailyLbModal")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("scrim tap closes; a second row tap replaces the modal", async () => {
    const mount = document.getElementById("dailyLeaderboard");
    mountDailyLeaderboard({ mount, date: "2026-06-06", username: "yan" });
    await flush();
    mount.querySelector('.daily-top-row[data-user="ada"]').click();
    mount.querySelector('.daily-top-row[data-user="bob"]').click();
    const modals = document.querySelectorAll(".daily-lb-modal");
    expect(modals.length).toBe(1); // never stacks
    modals[0].click(); // scrim
    expect(document.getElementById("dailyLbModal")).toBeNull();
  });
});
```

Note: jsdom lacks `matchMedia`; `playStampReplay` guards with `typeof matchMedia === "function"`, so the replay runs. If the `is-veiled` assertion flakes, stub `globalThis.matchMedia = () => ({ matches: false })` in `beforeEach` (the pattern stamp-replay-dom.test.js uses).

- [ ] **Step 2: Run**

Run: `npx vitest run test/daily-lb.test.js`
Expected: PASS if Task 6's `openReplayModal` is correct — these tests pin the contract. Fix any failures in `public/daily-lb.js` (not in the tests).

- [ ] **Step 3: Commit**

```bash
git add test/daily-lb.test.js
git commit -m "test(daily): replay popup contract — auto-play on open, esc/scrim close, never stacks"
```

---

### Task 8: Full verification + ship

- [ ] **Step 1: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green. Tests that assert old daily gold amounts elsewhere (search if anything fails: `grep -rn "DAILY_GOLD_BONUS\|goldFromPoints" test/`) get the ÷9 treatment, never weakened.

- [ ] **Step 2: Manual smoke on dev** — `npm run dev`, then in a browser: play `/daily/<today>` to completion and verify (1) the supernova plays with Score/Daily/Speed lines and the wallet count-up lands on the server balance, (2) the golden card shows top-3 + you, (3) Show-all expands with scroll, (4) tapping a row pops an auto-playing replay with letters, Esc closes. With DevTools "Emulate prefers-reduced-motion": static lines panel instead, no coins.

- [ ] **Step 3: Ship**

```bash
bash dev/ship.sh
```

Per memory: ship.sh's CI watch can report the PREVIOUS commit's run — verify the deploy run matches your commit, then smoke prod (wordul.com `/daily/<today>` after solving, or check `/api/daily/<today>/leaderboard?full=1` carries `grid`).

- [ ] **Step 4: Post-ship note** — today's board mixes 127-era and ~400-era mints until the day rolls (accepted in the spec). No action; self-heals at the next daily.
