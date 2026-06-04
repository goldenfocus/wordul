# Secured Two-Token Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gold server-authoritative and per-account via an append-only token ledger, and split the economy into in-game **Points** (server-computed, spendable on power-ups) and persistent **Gold** (minted at cash-out), so balances can't be hacked via `localStorage`.

**Architecture:** A new pure module `src/economy.ts` owns all economy math (ported from `public/celebrate.js` + `public/gold.js`) so server and client agree. The `ROOM` Durable Object computes each player's Points from its own guess record, enforces power-up spends, and mints Gold into the `USER` Durable Object's append-only ledger at game end. The client becomes pure display: it reads Points from the room snapshot and Gold from the user profile.

**Tech Stack:** TypeScript (Cloudflare Workers + Durable Objects), Vitest, vanilla ES modules on the client, `wrangler dev` for integration.

**Spec:** `docs/superpowers/specs/2026-06-02-secured-two-token-economy-design.md`

---

## File Structure

- **Create** `src/economy.ts` — pure economy math: `POINTS` constants, `comboMultiplier`, `escalatedPenalty`, ported discovery helpers, `pointsEarned`, `goldFromPoints`, `balance`. No DOM, no I/O. Imported by both server (`room.ts`) and tests.
- **Create** `test/economy.test.ts` — unit tests for `economy.ts`.
- **Modify** `src/types.ts` — add `LedgerTx`, `UserProfile.ledger`, `PlayerState.points` + `PlayerState.pointsSpent`.
- **Modify** `src/user.ts` — append-only ledger: `balance()` helper, `POST /ledger/append` route, `gold` in the `GET` profile response, init `ledger: []` on fresh profiles.
- **Modify** `src/room.ts` — recompute `player.points` on each guess, reset Points on round start, deduct Points on power-ups (reject if unaffordable), mint Gold per player in `finishGame`.
- **Modify** `public/edition.js` — gold getters read a server-supplied cache, not authoritative `localStorage`; `setGold` becomes a display cache setter; reset stale `localStorage` gold.
- **Modify** `public/app.js` — fetch Gold from the profile on join, reconcile the HUD to server Points (snapshot) and Gold (profile/cash-out); send power-up spends through the existing room messages (already server-routed).
- **Create** `test/two-token-economy.integration.mjs` — WS integration test against `wrangler dev`.

---

## Task 1: Pure economy module (`src/economy.ts`)

