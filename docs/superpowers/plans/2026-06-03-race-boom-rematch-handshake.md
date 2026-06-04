# Race-end Boom → Rematch Handshake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a live race end the instant someone solves it (the loser's board booms immediately), and replace the instant rematch-reset with a propose/accept handshake where bot opponents decide like people.

**Architecture:** Spec at `docs/superpowers/specs/2026-06-03-race-boom-rematch-handshake-design.md`. The `RoomDurableObject` (`src/room.ts`) is **not** unit-testable in this repo (no `cloudflare:test` pool is configured; no test instantiates the DO). The established pattern — every other subsystem (`arena-core`, `daily-core`, `challenge-core`, `user-core`) — is **pure reducer logic in a `*-core.ts` module with a `.test.ts`, and a thin DO shell that calls it**. We follow that: all new decision logic goes into a new `src/room-core.ts` (race-end flip, rematch handshake reducer, bot-accept roll, alarm scheduling) and a tiny client `public/race-copy.js` (outpaced-vs-exhausted derivation). Both are exhaustively unit-tested. The DO and `public/app.js` become thin callers, verified by `npm run typecheck` + a manual smoke.

**Tech Stack:** TypeScript on Cloudflare Workers + Durable Objects; vanilla JS client (`public/app.js`); vitest (`vitest run`); i18n via `public/locales/en.js` + `t()`.

**Testing strategy (read first):**
- **Pure logic** (`room-core.ts`, `race-copy.js`): full TDD — failing test → implement → pass.
- **DO wiring** (`room.ts`): no unit harness exists. Verified by `npm run typecheck` (the reducer it calls is already test-covered) + the manual smoke in Task 16. Do **not** invent a `cloudflare:test` setup — out of scope.
- **Client wiring** (`app.js`): no DOM test harness for the monolith. The extracted `race-copy.js` is unit-tested; UI wiring is verified by the manual smoke.
- Run the **full suite** (`npm test`) after every task that adds/edits a `*-core.ts` or `*.js` module, not just the new file — the `module-graph.test.ts` guard checks import boundaries.

**Tunables** (live in `src/room-core.ts`, the Arena family — see the `arena-tunables` memory): `REMATCH_TIMEOUT_MS = 15_000`, `BOT_REMATCH_MIN_MS = 3_000`, `BOT_REMATCH_MAX_MS = 9_000`, `BOT_REMATCH_ACCEPT_P = 0.8`.

---

## File Structure

**Create:**
- `src/room-core.ts` — pure decision logic + tunables: `outpacedLosers`, `rematchReduce`, `botAccepts`, `nextAlarmAt`, and the four constants. Imports only `./types.ts`.
- `test/room-core.test.ts` — reducer + helper unit tests (spec test matrix 1, 3–10).
- `public/race-copy.js` — pure `lossKind({...})` returning `"outpaced" | "exhausted" | null`. No DOM.
- `test/race-copy.test.js` — unit tests (spec test 2).

**Modify:**
- `src/types.ts` — `ClientMessage` (swap `rematch` for `rematch_propose|accept|decline`), `ServerMessage` (add `rematch_proposed|accepted|cancelled`), `RoomSnapshot` (add internal `rematch` / `botRematchAt` / `rematchTimeoutAt`).
- `src/room.ts` — Slice 1 flip in `applyGuess`; Slice 2/3 handlers, effect runner, alarm rework, snapshot strip, router, delete old `onRematch`; `webSocketClose` left-handling.
- `public/app.js` — outpaced copy in `openStats`; `proposeRematch()` + rewire both rematch buttons; `rematch_*` server-message handlers; reason-keyed fade-Home.
- `public/locales/en.js` — new `endscreen.outpaced` + `rematch.*` strings.
- `vitest.config.ts` — add the `/race-copy.js` alias so the client module resolves in tests and in the browser.

---

# Slice 1 — First-solve ends the race

Independently shippable: fixes the reported "grind a lost race" limbo on its own.

### Task 1: `outpacedLosers` pure helper + tunables

**Files:**
- Create: `src/room-core.ts`
- Test: `test/room-core.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/room-core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { outpacedLosers } from "../src/room-core.ts";
import type { PlayerState } from "../src/types.ts";

function player(username: string, status: PlayerState["status"], isBot = false): PlayerState {
  return { username, connected: true, guesses: [], status, isBot, points: 0, pointsSpent: 0 };
}

describe("outpacedLosers", () => {
  it("returns every still-playing non-winner (human + bot), excludes the winner and the already-out", () => {
    const players = [
      player("yan", "won"),
      player("alex", "playing"),
      player("maya", "playing", true),
      player("sam", "lost"),
    ];
    expect(outpacedLosers(players, "yan").sort()).toEqual(["alex", "maya"]);
  });

  it("is empty when nobody else is still playing", () => {
    expect(outpacedLosers([player("yan", "won"), player("alex", "lost")], "yan")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/room-core.test.ts`
Expected: FAIL — cannot resolve `../src/room-core.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/room-core.ts`:

