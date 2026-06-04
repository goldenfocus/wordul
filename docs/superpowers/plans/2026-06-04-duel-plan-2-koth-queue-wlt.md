# Duel Plan 2 — 1v1 Seats + Challenge Queue + King-of-the-Hill + W/L/T Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the room into a 1v1 King-of-the-Hill arena: exactly two **duelists** play at a time, everyone else waits in a **challenge queue** and watches live; when a round ends the winner keeps the **throne** (with a win streak), the loser drops to the back of the queue, and the next challenger rotates in. Each player carries a per-room **W / L / T** record.

**Architecture:** Builds directly on Plan 1 (ready gate + countdown). Pure seat/rotation logic goes in a new dependency-free `src/rotation.ts` (unit-tested), and the per-room tally in `src/scoreboard.ts` gains losses + ties. The Room Durable Object scopes all game logic (ready gate, board reset, guessing, game-over, finish) to the two `role: "duelist"` players; queued players are spectators. KOTH rotation runs on the finished→lobby transition (rematch). The client renders only duelist boards plus a queue strip, a throne badge, and the W/L/T scoreboard.

**Tech Stack:** TypeScript, Cloudflare Durable Objects, vanilla-JS SPA, Vitest. `npm run typecheck`, `npm test`.

**Scope note:** `rotation` ships as a field defaulting to `"koth"` — KOTH is the only behavior in this plan. The `"host"` value + its picker UI is Plan 2b. Waiting-vibe / match-me / worduler cover is Plan 3. Spec: `docs/superpowers/specs/2026-06-04-duel-invite-ready-countdown-design.md`.