**Files:**
- Create: `src/economy.ts`
- Test: `test/economy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/economy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  POINTS, comboMultiplier, escalatedPenalty,
  orderedDiscoveriesInLast, deadLettersFrom, wastedDeadLettersInLast,
  pointsEarned, goldFromPoints, balance,
} from "../src/economy.ts";
import type { GuessRow } from "../src/economy.ts";

// helper: build a GuessRow from a word + a mask string ("g"=green,"y"=yellow,"x"=gray)
const row = (word: string, m: string): GuessRow => ({
  word: word.toUpperCase(),
  mask: [...m].map((c) => (c === "g" ? "green" : c === "y" ? "yellow" : "gray")),
});

describe("comboMultiplier", () => {
  it("is 1x for 0-1 discoveries, scales 0.5 per extra", () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBe(1.5);
    expect(comboMultiplier(5)).toBe(3);
  });
});

describe("escalatedPenalty", () => {
  it("is base on first reuse, linear after", () => {
    expect(escalatedPenalty(50, 0)).toBe(50);
    expect(escalatedPenalty(50, 2)).toBe(150);
  });
});

describe("orderedDiscoveriesInLast", () => {
  it("lists new yellows then new greens, ascending, dup-safe", () => {
    const guesses = [row("CRANE", "gyxxx")]; // C green, R yellow
    const d = orderedDiscoveriesInLast(guesses);
    expect(d.map((x) => x.kind)).toEqual(["yellow", "green"]);
    expect(d.map((x) => x.index)).toEqual([1, 0]);
  });
  it("does not re-count a color already seen at that index", () => {
    const guesses = [row("CRANE", "gxxxx"), row("CLOUD", "gxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]); // C green was already green
  });
});

describe("deadLettersFrom / wastedDeadLettersInLast", () => {
  it("marks a gray-everywhere letter dead and flags its reuse", () => {
    const prior = [row("CRANE", "xxxxx")]; // all gray -> C,R,A,N,E dead
    expect(deadLettersFrom(prior).has("C")).toBe(true);
    const guesses = [...prior, row("CLOUD", "xxxxx")];
    expect(wastedDeadLettersInLast(guesses)).toEqual({ letters: ["C"], count: 1 });
  });
  it("a letter green somewhere is never dead (dup-safe)", () => {
    const prior = [row("EERIE", "gxxxx")]; // first E green -> E not dead
    expect(deadLettersFrom(prior).has("E")).toBe(false);
  });
});

describe("pointsEarned", () => {
  it("pays greens+yellows with combo and a solve+speed bonus", () => {
    // single all-green solve in guess 1 of a maxGuesses=6 board:
    // 5 greens, combo(5)=3x -> round(500*3)=1500, +solve 500 +speed 300*5=1500 => 3500
    const guesses = [row("CRANE", "ggggg")];
    expect(pointsEarned(guesses, 6)).toBe(1500 + 500 + 1500);
  });
  it("subtracts capped, escalating wasted-letter penalties", () => {
    // guess1 all gray (C,R,A,N,E dead), guess2 "CRUMB" reuses C and R (2 dead letters),
    // no discoveries -> 50 + 50 = 100 penalty, total -100.
    const guesses = [row("CRANE", "xxxxx"), row("CRUMB", "xxxxx")];
    expect(pointsEarned(guesses, 6)).toBe(-100);
  });
});

describe("goldFromPoints", () => {
  it("converts points to gold and never mints negative", () => {
    expect(goldFromPoints(3500)).toBe(35);
    expect(goldFromPoints(-100)).toBe(0);
  });
});

describe("balance", () => {
  it("sums signed deltas for a token and allows negative", () => {
    const led = [
      { token: "gold", delta: 100, reason: "mint:cashout", ts: 1 },
      { token: "gold", delta: -300, reason: "spend:buyin", ts: 2 },
      { token: "other", delta: 999, reason: "x", ts: 3 },
    ];
    expect(balance(led, "gold")).toBe(-200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/economy.test.ts`
Expected: FAIL — cannot resolve `../src/economy.ts` (module does not exist).

- [ ] **Step 3: Write the module**

Create `src/economy.ts`:

```ts
// src/economy.ts — pure, shared economy math (server + tests). No DOM, no I/O.
// Ported from public/celebrate.js (discovery helpers) and public/gold.js (constants),
// so the ROOM Durable Object computes the exact same numbers the client animates.
import type { Color } from "./color.ts";

export type GuessRow = { word: string; mask: Color[] };
export type LedgerTx = { token: string; delta: number; reason: string; ts: number; ref?: string };

export const POINTS = {
  green: 100,
  yellow: 50,
  solve: 500,
  speedPerGuessLeft: 300,
  revealCost: 4000,
  vowelCost: 200,
  wastedLetterPenalty: 50,
  wastedCapPerGuess: 200,
};

// 2 hits -> 1.5x, 3 -> 2x, 4 -> 2.5x, 5 -> 3x.
export function comboMultiplier(discoveries: number): number {
  return discoveries >= 2 ? 1 + (discoveries - 1) * 0.5 : 1;
}

// 1st reuse of a dead letter = base, 2nd = 2x base, ...
export function escalatedPenalty(base: number, reuseCount: number): number {
  return base * (Math.max(0, reuseCount) + 1);
}

// New discoveries in the LATEST guess — yellows first, then greens, ascending index.
// Dup-safe: a color already seen at that index in an earlier guess is not re-counted.
export function orderedDiscoveriesInLast(
  guesses: GuessRow[],
): { index: number; kind: "yellow" | "green"; letter: string }[] {
  if (!guesses || guesses.length === 0) return [];
  const last = guesses[guesses.length - 1];
  if (!last || !last.mask) return [];
  const wasGreen = new Set<number>();
  const wasYellow = new Set<number>();
  for (let g = 0; g < guesses.length - 1; g++) {
    const mask = guesses[g].mask || [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === "green") wasGreen.add(i);
      else if (mask[i] === "yellow") wasYellow.add(i);
    }
  }
  const word = last.word || "";
  const out: { index: number; kind: "yellow" | "green"; letter: string }[] = [];
  for (let i = 0; i < last.mask.length; i++) {
    if (last.mask[i] === "yellow" && !wasYellow.has(i)) out.push({ index: i, kind: "yellow", letter: word[i] });
  }
  for (let i = 0; i < last.mask.length; i++) {
    if (last.mask[i] === "green" && !wasGreen.has(i)) out.push({ index: i, kind: "green", letter: word[i] });
  }
  return out;
}

// Letters PROVEN dead: gray somewhere and never green/yellow at any position (dup-safe).
export function deadLettersFrom(guesses: GuessRow[]): Set<string> {
  if (!guesses || guesses.length === 0) return new Set();
  const good = new Set<string>();
  for (const g of guesses) {
    if (!g || !g.mask) continue;
    const word = g.word || "";
    for (let i = 0; i < g.mask.length; i++) {
      if (g.mask[i] === "green" || g.mask[i] === "yellow") good.add((word[i] || "").toUpperCase());
    }
  }
  const dead = new Set<string>();
  for (const g of guesses) {
    if (!g || !g.mask) continue;
    const word = g.word || "";
    for (let i = 0; i < g.mask.length; i++) {
      if (g.mask[i] === "gray") {
        const c = (word[i] || "").toUpperCase();
        if (c && !good.has(c)) dead.add(c);
      }
    }
  }
  return dead;
}

// Unique already-dead letters reused in the latest guess (knowledge from PRIOR guesses).
export function wastedDeadLettersInLast(guesses: GuessRow[]): { letters: string[]; count: number } {
  if (!guesses || guesses.length < 2) return { letters: [], count: 0 };
  const last = guesses[guesses.length - 1];
  if (!last || !last.word) return { letters: [], count: 0 };
  const dead = deadLettersFrom(guesses.slice(0, -1));
  const seen = new Set<string>();
  const letters: string[] = [];
  const word = last.word || "";
  for (let i = 0; i < word.length; i++) {
    const c = (word[i] || "").toUpperCase();
    if (dead.has(c) && !seen.has(c)) {
      seen.add(c);
      letters.push(c);
    }
  }
  return { letters, count: letters.length };
}

// Deterministic total Points earned across a whole guess sequence (no spends).
// Walks guess-by-guess so wasted-letter penalties escalate exactly like the client.
export function pointsEarned(guesses: GuessRow[], maxGuesses: number): number {
  if (!guesses || guesses.length === 0) return 0;
  let pts = 0;
  const reuse = new Map<string, number>();
  for (let k = 0; k < guesses.length; k++) {
    const upto = guesses.slice(0, k + 1);
    const disc = orderedDiscoveriesInLast(upto);
    const base = disc.reduce((s, d) => s + (d.kind === "green" ? POINTS.green : POINTS.yellow), 0);
    pts += Math.round(base * comboMultiplier(disc.length));
    const wasted = wastedDeadLettersInLast(upto);
    let pen = 0;
    for (const letter of wasted.letters) {
      const c = reuse.get(letter) ?? 0;
      pen += escalatedPenalty(POINTS.wastedLetterPenalty, c);
      reuse.set(letter, c + 1);
    }
    pts -= Math.min(pen, POINTS.wastedCapPerGuess);
  }
  const last = guesses[guesses.length - 1];
  if (last && last.mask.length > 0 && last.mask.every((c) => c === "green")) {
    const guessesLeft = Math.max(0, maxGuesses - guesses.length);
    pts += POINTS.solve + POINTS.speedPerGuessLeft * guessesLeft;
  }
  return pts;
}

// Cash-out conversion. Tunable (see spec "Open tuning"). Never mints negative gold
// from a single bad game — debt comes from buy-ins (Spec 2), not from low scores.
export function goldFromPoints(points: number): number {
  return Math.max(0, Math.round(points / 100));
}

// Sum of signed deltas for one token. Allows negative (day-one credit card).
export function balance(ledger: LedgerTx[], token: string): number {
  return (ledger || []).reduce((s, tx) => (tx.token === token ? s + tx.delta : s), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/economy.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/economy.ts test/economy.test.ts
git commit -m "feat(economy): pure shared module for points/gold/ledger math"
```