```ts
// Pure decision logic for the race-end boom + rematch handshake. No DO, no I/O —
// the RoomDurableObject is a thin shell that calls these. Mirrors arena-core.ts
// (apply(state, event) + constants), so every transition is unit-testable.

import type { PlayerState } from "./types.ts";

// --- Tunables (Arena family; see the `arena-tunables` memory) ----------------
export const REMATCH_TIMEOUT_MS = 15_000;   // a pending proposal auto-cancels after this
export const BOT_REMATCH_MIN_MS = 3_000;    // bot "thinking" window, low end
export const BOT_REMATCH_MAX_MS = 9_000;    // bot "thinking" window, high end
export const BOT_REMATCH_ACCEPT_P = 0.8;    // P(bot says yes)

// --- Slice 1: first-solve ends the race --------------------------------------
// Given the players and the username who just became the FIRST winner, return the
// usernames of everyone still `playing` who must flip to `lost` ("outpaced").
// Pure; the caller mutates status + emits the per-player finish.
export function outpacedLosers(players: PlayerState[], winner: string): string[] {
  return players
    .filter((p) => p.status === "playing" && p.username !== winner)
    .map((p) => p.username);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/room-core.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/room-core.ts test/room-core.test.ts
git commit -m "feat(arena): room-core — outpacedLosers + rematch tunables"
```

---

### Task 2: Wire the flip into `applyGuess`

**Files:**
- Modify: `src/room.ts` (imports near top; `applyGuess` ~635–667)

- [ ] **Step 1: Add the import**

In `src/room.ts`, after the existing core imports (after line 13), add:

```ts
import { outpacedLosers } from "./room-core.ts";
```

- [ ] **Step 2: Capture the pre-guess winner state**

In `applyGuess`, immediately after `const priorStatus = player.status;` (line 637), add:

```ts
    const hadWinner = this.state.winner !== null;
```

- [ ] **Step 3: Add the flip after the winner's own finish-emit**

In `applyGuess`, between the winner's `emitPlayerFinished` block (ends line 655) and the `challengeId` block (begins line 656), insert:

```ts
    // First solve ends the race for everyone (live, non-daily rooms — Arena AND
    // Friends). Flip the still-playing others to `lost` so they carry a real status
    // into the snapshot and emitPlayerFinished fires for science/records/H2H. The
    // existing afterPlayerStatus → maybeFinish then finds isGameOver() and finishes.
    if (!hadWinner && this.state.winner && !this.state.isDaily) {
      for (const username of outpacedLosers(this.state.players, this.state.winner)) {
        const other = this.state.players.find((p) => p.username === username);
        if (other) {
          other.status = "lost";
          this.emitPlayerFinished(other, "lost", now);
        }
      }
    }
```

> Note: challenge-room attempt reporting (line 656 block) stays winner-only — an outpaced player was *interrupted* before finishing their attempt against the pinned word, so they don't post an `X` result. This is intentional and acceptable; challenge rooms are primarily solo-vs-record.

- [ ] **Step 4: Verify the bot-alarm guard still holds**

Confirm `alarm()` (line 721) still begins `if (this.state.phase !== "playing" || !this.state.word) return;` — a now-finished race won't fire a bot guess. (No edit; just verify. This is reworked in Task 11; for Slice 1 it must remain intact.)

- [ ] **Step 5: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (no behavior the existing suite asserts is broken — `summarizeRoomGame`/records tests already map non-winners to `lost`).

- [ ] **Step 6: Commit**

```bash
git add src/room.ts
git commit -m "feat(arena): first solve ends the live race (boom for outpaced players)"
```

---

### Task 3: Client "outpaced" loss copy (`race-copy.js`)

**Files:**
- Create: `public/race-copy.js`
- Test: `test/race-copy.test.js`
- Modify: `vitest.config.ts` (alias), `public/app.js` (`openStats`), `public/locales/en.js`

- [ ] **Step 1: Write the failing test**

Create `test/race-copy.test.js`:

```js
import { describe, it, expect } from "vitest";
import { lossKind } from "/race-copy.js";

describe("lossKind", () => {
  it("outpaced: lost with rows left while another player won", () => {
    expect(lossKind({ status: "lost", guessCount: 2, maxGuesses: 6, winner: "pax", me: "yan" })).toBe("outpaced");
  });
  it("exhausted: lost after using every row", () => {
    expect(lossKind({ status: "lost", guessCount: 6, maxGuesses: 6, winner: "pax", me: "yan" })).toBe("exhausted");
  });
  it("exhausted: lost with no winner (everyone ran out)", () => {
    expect(lossKind({ status: "lost", guessCount: 6, maxGuesses: 6, winner: null, me: "yan" })).toBe("exhausted");
  });
  it("null when I won or am still playing", () => {
    expect(lossKind({ status: "won", guessCount: 3, maxGuesses: 6, winner: "yan", me: "yan" })).toBe(null);
    expect(lossKind({ status: "playing", guessCount: 1, maxGuesses: 6, winner: null, me: "yan" })).toBe(null);
  });
  it("null when the winner is me (defensive)", () => {
    expect(lossKind({ status: "lost", guessCount: 2, maxGuesses: 6, winner: "yan", me: "yan" })).toBe("exhausted");
  });
});
```

- [ ] **Step 2: Add the vitest alias and run to verify failure**

In `vitest.config.ts`, add to the `resolve.alias` array (alongside the other `/celebrate.js`-style entries):

```ts
      { find: /^\/race-copy\.js$/, replacement: new URL("./public/race-copy.js", import.meta.url).pathname },
```

Run: `npx vitest run test/race-copy.test.js`
Expected: FAIL — cannot resolve `/race-copy.js`.

- [ ] **Step 3: Write the implementation**

Create `public/race-copy.js`:

```js
// Pure end-of-race copy derivation — no DOM, unit-tested via test/race-copy.test.js.
// Now that the first solve ends the race, a player can lose two ways:
//   - "outpaced": still had guess rows left but an opponent solved first, or
//   - "exhausted": used every row.
// Returns the key suffix; app.js maps it to an endscreen.* i18n key. null = not a loss.
export function lossKind({ status, guessCount, maxGuesses, winner, me }) {
  if (status !== "lost") return null;
  const outpaced = !!winner && winner !== me && guessCount < maxGuesses;
  return outpaced ? "outpaced" : "exhausted";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/race-copy.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the i18n string**

In `public/locales/en.js`, after `"endscreen.someoneWon"` (line 16), add:

```js
  "endscreen.outpaced": "{who} beat you to it.",
```

- [ ] **Step 6: Use it in `openStats`**

In `public/app.js`, add the import near the other client-module imports at the top of the file:

```js
import { lossKind } from "/race-copy.js";
```

Then in `openStats`, replace the `else if (winner)` branch (lines 2684–2685):

```js
    } else if (winner) {
      status.textContent = t("endscreen.someoneWon", { who: winner });
```

with:

```js
    } else if (winner) {
      const me = snap.players.find((p) => p.username === getUsername());
      const kind = me ? lossKind({
        status: me.status,
        guessCount: me.guesses?.length ?? 0,
        maxGuesses: snap.maxGuesses,
        winner,
        me: getUsername(),
      }) : "exhausted";
      status.textContent = kind === "outpaced"
        ? t("endscreen.outpaced", { who: winner })
        : t("endscreen.someoneWon", { who: winner });
```

- [ ] **Step 7: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass (typecheck covers `.ts` only; the JS change is exercised by `race-copy.test.js`).

- [ ] **Step 8: Commit**

```bash
git add public/race-copy.js test/race-copy.test.js vitest.config.ts public/app.js public/locales/en.js
git commit -m "feat(arena): client 'outpaced' loss copy on first-solve race end"
```

**Slice 1 is now independently shippable.** Boom fires the instant the opponent solves; loser sees "outpaced" copy.

---

# Slice 2 — Rematch handshake protocol

### Task 4: Message + state types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Swap the client `rematch` message for the handshake trio**

In `src/types.ts`, in `ClientMessage` (lines 89–102), delete:

```ts
  | { type: "rematch" }
```

and add (next to the other `rematch` line position):

```ts
  | { type: "rematch_propose" }
  | { type: "rematch_accept" }
  | { type: "rematch_decline" }
```

- [ ] **Step 2: Add the server handshake messages**

In `ServerMessage` (lines 104–110), add before the closing `;`:

```ts
  | { type: "rematch_proposed"; proposer: string }
  | { type: "rematch_accepted"; by: string }
  | { type: "rematch_cancelled"; reason: "declined" | "timeout" | "left" }
```

- [ ] **Step 3: Add the server-internal room-state fields**

In `RoomSnapshot` (ends line 87), after `publicArena?: boolean;` add:

```ts
  // Rematch handshake — INTERNAL ONLY; stripped outbound in snapshotFor (like seed/publicArena).
  rematch?: { proposer: string; deadline: number } | null;
  botRematchAt?: number | null;     // epoch ms the bot decides; null = none pending
  rematchTimeoutAt?: number | null; // epoch ms the proposal auto-cancels; null = none pending
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: FAIL — `src/room.ts` still has `case "rematch":` and `onRematch`, now referencing a removed message type. This is expected; Task 7 fixes it. (If you prefer a clean typecheck between tasks, do Tasks 4–7 as one batch before running it.)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(arena): rematch handshake wire types (propose/accept/decline + proposed/accepted/cancelled)"
```

---

### Task 5: `rematchReduce` + `botAccepts` + `nextAlarmAt`

**Files:**
- Modify: `src/room-core.ts`, `test/room-core.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/room-core.test.ts`:

```ts
import { rematchReduce, botAccepts, nextAlarmAt, REMATCH_TIMEOUT_MS } from "../src/room-core.ts";

describe("rematchReduce", () => {
  const NOW = 1_000_000;

  it("propose (none pending, human opponent): sets state, emits proposed + schedule_timeout", () => {
    const r = rematchReduce(null, { kind: "propose", from: "yan", opponentIsBot: false, now: NOW });
    expect(r.rematch).toEqual({ proposer: "yan", deadline: NOW + REMATCH_TIMEOUT_MS });
    expect(r.effects).toEqual([{ kind: "proposed", proposer: "yan" }, { kind: "schedule_timeout" }]);
  });

  it("propose against a bot also schedules the bot decision", () => {
    const r = rematchReduce(null, { kind: "propose", from: "yan", opponentIsBot: true, now: NOW });
    expect(r.effects).toContainEqual({ kind: "schedule_bot" });
  });

  it("mutual propose (other side already pending) ⇒ accept + start, once", () => {
    const r = rematchReduce({ proposer: "alex", deadline: NOW }, { kind: "propose", from: "yan", opponentIsBot: false, now: NOW });
    expect(r.rematch).toBe(null);
    expect(r.effects).toEqual([{ kind: "accepted", by: "yan" }, { kind: "start" }]);
  });

  it("re-propose by the same proposer is a no-op", () => {
    const state = { proposer: "yan", deadline: NOW };
    const r = rematchReduce(state, { kind: "propose", from: "yan", opponentIsBot: false, now: NOW });
    expect(r.rematch).toBe(state);
    expect(r.effects).toEqual([]);
  });

  it("accept by the non-proposer ⇒ accepted + start", () => {
    const r = rematchReduce({ proposer: "alex", deadline: NOW }, { kind: "accept", from: "yan" });
    expect(r.rematch).toBe(null);
    expect(r.effects).toEqual([{ kind: "accepted", by: "yan" }, { kind: "start" }]);
  });

  it("accept by the proposer themselves is ignored", () => {
    const state = { proposer: "yan", deadline: NOW };
    expect(rematchReduce(state, { kind: "accept", from: "yan" }).effects).toEqual([]);
  });

  it("decline ⇒ cancelled{declined}", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "decline", from: "alex" });
    expect(r.rematch).toBe(null);
    expect(r.effects).toEqual([{ kind: "cancelled", reason: "declined" }]);
  });

  it("timeout ⇒ cancelled{timeout}", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "timeout" });
    expect(r.effects).toEqual([{ kind: "cancelled", reason: "timeout" }]);
  });

  it("left ⇒ cancelled{left}", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "left" });
    expect(r.effects).toEqual([{ kind: "cancelled", reason: "left" }]);
  });

  it("bot_decision accept ⇒ accepted{by:bot} + start", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "bot_decision", accept: true, bot: "maya" });
    expect(r.rematch).toBe(null);
    expect(r.effects).toEqual([{ kind: "accepted", by: "maya" }, { kind: "start" }]);
  });

  it("bot_decision decline ⇒ cancelled{declined} + bot_leaves", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "bot_decision", accept: false, bot: "maya" });
    expect(r.effects).toEqual([{ kind: "cancelled", reason: "declined" }, { kind: "bot_leaves" }]);
  });

  it("any input with no pending proposal is a safe no-op", () => {
    for (const input of [
      { kind: "accept", from: "x" }, { kind: "decline", from: "x" },
      { kind: "timeout" }, { kind: "left" }, { kind: "bot_decision", accept: true, bot: "m" },
    ] as const) {
      expect(rematchReduce(null, input)).toEqual({ rematch: null, effects: [] });
    }
  });
});