**Tie semantics (locked for this plan):** a "tie" is a round where **no one solved** (`winner === null`) — the natural tie in a speed race. Both duelists get +T. (Equal-guess-count ties aren't a thing here: the race winner is whoever greens first.)

**Known limitations (acceptable for this slice, noted for review):**
- A disconnected duelist keeps their seat (so a new joiner queues). If *both* duelists vanish while a queued player waits, the room can't start until someone reconnects — rare; revisit if it bites.
- Queued players who disconnect keep their queue spot (so a reconnect resumes it).

---

## File Structure

- **Create** `src/rotation.ts` — pure seat assignment (`nextSeatRole`) + KOTH advance (`applyKothRotation`) + `MAX_DUELISTS`. No Cloudflare deps.
- **Create** `test/rotation.test.ts` — unit tests.
- **Modify** `src/scoreboard.ts` — `RoomScore` gains `losses`+`ties`; `bumpScoreboard` records W/L/T.
- **Modify** `test/scoreboard.test.ts` — update expectations + add loss/tie cases.
- **Modify** `src/types.ts` — `PlayerState.role`; `RoomSnapshot.rotation`/`queue`/`throne`.
- **Modify** `src/room.ts` — seat assignment, duelist-scoped game logic, KOTH rotation on rematch, W/L/T finish, role-gated word reveal.
- **Modify** `public/index.html` — add `#queueStrip` element to `tpl-room`.
- **Modify** `public/app.js` — render only duelist boards, queue strip, throne badge, W/L/T scoreboard, spectator/challenger lobby UI.
- **Modify** `public/style.css` — queue strip + throne badge styles (additive).

---

## Task 1: Pure seat + rotation logic (`src/rotation.ts`)

**Files:**
- Create: `src/rotation.ts`
- Test: `test/rotation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/rotation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextSeatRole, applyKothRotation, MAX_DUELISTS } from "../src/rotation.ts";

describe("nextSeatRole", () => {
  it("seats the first two as duelists, then queues", () => {
    expect(nextSeatRole([])).toBe("duelist");
    expect(nextSeatRole([{ role: "duelist" }])).toBe("duelist");
    expect(nextSeatRole([{ role: "duelist" }, { role: "duelist" }])).toBe("queued");
  });
  it("counts duelist seats by role even if more queued exist", () => {
    expect(nextSeatRole([{ role: "duelist" }, { role: "queued" }])).toBe("duelist");
  });
  it("exposes a two-seat duel", () => {
    expect(MAX_DUELISTS).toBe(2);
  });
});

describe("applyKothRotation", () => {
  it("winner keeps the throne; loser goes to back of queue; front steps up", () => {
    const r = applyKothRotation({ duelists: ["king", "loser"], winner: "king", queue: ["next"], throne: { username: "king", streak: 1 } });
    expect(r.duelists).toEqual(["king", "next"]);
    expect(r.queue).toEqual(["loser"]);
    expect(r.throne).toEqual({ username: "king", streak: 2 });
  });
  it("a new winner takes the throne with streak 1", () => {
    const r = applyKothRotation({ duelists: ["king", "chal"], winner: "chal", queue: [], throne: { username: "king", streak: 3 } });
    expect(r.duelists).toEqual(["chal", "king"]); // empty queue → rematch, champ first
    expect(r.throne).toEqual({ username: "chal", streak: 1 });
  });
  it("empty queue → the same two rematch", () => {
    const r = applyKothRotation({ duelists: ["a", "b"], winner: "a", queue: [], throne: null });
    expect(r.duelists).toEqual(["a", "b"]);
    expect(r.queue).toEqual([]);
    expect(r.throne).toEqual({ username: "a", streak: 1 });
  });
  it("tie with a reigning king: king holds, challenger to back, front steps up", () => {
    const r = applyKothRotation({ duelists: ["king", "chal"], winner: null, queue: ["next"], throne: { username: "king", streak: 2 } });
    expect(r.duelists).toEqual(["king", "next"]);
    expect(r.queue).toEqual(["chal"]);
    expect(r.throne).toEqual({ username: "king", streak: 2 }); // unchanged on a tie
  });
  it("tie with no reigning king → rematch, no throne", () => {
    const r = applyKothRotation({ duelists: ["a", "b"], winner: null, queue: ["c"], throne: null });
    expect(r.duelists).toEqual(["a", "b"]);
    expect(r.queue).toEqual(["c"]);
    expect(r.throne).toBe(null);
  });
  it("fewer than two duelists (solo) is returned unchanged", () => {
    const r = applyKothRotation({ duelists: ["solo"], winner: "solo", queue: [], throne: null });
    expect(r.duelists).toEqual(["solo"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- rotation`
Expected: FAIL — `Failed to resolve import "../src/rotation.ts"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/rotation.ts`:

```ts
// src/rotation.ts — pure 1v1 seat + king-of-the-hill rotation (no Cloudflare deps).

export const MAX_DUELISTS = 2;

export type Throne = { username: string; streak: number } | null;

/** Seat for a newly joining player: a duelist seat while fewer than two are taken
 *  (by role — a disconnected duelist still holds their seat), otherwise the queue. */
export function nextSeatRole(players: { role: "duelist" | "queued" }[]): "duelist" | "queued" {
  const taken = players.filter((p) => p.role === "duelist").length;
  return taken < MAX_DUELISTS ? "duelist" : "queued";
}

export type KothInput = {
  duelists: string[];     // current duelist usernames (rotation only acts when there are two)
  winner: string | null;  // round winner, or null for a tie (nobody solved)
  queue: string[];        // waiting usernames, front = next challenger
  throne: Throne;
};
export type KothResult = { duelists: string[]; queue: string[]; throne: Throne };

/** King-of-the-hill advance, applied when a round ends. Winner keeps the throne
 *  (streak grows; a new winner resets it to 1); the loser drops to the back of the
 *  queue and the front steps up. A tie keeps the reigning king and sends the
 *  challenger to the back. An empty queue means the same two simply rematch. */
export function applyKothRotation(input: KothInput): KothResult {
  const { duelists, winner, queue, throne } = input;
  if (duelists.length < MAX_DUELISTS) return { duelists, queue, throne };
  const [d0, d1] = duelists;

  let champ: string;
  let challenged: string;
  let nextThrone: Throne;
  if (winner) {
    champ = winner;
    challenged = winner === d0 ? d1 : d0;
    nextThrone = throne && throne.username === champ
      ? { username: champ, streak: throne.streak + 1 }
      : { username: champ, streak: 1 };
  } else if (throne && (throne.username === d0 || throne.username === d1)) {
    champ = throne.username;
    challenged = throne.username === d0 ? d1 : d0;
    nextThrone = throne;
  } else {
    return { duelists: [d0, d1], queue, throne }; // tie, no reigning king → rematch
  }

  if (queue.length === 0) {
    return { duelists: [champ, challenged], queue, throne: nextThrone };
  }
  return { duelists: [champ, queue[0]], queue: [...queue.slice(1), challenged], throne: nextThrone };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- rotation`
Expected: PASS — all cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/rotation.ts test/rotation.test.ts
git commit -m "feat(duel): pure seat assignment + king-of-the-hill rotation"
```

---

## Task 2: Per-room W/L/T (`src/scoreboard.ts`)

**Files:**
- Modify: `src/scoreboard.ts`
- Test: `test/scoreboard.test.ts`

- [ ] **Step 1: Update the tests first (TDD)**

Replace the contents of `test/scoreboard.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { bumpScoreboard } from "../src/scoreboard.ts";

describe("bumpScoreboard", () => {
  it("records win for the winner and loss for the other participant", () => {
    let b = bumpScoreboard([], { winner: "yan", participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 1, losses: 0, ties: 0, played: 1 },
      { username: "bob", wins: 0, losses: 1, ties: 0, played: 1 },
    ]);
    b = bumpScoreboard(b, { winner: "bob", participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 1, losses: 1, ties: 0, played: 2 },
      { username: "bob", wins: 1, losses: 1, ties: 0, played: 2 },
    ]);
  });
  it("records a tie for everyone when nobody won", () => {
    const b = bumpScoreboard([], { winner: null, participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 0, losses: 0, ties: 1, played: 1 },
      { username: "bob", wins: 0, losses: 0, ties: 1, played: 1 },
    ]);
  });
  it("does not record a loss when the winner is not a participant", () => {
    const b = bumpScoreboard([], { winner: "ghost", participants: ["yan"] });
    expect(b).toEqual([{ username: "yan", wins: 0, losses: 0, ties: 0, played: 1 }]);
  });
  it("backfills losses/ties on a pre-existing entry", () => {
    const legacy = [{ username: "yan", wins: 2, played: 3 }];
    const b = bumpScoreboard(legacy, { winner: "yan", participants: ["yan"] });
    expect(b).toEqual([{ username: "yan", wins: 3, losses: 0, ties: 0, played: 4 }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- scoreboard`
Expected: FAIL — existing `bumpScoreboard` doesn't return `losses`/`ties`.

- [ ] **Step 3: Update the implementation**

Replace the contents of `src/scoreboard.ts` with:

```ts
// src/scoreboard.ts — pure per-room cumulative W/L/T tally (no Cloudflare deps).

export type RoomScore = { username: string; wins: number; losses: number; ties: number; played: number };

export function bumpScoreboard(
  board: { username: string; wins: number; played: number; losses?: number; ties?: number }[],
  round: { winner: string | null; participants: string[] },
): RoomScore[] {
  // Spread fills losses/ties=0 for any legacy entry that predates W/L/T.
  const map = new Map<string, RoomScore>(
    board.map((e) => [e.username, { losses: 0, ties: 0, ...e } as RoomScore]),
  );
  for (const u of round.participants) {
    const e = map.get(u) ?? { username: u, wins: 0, losses: 0, ties: 0, played: 0 };
    e.played += 1;
    if (round.winner === null) e.ties += 1;
    else if (round.winner === u) e.wins += 1;
    else if (round.participants.includes(round.winner)) e.losses += 1; // a real opponent won
    map.set(u, e);
  }
  return [...map.values()];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- scoreboard`
Expected: PASS — all four cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/scoreboard.ts test/scoreboard.test.ts
git commit -m "feat(duel): per-room W/L/T scoreboard tally"
```

---

## Task 3: Type changes (`src/types.ts`)

**Files:**
- Modify: `src/types.ts` (PlayerState, RoomSnapshot)

- [ ] **Step 1: Add `role` to `PlayerState`**

`PlayerState` already has `ready` from Plan 1. Add `role`:

```ts
export type PlayerState = {
  username: string;
  connected: boolean;
  guesses: GuessRow[];
  status: "playing" | "won" | "lost";
  isBot?: boolean;
  ready: boolean;
  role: "duelist" | "queued";   // duel seat; only two duelists play at a time
};
```

- [ ] **Step 2: Add rotation/queue/throne to `RoomSnapshot`**

Import nothing new; add three fields (place them after `edition`):

```ts
  edition: string;
  rotation: "koth" | "host";              // next-opponent model; "koth" default ("host" is Plan 2b)
  queue: string[];                        // waiting challenger usernames, front = next
  throne: { username: string; streak: number } | null;  // current king + win streak (KOTH)
```

- [ ] **Step 3: Verify type errors point only at room.ts**

Run: `npm run typecheck`
Expected: FAIL — errors in `src/room.ts` for the missing `role` on player pushes and missing `rotation`/`queue`/`throne` in the initial state. Expected; Task 4 fixes them.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(duel): types for duel seats, queue, throne, rotation"
```

---

## Task 4: Server seat + rotation wiring (`src/room.ts`)

**Files:**
- Modify: `src/room.ts` — import; initial state; restore migration; seat assignment on join + bot; duelist-scoped ready/guess/game-over/finish; KOTH rotation on rematch; role-gated word reveal.

- [ ] **Step 1: Import rotation helpers**

Add after the duel import from Plan 1:

```ts
import { nextSeatRole, applyKothRotation } from "./rotation.ts";
```

- [ ] **Step 2: Add rotation/queue/throne to initial state**

In the constructor's `this.state = {...}`, after `edition: "default",` add:

```ts
      edition: "default",
      rotation: "koth",
      queue: [],
      throne: null,
```

- [ ] **Step 3: Migrate restored state**

In the `blockConcurrencyWhile` restore block, after the Plan 1 `goAt`/`ready` migration, add:

```ts
        if (!restored.rotation) restored.rotation = "koth";
        if (!Array.isArray(restored.queue)) restored.queue = [];
        if (restored.throne === undefined) restored.throne = null;
        // Backfill seats for rooms that predate roles: first two players are duelists,
        // the rest queue (in array order).
        if (restored.players.some((p) => p.role === undefined)) {
          let seated = 0;
          restored.queue = [];
          for (const p of restored.players) {
            if (seated < 2) { p.role = "duelist"; seated++; }
            else { p.role = "queued"; restored.queue.push(p.username); }
          }
        }
```

- [ ] **Step 4: Seat new humans on join**

In `onHello`, the new-player block (the `else` branch that pushes a player). Replace the push line (Plan 1 set `ready:false`) with role assignment + queue bookkeeping:

```ts
      const role = nextSeatRole(this.state.players);
      this.state.players.push({ username, connected: true, guesses: [], status: "playing", ready: false, role });
      if (role === "queued") this.state.queue.push(username);
```

- [ ] **Step 5: Seat the worduler**

In `ensureBot`, the bot push (Plan 1 set `ready:true`) becomes seat-aware:

```ts
    const role = nextSeatRole(this.state.players);
    this.state.players.push({ username: BOT_NAME, connected: true, guesses: [], status: "playing", isBot: true, ready: true, role });
    if (role === "queued") this.state.queue.push(BOT_NAME);
```

- [ ] **Step 6: Add a `duelists()` helper**

Add a small private helper near `isRobotRoom()`:

```ts
  /** The (up to two) players currently holding a duel seat. */
  private duelists(): PlayerState[] {
    return this.state.players.filter((p) => p.role === "duelist");
  }
```

- [ ] **Step 7: Scope the ready gate to duelists**

In `onReady` (from Plan 1), require a duelist and gate on duelists only. Replace the body:

```ts
  private async onReady(ws: WebSocket, ready: boolean): Promise<void> {
    if (this.state.phase !== "lobby") return;
    const username = this.userFor(ws);
    const player = username ? this.state.players.find((p) => p.username === username) : null;
    if (!player || player.role !== "duelist") return; // only duelists ready up
    player.ready = !!ready;
    this.ensureBot();
    if (everyoneReady(this.duelists())) {
      await this.beginCountdown();
      return;
    }
    await this.persistAndBroadcast();
  }
```

- [ ] **Step 8: Reset only duelists in `beginCountdown`**

In `beginCountdown` (from Plan 1), change the reset loop to duelists only:

```ts
    for (const p of this.duelists()) {
      p.guesses = [];
      p.status = "playing";
    }
```

- [ ] **Step 9: Only duelists may guess**

In `onGuess`, after resolving `player`, add a role guard (alongside the existing `status` check). The existing line is `if (!player || player.status !== "playing") return;` — change to:

```ts
    if (!player || player.role !== "duelist" || player.status !== "playing") return;
```

- [ ] **Step 10: Game-over considers only duelists**

Replace `isGameOver`:

```ts
  private isGameOver(): boolean {
    const active = this.duelists().filter((p) => p.connected);
    if (active.length === 0) return false;
    return active.every((p) => p.status !== "playing");
  }
```

- [ ] **Step 11: Finish records duelist W/L/T + duelist-only history**

In `finishGame`, change `participants` and the history `players` to duelists only. Replace the `bumpScoreboard` call and the `summarizeRoomGame` `players` array:

```ts
    const duelistNames = this.duelists().map((p) => p.username);
    this.state.scoreboard = bumpScoreboard(this.state.scoreboard, {
      winner: this.state.winner,
      participants: duelistNames,
    });
    this.state.history.push(
      summarizeRoomGame({
        round: this.state.round,
        word: this.state.word ?? "",
        winner: this.state.winner,
        finishedAt: this.state.finishedAt ?? Date.now(),
        players: this.duelists().map((p) => ({ username: p.username, status: p.status, guesses: p.guesses.length })),
      }),
    );
```

Also scope the `buildGameRecords` call (a few lines below, which reports each player's per-game record to their User DO for *global* lifetime stats) to duelists — otherwise a queued spectator gets credited with a loss for a game they never played. Change its `players:` array from `this.state.players.map(...)` to:

```ts
      players: this.duelists().map((p) => ({
        username: p.username,
        status: p.status,
        guesses: p.guesses.length,
      })),
```

- [ ] **Step 12: KOTH rotation on rematch**

Replace `onRematch` (from Plan 1) and add a rotation helper:

```ts
  private async onRematch(ws: WebSocket): Promise<void> {
    if (this.state.phase !== "finished") return;
    this.applyRotation();
    this.state.phase = "lobby";
    this.state.word = null;
    this.state.winner = null;
    this.state.startedAt = null;
    this.state.goAt = null;
    this.state.finishedAt = null;
    for (const p of this.state.players) {
      p.guesses = [];
      p.status = "playing";
      p.ready = false;
    }
    await this.persistAndBroadcast();
  }

  // King-of-the-hill advance: winner stays, loser → back of queue, next steps up.
  // (rotation "host" — manual sub-in — is Plan 2b; for now only "koth" auto-rotates.)
  private applyRotation(): void {
    if (this.state.rotation !== "koth") return;
    const current = this.duelists().map((p) => p.username);
    if (current.length < 2) return;
    const res = applyKothRotation({
      duelists: current,
      winner: this.state.winner,
      queue: this.state.queue,
      throne: this.state.throne,
    });
    const seated = new Set(res.duelists);
    for (const p of this.state.players) {
      p.role = seated.has(p.username) ? "duelist" : "queued";
    }
    this.state.queue = res.queue;
    this.state.throne = res.throne;
    if (res.throne) {
      this.pushSystem(`${res.throne.username} holds the throne 👑 ×${res.throne.streak}`);
    }
  }
```

- [ ] **Step 13: Reveal the word only to duelists who are done**

In `snapshotFor`, the `reveal` line currently is `const reveal = this.state.phase === "finished" || (!!me && me.status !== "playing");`. Change it so queued spectators never get an early reveal:

```ts
    const reveal = this.state.phase === "finished" || (!!me && me.role === "duelist" && me.status !== "playing");
```

- [ ] **Step 14: Typecheck + full tests pass**

Run: `npm run typecheck && npm test`
Expected: PASS — clean typecheck; all suites (incl. `rotation`, `scoreboard`, `duel`, `countdown`) green.

- [ ] **Step 15: Commit**

```bash
git add src/room.ts
git commit -m "feat(duel): 1v1 seats, duelist-scoped game, KOTH rotation, W/L/T finish"
```

---

## Task 5: Queue strip element (`public/index.html`)

**Files:**
- Modify: `public/index.html` — `tpl-room`, the `#tabPlay` panel.

- [ ] **Step 1: Add the queue strip above the boards**

In `tpl-room`, inside `<div id="tabPlay" ...>`, immediately before `<div id="boards" class="boards"></div>`, add:

```html
      <div id="queueStrip" class="queue-strip" hidden></div>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat(duel): queue-strip mount point in room template"
```

---

## Task 6: Client rendering (`public/app.js`)

**Files:**
- Modify: `public/app.js` — `renderBoards` (duelists only + throne badge), new `renderQueue`, `renderScoreboard` (W/L/T), `render()` lobby branch (spectator/challenger), the `canType` gate, and call `renderQueue` from `render()`.

- [ ] **Step 1: Render only duelist boards, with a throne badge**

Replace the `ordered` setup and the player-name/badge block in `renderBoards`. Change the top of `renderBoards` from the current `ordered` definition to:

```js
function renderBoards(snap, me) {
  const root = $("#boards");
  const duelists = snap.players.filter((p) => p.role === "duelist");
  const meIsDuelist = me && me.role === "duelist";
  const ordered = [
    ...(meIsDuelist ? [me] : []),
    ...duelists.filter((p) => p.username !== getUsername()),
  ];
```

Then, in the per-player name block, after the existing WON/OUT/AWAY badge logic and before `board.appendChild(name);`, add a throne badge:

```js
    if (snap.throne && p.username === snap.throne.username) {
      const crown = document.createElement("span");
      crown.className = "badge throne";
      crown.textContent = `👑 ×${snap.throne.streak}`;
      name.appendChild(crown);
    }
```

(Everything else in `renderBoards` — grid, reveal, pending, input-row — stays as-is. Because `ordered` now only contains duelists, queued spectators see both duelist boards and no board of their own.)

- [ ] **Step 2: Add `renderQueue`**

Add a new function (e.g. right after `renderScoreboard`):

```js
// The challenge queue strip: who's on the throne and who's next in line. Shown
// whenever anyone is waiting (or a throne exists); hidden in a plain solo room.
function renderQueue(snap) {
  const strip = $("#queueStrip");
  if (!strip) return;
  const queue = Array.isArray(snap.queue) ? snap.queue : [];
  if (queue.length === 0 && !snap.throne) {
    strip.hidden = true;
    strip.textContent = "";
    return;
  }
  strip.hidden = false;
  strip.textContent = "";
  if (snap.throne) {
    const king = document.createElement("span");
    king.className = "queue-king";
    king.textContent = `👑 ${snap.throne.username} · ${snap.throne.streak} in a row`;
    strip.appendChild(king);
  }
  if (queue.length) {
    const label = document.createElement("span");
    label.className = "queue-next muted small";
    const me = getUsername();
    const names = queue.map((u, i) => (u === me ? `you (#${i + 1})` : u));
    label.textContent = `Next up: ${names.join(" → ")}`;
    strip.appendChild(label);
  }
}
```

- [ ] **Step 3: Call `renderQueue` from `render()`**

In `render()`, next to the other render calls (after `renderScoreboard(snap);`), add:

```js
  renderQueue(snap);
```

- [ ] **Step 4: W/L/T in the scoreboard**

In `renderScoreboard`, change the tally text line. The current line is `tally.textContent = `${e.wins}W · ${e.played}P`;` — replace with:

```js
    const losses = e.losses ?? 0;
    const ties = e.ties ?? 0;
    tally.textContent = `${e.wins}W · ${losses}L · ${ties}T`;
```

- [ ] **Step 5: Spectator + challenger lobby UI**

In `render()`'s `if (snap.phase === "lobby")` branch (the Plan 1 code that sets the Ready button label + hint), replace that branch's ready-button/hint section with role-aware logic:

```js
  if (snap.phase === "lobby") {
    lobby.hidden = false;
    endControls.hidden = true;
    syncLengthSelect(snap);
    syncModePicker(snap);
    syncLobbyEdition();
    const meIsDuelist = me && me.role === "duelist";
    startBtn.hidden = !meIsDuelist; // queued players watch; they can't ready
    if (meIsDuelist) {
      const meReady = !!me.ready;
      const amChallenger = snap.throne && snap.throne.username !== getUsername();
      startBtn.textContent = meReady ? "Ready ✓" : (amChallenger ? "Challenge 👑" : "Ready");
      startBtn.classList.toggle("ready-on", meReady);
      const ds = snap.players.filter((p) => p.role === "duelist" && p.connected);
      const readyCount = ds.filter((p) => p.ready).length;
      $("#lobbyHint").textContent = ds.length < 2
        ? (meReady ? "You're ready — invite a friend or wait" : "Ready up to start — or invite a friend")
        : `${readyCount}/${ds.length} ready`;
    } else {
      const pos = (snap.queue || []).indexOf(getUsername());
      $("#lobbyHint").textContent = pos >= 0 ? `Spectating · #${pos + 1} in line to challenge` : "Spectating";
    }
  } else if (snap.phase === "countdown") {
```

(The `countdown` / `playing` / `finished` branches from Plan 1 are unchanged below this.)

- [ ] **Step 6: Only duelists can type**

In `render()`, the `canType` line currently is `const canType = snap.phase === "playing" && me && me.status === "playing";`. Add a role guard:

```js
  const canType = snap.phase === "playing" && me && me.role === "duelist" && me.status === "playing";
```

Also update the same guard in `onPhysicalKey` (the playing branch). The line `if (!me || me.status !== "playing") return;` becomes:

```js
  if (!me || me.role !== "duelist" || me.status !== "playing") return;
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS (types from Tasks 3–4 are consistent; app.js is not type-checked but this confirms the server side).

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat(duel): client duelist boards, queue strip, throne, W/L/T, spectator UI"
```

---

## Task 7: Queue + throne styles (`public/style.css`)

**Files:**
- Modify: `public/style.css` (append).

- [ ] **Step 1: Append styles**

```css
/* --- Duel queue strip + throne badge --- */
.queue-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.4rem 1rem;
  margin: 0.25rem auto 0.75rem;
  text-align: center;
}
.queue-king {
  font-weight: 700;
  color: var(--accent, #c9b458);
}
.queue-next { opacity: 0.85; }
.badge.throne {
  background: var(--accent, #c9b458);
  color: #1a1a1a;
  font-weight: 700;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat(duel): queue strip + throne badge styles"
```

---

## Task 8: Verification

- [ ] **Step 1: Full test + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS — all suites green including `rotation` and `scoreboard`.

- [ ] **Step 2: Server smoke test (seats + KOTH + W/L/T) via WebSocket clients**

Create `/tmp/smoke2.mjs` and run it with `node /tmp/smoke2.mjs` (the dev server must be running: `npm run dev`). It connects three clients to one room and verifies seat assignment, that only duelists play, KOTH rotation after a finished round, and the W/L/T tally.

```js
const HOST = "ws://localhost:8787";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = Date.now().toString(36);
let fail = 0;
const check = (n, c, d = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); if (!c) fail++; };
function mk(room, u) {
  const ws = new WebSocket(`${HOST}/ws?room=${encodeURIComponent(room)}`);
  const c = { ws, u, last: null };
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.type === "snapshot") c.last = m.room; });
  return c;
}
const open = (c) => new Promise((r) => c.ws.addEventListener("open", r, { once: true }));
const send = (c, m) => c.ws.send(JSON.stringify(m));
const hello = (c) => send(c, { type: "hello", username: c.u, wordLength: 5, edition: "default", mode: "race" });
const roleOf = (snap, u) => snap.players.find((p) => p.username === u)?.role;

const room = `alice/koth-${uniq}`;
const a = mk(room, "alice"); await open(a); hello(a); await sleep(150);
const b = mk(room, "bobby"); await open(b); hello(b); await sleep(150);
const c = mk(room, "carol"); await open(c); hello(c); await sleep(200);

check("alice+bobby are duelists, carol queued", roleOf(a.last, "alice") === "duelist" && roleOf(a.last, "bobby") === "duelist" && roleOf(a.last, "carol") === "queued");
check("carol is in the queue", (a.last.queue || []).includes("carol"));

// Both duelists ready → countdown → playing.
send(a, { type: "ready", ready: true });
send(b, { type: "ready", ready: true });
await sleep(3400);
check("playing after countdown", a.last.phase === "playing", `phase=${a.last.phase}`);

// alice solves it (real answer is revealed to a finished player; we read it once alice is out).
// Simpler: make BOTH duelists lose by exhausting guesses with wrong words, producing a tie,
// OR have alice guess the word. We don't know the word, so drive a no-winner finish: both
// resign. resign marks lost; once both are out the game finishes with winner=null (a tie).
send(a, { type: "resign" });
send(b, { type: "resign" });
await sleep(300);
check("game finished", a.last.phase === "finished", `phase=${a.last.phase}`);
check("tie recorded for both duelists", (a.last.scoreboard || []).filter((s) => s.ties === 1 && s.played === 1).length === 2, JSON.stringify(a.last.scoreboard));

// Rematch triggers KOTH rotation. Tie + no throne yet → same two rematch, carol still queued.
send(a, { type: "rematch" });
await sleep(200);
check("after tie-rematch alice+bobby still duelists", roleOf(a.last, "alice") === "duelist" && roleOf(a.last, "bobby") === "duelist");
check("phase back to lobby, ready cleared", a.last.phase === "lobby" && a.last.players.every((p) => !p.ready));

a.ws.close(); b.ws.close(); c.ws.close();
console.log(`\n${fail === 0 ? "ALL PASS ✅" : fail + " FAILURE(S) ❌"}`);
process.exit(fail === 0 ? 0 : 1);
```

Expected: `ALL PASS ✅`. (Note: this exercises the tie path via double-resign, since the word isn't known client-side. A win/loss + throne-streak rotation is covered by the unit tests in Task 1.)

- [ ] **Step 3: Manual browser pass (human)**

Left for human verification: open a room in three contexts, confirm only two boards show + a queue strip, play a round, and watch the loser drop to the queue with the winner crowned (👑 ×streak), and the W/L/T scoreboard update.

- [ ] **Step 4: Final commit (only if Steps 1–2 needed fixes)**

```bash
git add -A && git commit -m "fix(duel): verification fixes for KOTH rotation"
```

---

## Self-Review

- **Spec coverage (Plan 2 slice):** 1v1 seats (Task 1 `nextSeatRole`, Task 4 join/bot); challenge queue + spectators (Tasks 4, 6); KOTH winner-stays/loser-queues/next-up + tie-keeps-king (Task 1 `applyKothRotation`, Task 4 `applyRotation`); throne + streak (Tasks 1, 4, 6); per-room W/L/T (Tasks 2, 4, 6); duelist-scoped ready/guess/finish/reveal (Task 4). Deferred: rotation **setting** + Host's-choice manual sub-in (Plan 2b); waiting vibe / match-me / worduler cover (Plan 3).
- **Placeholder scan:** none — every code step has complete code; every run step has command + expected output.
- **Type consistency:** `nextSeatRole`/`applyKothRotation`/`MAX_DUELISTS` (Task 1) used in Task 4; `RoomScore` W/L/T fields (Task 2) consumed by `renderScoreboard` (Task 6 Step 4) and produced in `finishGame` (Task 4 Step 11); `PlayerState.role` + `RoomSnapshot.rotation/queue/throne` (Task 3) produced in room.ts (Task 4) and consumed in app.js (Task 6). `rotation` defaults to `"koth"` everywhere; `applyRotation` early-returns for non-koth so the field is forward-compatible with Plan 2b.
- **Builds on Plan 1:** reuses `everyoneReady` (now passed `this.duelists()`), the `countdown`/`goAt` flow, and `cancelCountdown` unchanged.
- **Note for executor:** several edits modify Plan 1 code (the `onReady` body, `beginCountdown` reset loop, `onRematch`, the lobby render branch, `canType`). Match on the surrounding code shown, not line numbers.
```