---

## Task 2: Type changes (`src/types.ts`)

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the ledger + profile fields**

In `src/types.ts`, import the ledger type and extend `UserProfile`. Find the `UserProfile` type and add `ledger`:

```ts
import type { LedgerTx } from "./economy.ts";
// ... inside UserProfile:
//   username, createdAt, stats, games, ownedRooms already exist — add:
  ledger: LedgerTx[];   // append-only token transactions; gold balance = balance(ledger,"gold")
```

(If a circular-import lint fires, instead declare `LedgerTx` in `types.ts` and import it into `economy.ts` — pick whichever the repo's import direction already favors; `economy.ts` importing from `color.ts` shows leaf-imports-leaf is fine, so `types.ts` importing `economy.ts` is acceptable.)

- [ ] **Step 2: Add per-player Points to `PlayerState`**

```ts
export type PlayerState = {
  username: string;
  connected: boolean;
  guesses: GuessRow[];
  status: "playing" | "won" | "lost";
  isBot?: boolean;
  points: number;        // live in-game points (earned − spent); reset each round
  pointsSpent: number;   // running power-up spend this round (internal accumulator)
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: errors ONLY where `PlayerState` objects are constructed without `points`/`pointsSpent` (fixed in Task 4) and where `UserProfile` is constructed without `ledger` (fixed in Task 3). Note them; do not fix here.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): ledger on UserProfile, points on PlayerState"
```

---

## Task 3: Ledger in the USER Durable Object (`src/user.ts`)

**Files:**
- Modify: `src/user.ts`
- Test: `test/economy.test.ts` (add a focused unit on the append/balance contract is already covered; the DO behavior is covered by Task 6 integration)

- [ ] **Step 1: Initialize `ledger` on fresh profiles**

In `src/user.ts`, the `load()` method builds a `fresh` profile. Add `ledger: []` and self-heal older profiles missing it:

```ts
// in load(), the fresh profile:
const fresh: UserProfile = { username, createdAt: Date.now(), stats: emptyStats(), games: [], ownedRooms: [], ledger: [] };
// and right after loading `saved`, before returning it:
if (saved && !Array.isArray(saved.ledger)) { saved.ledger = []; await this.ctx.storage.put("profile", saved); }
```

- [ ] **Step 2: Include `gold` in the GET response**

Import `balance` and fold a computed gold field into the GET JSON:

```ts
import { balance } from "./economy.ts";
// ... in fetch(), the GET branch:
if (req.method === "GET") {
  const profile = await this.load(username);
  return Response.json({ ...profile, gold: balance(profile.ledger, "gold") });
}
```

- [ ] **Step 3: Add the append route**

Add before the final `return new Response("not found", …)`:

```ts
if (req.method === "POST" && url.pathname.endsWith("/ledger/append")) {
  const tx = (await req.json()) as { token: string; delta: number; reason: string; ref?: string };
  const profile = await this.load(username);
  profile.ledger.push({ token: tx.token, delta: tx.delta, reason: tx.reason, ts: Date.now(), ref: tx.ref });
  if (profile.ledger.length > 500) profile.ledger = profile.ledger.slice(-500);
  await this.ctx.storage.put("profile", profile);
  return Response.json({ gold: balance(profile.ledger, "gold") });
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: `user.ts` errors resolved. Remaining errors only in `room.ts` (Task 4).

- [ ] **Step 5: Commit**

```bash
git add src/user.ts
git commit -m "feat(user): append-only token ledger + gold balance in profile"
```

---

## Task 4: Points + minting in the ROOM (`src/room.ts`)

**Files:**
- Modify: `src/room.ts`

- [ ] **Step 1: Import the economy module**

At the top of `src/room.ts`, alongside the other imports:

```ts
import { pointsEarned, goldFromPoints, POINTS } from "./economy.ts";
```

- [ ] **Step 2: Initialize Points when a player is created**

In `onHello`, where a new player is pushed:

```ts
this.state.players.push({ username, connected: true, guesses: [], status: "playing", points: 0, pointsSpent: 0 });
```

- [ ] **Step 3: Recompute Points on each accepted guess**

In `applyGuess`, after `player.guesses.push(...)` and before `maybeFinish`, set live points = earned − spent:

```ts
player.points = pointsEarned(player.guesses, this.state.maxGuesses) - player.pointsSpent;
```

- [ ] **Step 4: Reset Points on round start and rematch**

In `onStart` (where `phase` becomes "playing") and in `onRematch` (the `for (const p of this.state.players)` reset loop), reset both fields:

```ts
// onRematch loop already does p.guesses = []; p.status = "playing"; — add:
p.points = 0;
p.pointsSpent = 0;
// onStart: after setting the word/phase, reset every player's round economy:
for (const p of this.state.players) { p.points = 0; p.pointsSpent = 0; }
```

- [ ] **Step 5: Enforce power-up spends server-side**

In `onRevealLetter`, gate on affordability and deduct before granting:

```ts
private onRevealLetter(ws: WebSocket, known?: number[]): void {
  if (this.state.phase !== "playing" || !this.state.word) return;
  const username = this.userFor(ws);
  const player = this.state.players.find((p) => p.username === username);
  if (!player || player.status !== "playing") return;
  if (player.points < POINTS.revealCost) { this.send(ws, { type: "error", message: "not enough points" }); return; }
  const hit = revealUngreened(this.state.word, player.guesses, known ?? []);
  if (!hit) return; // nothing left to reveal — no charge
  player.pointsSpent += POINTS.revealCost;
  player.points -= POINTS.revealCost;
  this.send(ws, { type: "revealed_letter", index: hit.index, letter: hit.letter });
  void this.persistAndBroadcast();
}
```

Apply the same affordability gate + deduction to `onVowelCount` using `POINTS.vowelCost`:

```ts
private onVowelCount(ws: WebSocket): void {
  if (this.state.phase !== "playing" || !this.state.word) return;
  const username = this.userFor(ws);
  const player = this.state.players.find((p) => p.username === username);
  if (!player || player.status !== "playing") return;
  if (player.points < POINTS.vowelCost) { this.send(ws, { type: "error", message: "not enough points" }); return; }
  player.pointsSpent += POINTS.vowelCost;
  player.points -= POINTS.vowelCost;
  this.send(ws, { type: "vowels", count: countVowels(this.state.word) });
  void this.persistAndBroadcast();
}
```

(Confirm `onVowelCount`'s current body against the file; keep its existing `countVowels` call, only add the gate + deduction + broadcast.)

- [ ] **Step 6: Mint Gold at cash-out**

In `finishGame`, fold a gold mint into the same per-player loop that posts game records. Replace the `Promise.allSettled(... /append ...)` block with one that also appends the ledger tx:

```ts
await Promise.allSettled(
  Object.entries(records).flatMap(([username, record]) => {
    const player = this.state.players.find((p) => p.username === username);
    const gold = goldFromPoints(player ? player.points : 0);
    const stub = this.env.USER.get(this.env.USER.idFromName(username));
    const calls = [
      stub.fetch(`https://do/append?username=${encodeURIComponent(username)}`, { method: "POST", body: JSON.stringify(record) })
        .catch((e) => console.error("report failed", username, (e as Error).message)),
    ];
    if (gold > 0) {
      calls.push(
        stub.fetch(`https://do/ledger/append?username=${encodeURIComponent(username)}`, {
          method: "POST",
          body: JSON.stringify({ token: "gold", delta: gold, reason: "mint:cashout", ref: `${this.state.path}#${this.state.round}` }),
        }).catch((e) => console.error("mint failed", username, (e as Error).message)),
      );
    }
    return calls;
  }),
);
```

- [ ] **Step 7: Backfill `points`/`pointsSpent` on restore**

In the constructor's `blockConcurrencyWhile` restore block, after the other self-heal lines, normalize older persisted players:

```ts
for (const p of restored.players) { if (typeof p.points !== "number") p.points = 0; if (typeof p.pointsSpent !== "number") p.pointsSpent = 0; }
```

- [ ] **Step 8: Typecheck + existing tests**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all existing tests pass (174+).

- [ ] **Step 9: Commit**

```bash
git add src/room.ts
git commit -m "feat(room): server-authoritative points + power-up spends + gold mint at cash-out"
```

---

## Task 5: Client becomes display-only (`public/edition.js`, `public/app.js`)

**Files:**
- Modify: `public/edition.js`
- Modify: `public/app.js`

- [ ] **Step 1: Make gold a server-fed display cache in `edition.js`**

The HUD still reads `getGold()`, but it must reflect the SERVER balance, not an authoritative local value. Add a setter the app calls when the profile/snapshot arrives, and reset any stale authoritative value:

```js
// edition.js — gold is now a DISPLAY cache of the server balance; the server is the
// source of truth (USER ledger). We keep getGold/setGold for the HUD, but the app
// feeds them from the profile. Clear any pre-existing local authority once.
const LS = { edition: "wordul.edition", gold: "wordul.gold", muted: "wordul.muted" };
// one-time reset of the old hackable balance (Spec 1 migration):
if (localStorage.getItem("wordul.goldMigratedV2") !== "1") {
  localStorage.removeItem(LS.gold);
  localStorage.setItem("wordul.goldMigratedV2", "1");
}
```

Keep `getGold`/`setGold` as-is (display cache); the app now calls `setGold(serverGold)` on profile load. Leave `addGold`/`drainGold`/`spendGold` for the in-game **Points** animations (renamed conceptually but the functions still tween the HUD number).

- [ ] **Step 2: Read Gold from the profile on join in `app.js`**

Where the app fetches/uses the user profile (the `/api/user/<name>` path or the existing profile load), set the HUD gold from the server value. Add after a profile is fetched:

```js
// server gold is authoritative; mirror it into the HUD cache
if (typeof profile.gold === "number") setGold(profile.gold);
```

(`setGold` is imported from `/edition.js`; add it to the existing import on line 5 if not present.)

- [ ] **Step 3: Drive the in-game number from snapshot Points**

In the snapshot handler (`onServerMessage`), reconcile the live HUD to the server's per-player `points`. After `game.snapshot = msg.room;` and the `me` lookup, add:

```js
if (me && typeof me.points === "number") {
  // server owns points; reconcile the HUD cache to the authoritative value
  setGold(me.points);
}
```

(For Spec 1 the HUD shows live **Points** during a game; the persistent **Gold** is shown from the profile on the home/hub and refreshed after cash-out in the next step. Naming the HUD label "Points" vs "Gold" by phase is a presentation tweak — keep the existing label for now; Spec 2 splits the displays.)

- [ ] **Step 4: Refresh Gold after cash-out**

When a snapshot arrives with `phase === "finished"`, re-fetch the profile so the freshly-minted Gold shows. In `onServerMessage`, in the finished-phase branch (or after detecting the transition into finished), add:

```js
if (msg.room.phase === "finished") {
  fetch(`/api/user/${encodeURIComponent(getUsername())}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => { if (p && typeof p.gold === "number") setGold(p.gold); })
    .catch(() => {});
}
```

- [ ] **Step 5: Manual sanity in the browser**

Run: `npx wrangler dev --port 8810 --local` then load `http://localhost:8810/@yan/econ-test` (set `localStorage['wr.username']='yan'` first). Play a guess; confirm the HUD number moves with greens/yellows. Win; confirm the number reconciles to the minted Gold. Open devtools and set `localStorage['wordul.gold']=999999`; reload; confirm the HUD shows the SERVER value, not 999999.

- [ ] **Step 6: Commit**

```bash
git add public/edition.js public/app.js
git commit -m "feat(client): display server-authoritative points/gold; drop local gold authority"
```

---

## Task 6: WS integration test

**Files:**
- Create: `test/two-token-economy.integration.mjs`

- [ ] **Step 1: Write the integration script**

Create `test/two-token-economy.integration.mjs` (run manually against `wrangler dev`, mirrors the pattern used for room-theme verification):

```js
// Usage: start `npx wrangler dev --port 8810 --local`, then `node test/two-token-economy.integration.mjs`
const HOST = process.env.HOST || "localhost:8810";
const slug = "econ-" + Date.now();
const room = `alice/${slug}`;
const wsUrl = `ws://${HOST}/ws?room=${encodeURIComponent(room)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ck = (c, m) => { c ? (pass++, console.log("✓", m)) : (fail++, console.log("✗ FAIL:", m)); };

function client() {
  const ws = new WebSocket(wsUrl);
  const snaps = [], errs = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "snapshot") snaps.push(m.room);
    if (m.type === "error") errs.push(m.message);
  });
  return { ws, snaps, errs, open: () => new Promise((r) => ws.addEventListener("open", r, { once: true })),
    send: (m) => ws.send(JSON.stringify(m)), last: () => snaps[snaps.length - 1] };
}
const goldOf = async (name) => {
  const r = await fetch(`http://${HOST}/api/user/${name}`);
  return (await r.json()).gold;
};