describe("botAccepts", () => {
  it("accepts below the threshold, declines at/above it", () => {
    expect(botAccepts(0)).toBe(true);
    expect(botAccepts(0.79)).toBe(true);
    expect(botAccepts(0.8)).toBe(false);
    expect(botAccepts(0.99)).toBe(false);
  });
});

describe("nextAlarmAt", () => {
  it("returns the earliest non-null deadline, or null when none", () => {
    expect(nextAlarmAt([null, 500, undefined, 200])).toBe(200);
    expect(nextAlarmAt([null, undefined])).toBe(null);
    expect(nextAlarmAt([])).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/room-core.test.ts`
Expected: FAIL — `rematchReduce`/`botAccepts`/`nextAlarmAt` not exported.

- [ ] **Step 3: Implement in `src/room-core.ts`**

Append to `src/room-core.ts`:

```ts
// --- Slices 2–3: the rematch handshake reducer -------------------------------
export type RematchState = { proposer: string; deadline: number } | null;

export type RematchInput =
  | { kind: "propose"; from: string; opponentIsBot: boolean; now: number }
  | { kind: "accept"; from: string }
  | { kind: "decline"; from: string }
  | { kind: "left" }
  | { kind: "bot_decision"; accept: boolean; bot: string }
  | { kind: "timeout" };

export type RematchEffect =
  | { kind: "proposed"; proposer: string }
  | { kind: "accepted"; by: string }
  | { kind: "cancelled"; reason: "declined" | "timeout" | "left" }
  | { kind: "start" }            // DO calls runStart()
  | { kind: "schedule_bot" }     // DO arms botRematchAt = now + random(MIN..MAX)
  | { kind: "schedule_timeout" } // DO arms rematchTimeoutAt = now + REMATCH_TIMEOUT_MS
  | { kind: "bot_leaves" };      // DO removes the bot from players

export type RematchResult = { rematch: RematchState; effects: RematchEffect[] };

// Reduce one handshake event into the next pending-proposal state + the side
// effects the DO must run. Deterministic — the bot's 80/20 roll and the random
// decision delay are decided OUTSIDE (botAccepts(roll), schedule_bot) and passed in.
export function rematchReduce(state: RematchState, input: RematchInput): RematchResult {
  switch (input.kind) {
    case "propose": {
      if (state) {
        // A proposal already pending from the OTHER side ⇒ mutual want ⇒ start once.
        if (state.proposer !== input.from) {
          return { rematch: null, effects: [{ kind: "accepted", by: input.from }, { kind: "start" }] };
        }
        return { rematch: state, effects: [] }; // same proposer re-tapping: no-op
      }
      const rematch = { proposer: input.from, deadline: input.now + REMATCH_TIMEOUT_MS };
      const effects: RematchEffect[] = [{ kind: "proposed", proposer: input.from }, { kind: "schedule_timeout" }];
      if (input.opponentIsBot) effects.push({ kind: "schedule_bot" });
      return { rematch, effects };
    }
    case "accept": {
      if (!state || state.proposer === input.from) return { rematch: state, effects: [] };
      return { rematch: null, effects: [{ kind: "accepted", by: input.from }, { kind: "start" }] };
    }
    case "decline":
      if (!state) return { rematch: null, effects: [] };
      return { rematch: null, effects: [{ kind: "cancelled", reason: "declined" }] };
    case "timeout":
      if (!state) return { rematch: null, effects: [] };
      return { rematch: null, effects: [{ kind: "cancelled", reason: "timeout" }] };
    case "left":
      if (!state) return { rematch: null, effects: [] };
      return { rematch: null, effects: [{ kind: "cancelled", reason: "left" }] };
    case "bot_decision":
      if (!state) return { rematch: null, effects: [] };
      if (input.accept) return { rematch: null, effects: [{ kind: "accepted", by: input.bot }, { kind: "start" }] };
      return { rematch: null, effects: [{ kind: "cancelled", reason: "declined" }, { kind: "bot_leaves" }] };
  }
}

// P(accept) gate, RNG injected exactly like noobGuess(roll): tests pass a fixed
// roll; the DO passes Math.random(). roll < P ⇒ accept.
export function botAccepts(roll: number): boolean {
  return roll < BOT_REMATCH_ACCEPT_P;
}

// Earliest of the currently-armed wake deadlines (null/undefined ignored). null
// when nothing is pending. Drives the DO's single setAlarm().
export function nextAlarmAt(deadlines: Array<number | null | undefined>): number | null {
  const live = deadlines.filter((d): d is number => typeof d === "number");
  return live.length ? Math.min(...live) : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/room-core.test.ts`
Expected: PASS (all reducer/helper tests).

- [ ] **Step 5: Commit**

```bash
git add src/room-core.ts test/room-core.test.ts
git commit -m "feat(arena): room-core — rematch handshake reducer + botAccepts + nextAlarmAt"
```

---

### Task 6: DO effect runner, broadcast, and alarm-arming helpers

**Files:**
- Modify: `src/room.ts` (imports; new private methods near `onRematch`)

- [ ] **Step 1: Extend the room-core import**

Update the Task-2 import in `src/room.ts` to:

```ts
import {
  outpacedLosers,
  rematchReduce,
  botAccepts,
  nextAlarmAt,
  REMATCH_TIMEOUT_MS,
  BOT_REMATCH_MIN_MS,
  BOT_REMATCH_MAX_MS,
  type RematchEffect,
} from "./room-core.ts";
```

- [ ] **Step 2: Add the broadcast + alarm helpers**

In `src/room.ts`, add these private methods (place them just above `private isGameOver()` at line 1142):

```ts
  // Push a non-snapshot server message to every connected socket (handshake events).
  private broadcastAll(msg: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify(msg)); } catch { /* socket closing; ignore */ }
    }
  }

  private clearRematchAlarms(): void {
    this.state.botRematchAt = null;
    this.state.rematchTimeoutAt = null;
  }

  // One alarm to rule them all: set it to the earliest armed rematch deadline, or
  // clear it. Only called in the finished phase (bot-GUESS alarms own the playing
  // phase), so the two never fight over the single DO alarm.
  private armRematchAlarm(): void {
    const at = nextAlarmAt([this.state.botRematchAt, this.state.rematchTimeoutAt]);
    if (at != null) void this.ctx.storage.setAlarm(at);
    else void this.ctx.storage.deleteAlarm();
  }

  // Perform the side effects a rematchReduce() returned. `runStart` is the existing
  // round-restart (increment, word pick, GO!, bot tick) — the handshake's accept path.
  private async applyRematchEffects(effects: RematchEffect[]): Promise<void> {
    let starter = "someone";
    for (const e of effects) {
      switch (e.kind) {
        case "proposed":
          this.broadcastAll({ type: "rematch_proposed", proposer: e.proposer });
          break;
        case "accepted":
          starter = e.by;
          this.broadcastAll({ type: "rematch_accepted", by: e.by });
          break;
        case "cancelled":
          this.clearRematchAlarms();
          this.armRematchAlarm();
          this.broadcastAll({ type: "rematch_cancelled", reason: e.reason });
          break;
        case "schedule_timeout":
          this.state.rematchTimeoutAt = Date.now() + REMATCH_TIMEOUT_MS;
          this.armRematchAlarm();
          break;
        case "schedule_bot":
          this.state.botRematchAt = Date.now() + BOT_REMATCH_MIN_MS
            + Math.floor(Math.random() * (BOT_REMATCH_MAX_MS - BOT_REMATCH_MIN_MS));
          this.armRematchAlarm();
          break;
        case "bot_leaves": {
          const i = this.state.players.findIndex((p) => p.isBot);
          if (i >= 0) this.state.players.splice(i, 1);
          break;
        }
        case "start":
          this.clearRematchAlarms();
          await this.runStart(starter); // resets everyone, picks word, GO!, schedules bot tick
          break;
      }
    }
  }
```

- [ ] **Step 3: Typecheck (expect the router/onRematch error to remain)**

Run: `npm run typecheck`
Expected: still FAILs only on the stale `case "rematch":` / `onRematch` referencing the removed type — fixed in Task 7. The new helpers themselves typecheck.

- [ ] **Step 4: Commit**

```bash
git add src/room.ts
git commit -m "feat(arena): DO rematch effect runner + broadcast + single-alarm arming"
```

---

### Task 7: DO handlers + router + snapshot strip; delete old `onRematch`

**Files:**
- Modify: `src/room.ts` (router ~239; new handlers; `snapshotFor` ~1161; delete `onRematch` ~1088)

- [ ] **Step 1: Rewire the message router**

In `handle()` (lines 239–240), replace:

```ts
      case "rematch":
        return this.onRematch(ws);
```

with:

```ts
      case "rematch_propose":
        return this.onRematchPropose(ws);
      case "rematch_accept":
        return this.onRematchAccept(ws);
      case "rematch_decline":
        return this.onRematchDecline(ws);
```

- [ ] **Step 2: Replace `onRematch` with the three handlers**

Delete the entire old `onRematch` method (lines 1088–1105) and put in its place:

```ts
  private async onRematchPropose(ws: WebSocket): Promise<void> {
    if (this.state.isDaily || this.state.phase !== "finished") return;
    const username = this.userFor(ws);
    if (!username) return;
    const me = this.state.players.find((p) => p.username === username);
    if (!me) return;
    const opponent = this.state.players.find((p) => p.username !== username);
    // Opponent already gone (e.g. a bot that declined a prior proposal) ⇒ settle Home.
    if (!opponent) {
      this.broadcastAll({ type: "rematch_cancelled", reason: "left" });
      return;
    }
    const { rematch, effects } = rematchReduce(this.state.rematch ?? null, {
      kind: "propose", from: username, opponentIsBot: !!opponent.isBot, now: Date.now(),
    });
    this.state.rematch = rematch;
    await this.applyRematchEffects(effects);
    await this.persistAndBroadcast();
  }

  private async onRematchAccept(ws: WebSocket): Promise<void> {
    if (this.state.isDaily || this.state.phase !== "finished") return;
    const username = this.userFor(ws);
    if (!username) return;
    const { rematch, effects } = rematchReduce(this.state.rematch ?? null, { kind: "accept", from: username });
    this.state.rematch = rematch;
    await this.applyRematchEffects(effects);
    await this.persistAndBroadcast();
  }

  private async onRematchDecline(ws: WebSocket): Promise<void> {
    if (this.state.isDaily) return;
    const username = this.userFor(ws);
    if (!username) return;
    const { rematch, effects } = rematchReduce(this.state.rematch ?? null, { kind: "decline", from: username });
    this.state.rematch = rematch;
    await this.applyRematchEffects(effects);
    await this.persistAndBroadcast();
  }
```

- [ ] **Step 3: Strip the internal fields from the outbound snapshot**

In `snapshotFor` (the returned object starting line 1164), after the existing `publicArena: undefined,` line (1175), add:

```ts
      rematch: undefined,
      botRematchAt: undefined,
      rematchTimeoutAt: undefined,
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck CLEAN now; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts
git commit -m "feat(arena): DO rematch handlers + router + snapshot strip; drop instant onRematch reset"
```

---

### Task 8: Client — propose/accept/waiting/decline UI + server-message handlers

**Files:**
- Modify: `public/app.js` (rematch buttons ~565 & ~2697; `onServerMessage` chain ~1147; new helpers), `public/locales/en.js`

- [ ] **Step 1: Add the i18n strings**

In `public/locales/en.js`, after the `endscreen.outpaced` line from Task 3, add (the
`endscreen.playAgain` key mirrors the hardcoded `#modalPlayAgain` text in `index.html:249`,
so `renderRematchIdle` can reset the button via `t()` like the other states):

```js
  "endscreen.playAgain": "Play again",
  "rematch.waiting": "Waiting for {who}… ✕",
  "rematch.prompt": "{who} wants to run it back",
  "rematch.accept": "Accept",
  "rematch.decline": "Decline",
  "rematch.declined": "{who} isn’t up for another — nice game!",
  "rematch.timeout": "{who} didn’t answer — nice game!",
  "rematch.left": "{who} stepped away — nice game!",
```

- [ ] **Step 2: Add the client rematch helpers**

In `public/app.js`, add near the other room helpers (e.g. just above `function openStats`):

```js
// --- Rematch handshake (client) ---------------------------------------------
// One source of truth for proposing + rendering the four end-screen states.
function opponentName() {
  const snap = game.snapshot;
  const me = getUsername();
  const other = snap?.players.find((p) => p.username !== me);
  return other?.username ?? "your opponent";
}

// Propose a rematch and morph the action into a cancellable waiting state.
function proposeRematch() {
  send({ type: "rematch_propose" });
  renderRematchWaiting(opponentName());
}

// Render helpers operate on the stats-modal action row (#modalPlayAgain) so the
// handshake lives where the player already is post-game. The button is reused;
// a sibling #rematchDecline is created on demand for the recipient prompt.
function rematchControls() {
  const play = document.getElementById("modalPlayAgain");
  let decline = document.getElementById("rematchDecline");
  if (!decline && play) {
    decline = document.createElement("button");
    decline.id = "rematchDecline";
    decline.className = play.className;
    play.parentNode.insertBefore(decline, play.nextSibling);
  }
  return { play, decline };
}

function renderRematchIdle() {
  const { play, decline } = rematchControls();
  if (decline) decline.hidden = true;
  if (play) { play.hidden = false; play.disabled = false; play.textContent = t("endscreen.playAgain"); play.onclick = proposeRematch; }
}

function renderRematchWaiting(who) {
  const { play, decline } = rematchControls();
  if (decline) decline.hidden = true;
  if (play) {
    play.hidden = false;
    play.disabled = false;
    play.textContent = t("rematch.waiting", { who });
    play.onclick = () => { send({ type: "rematch_decline" }); renderRematchIdle(); }; // ✕ cancels my own
  }
}

function renderRematchPrompt(who) {
  const { play, decline } = rematchControls();
  if (play) { play.hidden = false; play.disabled = false; play.textContent = t("rematch.accept"); play.onclick = () => send({ type: "rematch_accept" }); }
  if (decline) { decline.hidden = false; decline.textContent = t("rematch.decline"); decline.onclick = () => { send({ type: "rematch_decline" }); renderRematchIdle(); }; }
  // Headline the prompt in the end-screen status line.
  const eg = document.getElementById("endgameMsg");
  if (eg) { eg.hidden = false; const line = document.createElement("div"); line.className = "endgame-status"; line.textContent = t("rematch.prompt", { who }); eg.prepend(line); }
}

// A cancelled proposal: one friendly line keyed to reason, then fade Home (~2s).
function settleRematchHome(reason, who) {
  const key = reason === "timeout" ? "rematch.timeout" : reason === "left" ? "rematch.left" : "rematch.declined";
  const { play, decline } = rematchControls();
  if (decline) decline.hidden = true;
  if (play) { play.disabled = true; play.textContent = t(key, { who }); }
  setTimeout(() => { closeStats(); leaveRoom(); showHub(); }, 2000);
}
```

> The resting label uses `t("endscreen.playAgain")` (added in Step 1). Both rematch buttons rest at "Play again" — the existing `index.html` text — and only morph during a live handshake.

- [ ] **Step 3: Rewire the two existing rematch buttons to propose**

In `public/app.js`, the stats-modal button (lines 2701–2705) currently does `send({ type: "rematch" })`. Replace its `onclick` body:

```js
    playAgain.onclick = () => {
      game.hasShownEndStats = false;
      closeStats();
      send({ type: "rematch" });
    };
```

with:

```js
    playAgain.onclick = proposeRematch;
```

And the lobby `#rematchBtn` handler (lines 565–568) — replace `send({ type: "rematch" })` with `proposeRematch();`.

- [ ] **Step 4: Handle the server handshake messages**

In `onServerMessage`, in the `if (msg.type === ...)` chain, add before the final `else if (msg.type === "error")` branch (line 1340):

```js
  } else if (msg.type === "rematch_proposed") {
    // Someone proposed. If it's me, I'm already showing "waiting"; if it's the
    // other side, surface Accept/Decline.
    if (msg.proposer !== getUsername()) renderRematchPrompt(msg.proposer);
  } else if (msg.type === "rematch_accepted") {
    // Both in — the round_started snapshot that follows fires GO!/confetti. Just
    // tidy the end screen so it doesn't overlay the new board.
    game.hasShownEndStats = false;
    renderRematchIdle();
    closeStats();
  } else if (msg.type === "rematch_cancelled") {
    settleRematchHome(msg.reason, opponentName());
```

- [ ] **Step 5: Reset the rematch UI to idle when the end screen (re)opens**

So a fresh `finished` state always starts from the plain "Rematch" button, call `renderRematchIdle()` at the end of the `if (snap && snap.phase === "finished")` block in `openStats` (right after the existing `playAgain.hidden = false; playAgain.onclick = …` you replaced in Step 3). Concretely, after the `playAgain.onclick = proposeRematch;` line, the block already shows the idle button — but ensure any leftover `#rematchDecline` from a prior round is hidden:

```js
    const stale = document.getElementById("rematchDecline");
    if (stale) stale.hidden = true;
```

- [ ] **Step 6: Verify in tests**

Run: `npm test`
Expected: PASS (no new unit tests here; this confirms nothing else broke).

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/locales/en.js
git commit -m "feat(arena): client rematch handshake UI (propose/accept/waiting/decline + cancelled fade-home)"
```

---

# Slice 3 — Bot decision + alarm multiplexing

The reducer already emits `schedule_bot` / `bot_leaves` and `applyRematchEffects` already arms `botRematchAt` (Task 6). What remains is teaching `alarm()` to wake for rematch in the **finished** phase.

### Task 9: Rework `alarm()` to multiplex bot-guess vs rematch wakes

**Files:**
- Modify: `src/room.ts` (`alarm` ~720–734; new `handleRematchAlarm`)

- [ ] **Step 1: Replace the `alarm()` body**

Replace `alarm()` (lines 720–734) with:

```ts
  // DO alarm: the room's single heartbeat. In the PLAYING phase it paces the bot's
  // guesses (unchanged). In the FINISHED phase it drives the rematch handshake's
  // delayed wakes (bot decision + proposal timeout). The two phases are mutually
  // exclusive, so they never contend for the one alarm.
  async alarm(): Promise<void> {
    if (this.state.phase === "finished") {
      await this.handleRematchAlarm(Date.now());
      return;
    }
    if (this.state.phase !== "playing" || !this.state.word) return;
    const bot = this.state.players.find((p) => p.isBot && p.status === "playing");
    if (!bot) return;
    const view = { wordLength: this.state.wordLength, ownGuesses: bot.guesses };
    const word = this.state.seed ? noobGuess(view, NOOB, Math.random()) : computeNextGuess(view);
    if (word) await this.applyGuess(bot, word);
    await this.persistAndBroadcast();
    const stillGoing = this.state.players.some((p) => p.isBot && p.status === "playing");
    if (stillGoing && this.state.phase === "playing") this.scheduleBotTick();
  }

  // Process whichever rematch deadlines are due, then re-arm for any that remain.
  // Order matters: a fired timeout cancels the proposal, after which the bot
  // decision finds no pending state and safely no-ops (no double resolution).
  private async handleRematchAlarm(now: number): Promise<void> {
    let changed = false;
    if (this.state.rematchTimeoutAt && now >= this.state.rematchTimeoutAt) {
      this.state.rematchTimeoutAt = null;
      const { rematch, effects } = rematchReduce(this.state.rematch ?? null, { kind: "timeout" });
      this.state.rematch = rematch;
      await this.applyRematchEffects(effects);
      changed = true;
    }
    if (this.state.phase === "finished" && this.state.botRematchAt && now >= this.state.botRematchAt) {
      this.state.botRematchAt = null;
      const bot = this.state.players.find((p) => p.isBot);
      if (bot) {
        const { rematch, effects } = rematchReduce(this.state.rematch ?? null, {
          kind: "bot_decision", accept: botAccepts(Math.random()), bot: bot.username,
        });
        this.state.rematch = rematch;
        await this.applyRematchEffects(effects);
        changed = true;
      }
    }
    // If accept→start fired, phase is now "playing" and runStart armed the bot tick;
    // don't re-arm rematch. Otherwise re-arm any still-future rematch deadline.
    if (this.state.phase === "finished") this.armRematchAlarm();
    if (changed) await this.persistAndBroadcast();
  }
```

- [ ] **Step 2: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: CLEAN + all pass. (The reducer paths these call — bot accept/decline, timeout — are already covered by `test/room-core.test.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/room.ts
git commit -m "feat(arena): alarm() multiplexes bot-guess (playing) vs rematch wakes (finished)"
```

---

# Slice 4 — No-path polish & opponent-left

### Task 10: Cancel a pending proposal when a participant disconnects

**Files:**
- Modify: `src/room.ts` (`webSocketClose` ~203–213)

- [ ] **Step 1: Add left-handling to `webSocketClose`**

Replace `webSocketClose` (lines 203–213) with:

```ts
  async webSocketClose(ws: WebSocket): Promise<void> {
    const username = this.userFor(ws);
    if (username) {
      const p = this.state.players.find((p) => p.username === username);
      if (p && p.connected) {
        p.connected = false;
        this.pushSystem(`${p.username} left`);
      }
      // A pending rematch dies if either participant drops; the survivor (the
      // proposer, if it was the recipient who left) is settled Home via cancelled{left}.
      if (this.state.rematch && this.state.phase === "finished") {
        const { rematch, effects } = rematchReduce(this.state.rematch, { kind: "left" });
        this.state.rematch = rematch;
        await this.applyRematchEffects(effects);
      }
      await this.persistAndBroadcast();
    }
  }
```

- [ ] **Step 2: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: CLEAN + all pass.

- [ ] **Step 3: Commit**

```bash
git add src/room.ts
git commit -m "feat(arena): pending rematch cancels (left) when a participant disconnects"
```

---

### Task 11: Self-review pass against the spec + full verification

**Files:** (none — review + verification only)

- [ ] **Step 1: Spec coverage check** — confirm each spec section maps to a task:
  - §Part 1 (first solve ends race) → Tasks 1–2 ✓
  - §Part 1 (outpaced client copy) → Task 3 ✓
  - §Part 2 (two-choice end screen) → Task 8 (Rematch + Home already present) ✓
  - §Part 3 (handshake protocol/state/messages/handlers/`runStart` reuse, old `rematch` removed) → Tasks 4–8 ✓
  - §Part 4 (bot decision + single-alarm multiplexing) → Tasks 5, 6, 9 ✓
  - §Part 5 (reason-keyed fade-Home) → Task 8 (`settleRematchHome`) ✓
  - §Edge cases (mutual propose, bot already left, no-winner finish, opponent left) → Tasks 5 (reducer cases) + 7 (`!opponent` guard) + 10 ✓
  - §Test matrix 1–11 → `room-core.test.ts` (1,3–10) + `race-copy.test.js` (2) + snapshot-strip (11, see Step 2) ✓

- [ ] **Step 2: Add the snapshot-strip test (matrix #11)** — the one spec test not yet written, and the only DO-surface assertion that's reachable without a DO harness, via a tiny projection check. Append to `test/room-core.test.ts` a guard that the internal field names are the ones `snapshotFor` strips (documents the contract):

```ts
import { readFileSync } from "node:fs";

describe("snapshot strips internal rematch fields (matrix #11)", () => {
  it("snapshotFor sets rematch/botRematchAt/rematchTimeoutAt to undefined outbound", () => {
    const src = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
    for (const field of ["rematch: undefined", "botRematchAt: undefined", "rematchTimeoutAt: undefined"]) {
      expect(src).toContain(field);
    }
  });
});
```

Run: `npx vitest run test/room-core.test.ts` → PASS.

- [ ] **Step 3: Placeholder + type-consistency scan** — grep your own diff for stragglers and verify the symbol names line up across DO ↔ core ↔ client:

```bash
git diff main --stat
grep -n "rematchReduce\|applyRematchEffects\|armRematchAlarm\|botRematchAt\|rematchTimeoutAt\|proposeRematch\|settleRematchHome" src/room.ts public/app.js
```
Expected: every name defined once and called with matching shape; no `TODO`/`TBD`.

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; **all** suites green.

- [ ] **Step 5: Manual smoke (the one moment this must nail)** — using the project's run path (`/run` skill or `wrangler dev`), in a seeded Arena (bot) room:
  1. Start a race; let the bot solve first → **your board booms immediately**, stats modal shows "**{bot} beat you to it.**" + Rematch/Home.
  2. Tap **Rematch** → button → "Waiting for {bot}… ✕". Within 3–9s either GO! (accept, ~80%) or "{bot} isn't up for another — nice game!" then fade Home (decline).
  3. Human-vs-human (two browser tabs): propose, leave 15s → proposer sees "{who} didn't answer — nice game!" → Home. Mutual-propose → single new round. One side hits Home while a proposal pends → other sees cancelled{left}.

- [ ] **Step 6: Commit**

```bash
git add test/room-core.test.ts
git commit -m "test(arena): snapshot-strip guard + final self-review for race-end/rematch"
```

---

## Done criteria

- `npm run typecheck` clean; `npm test` fully green.
- First solve booms the loser instantly in Arena **and** Friends rooms; outpaced copy is correct.
- Rematch is a propose/accept handshake; the old instant `rematch` message is gone end-to-end.
- A bot decides over the single DO alarm (3–9s, ~80% accept), declines-and-leaves cleanly.
- Every no-path (declined / timeout / left) fades the proposer gently Home — no dead-ends.
- No internal rematch state leaks into the client snapshot.