const A = client();
await A.open();
A.send({ type: "hello", username: "alice" });
await wait(300);
ck((await goldOf("alice")) === 0, `fresh account starts at 0 gold (got ${await goldOf("alice")})`);

A.send({ type: "start" });
await wait(300);
const me = () => A.last().players.find((p) => p.username === "alice");
ck(me().points === 0, `points start at 0 (got ${me().points})`);

// power-up rejected when broke
const errsBefore = A.errs.length;
A.send({ type: "vowel_count" });
await wait(300);
ck(A.errs.length > errsBefore && /not enough points/.test(A.errs.at(-1)), `power-up rejected when broke ("${A.errs.at(-1)}")`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it**

Run (in one shell): `npx wrangler dev --port 8810 --local`
Run (in another): `node test/two-token-economy.integration.mjs`
Expected: `3 passed, 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add test/two-token-economy.integration.mjs
git commit -m "test(economy): WS integration — per-account gold, points, spend gating"
```

---

## Self-Review

**Spec coverage:**
- Ledger on USER DO → Task 3. ✓
- Points server-authoritative + reset per round → Task 4 steps 2-4. ✓
- Power-up spends server-enforced → Task 4 step 5. ✓
- Gold minted at cash-out → Task 4 step 6. ✓
- Client display-only + localStorage reset → Task 5. ✓
- 1,738 fix (reset to 0) → Task 5 step 1 + Task 3 fresh profile. ✓
- Tests (unit + integration) → Task 1, Task 6. ✓
- Extensible ledger (token/reason/delta) → Task 1 `LedgerTx`, Task 3 append. ✓

**Type consistency:** `LedgerTx`, `GuessRow`, `balance`, `pointsEarned`, `goldFromPoints`, `POINTS` are defined in Task 1 and used with identical names/signatures in Tasks 3-4. `PlayerState.points`/`pointsSpent` defined in Task 2, set in Task 4, read in Task 5. Consistent.

**Notes for the implementer:**
- `points` can go negative mid-game (penalties); the affordability check `points < cost` correctly blocks spends while in the red.
- Minting uses `player.points` (earned − spent) at finish, so spending power-ups legitimately reduces cash-out gold — the intended tradeoff.
- Constants (`POINTS.*`) and `goldFromPoints` are flagged tunable in the spec; do not block on their exact values.
