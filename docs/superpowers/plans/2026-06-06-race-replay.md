# Race Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At race end, reveal everyone's letters instantly and offer a "▶ Watch replay" button that replays the whole field in place — typing, row wipes, rejected words with their −50 sting, guesses flipping at compressed real pace — ending with per-board time + gold chips.

**Architecture:** The room DO already records a ghost tape (typing lengths, mask-only guesses, finishes) but only for seeded rounds — Task 1–3 make it record every multiplayer round plus `reject` events, and ship it in the snapshot **only at `phase === "finished"`**. A new pure module `public/replay-core.js` (the `ghost-replay.js` pattern: no DOM, vitest-tested) merges tape + snapshot guesses (letters) and compresses time. `app.js` owns the clock and renders replay players through the existing `renderBoards`.

**Tech Stack:** Cloudflare Workers DO (TypeScript, `src/`), vanilla-JS SPA (`public/`), vitest. Spec: `docs/superpowers/specs/2026-06-06-race-replay-design.md`.

**Worktree:** `bash dev/start.sh race-replay && cd .claude/worktrees/race-replay` (root edits are hook-blocked).

---

### Task 1: `reject` tape event type (ghost-core) + ghost-replay regression

**Files:**
- Modify: `src/ghost-core.ts` (GhostEvent union, ~line 8)
- Test: `test/ghost-core.test.ts`, `test/ghost-replay.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/ghost-core.test.ts`, inside the existing `describe("tapePush", ...)` block add:

```ts
  it("records a reject event with its letters (leak-safe: rejected words are not in the list)", () => {
    const t = newTape(5, 6, [{ username: "zang", host: true }]);
    tapePush(t, { t: 1200, u: "zang", k: "reject", word: "BENAN" });
    expect(t.events).toEqual([{ t: 1200, u: "zang", k: "reject", word: "BENAN" }]);
  });
```

In `test/ghost-replay.test.js` add (imports at top of file already pull from `../public/ghost-replay.js`):

```js
describe("reject events in a tape", () => {
  it("ghostPlayersAt ignores them — ghost races are unaffected", () => {
    const players = [{ username: "zang", host: true }];
    const base = { v: 1, wordLength: 5, maxGuesses: 6, players, events: [
      { t: 100, u: "zang", k: "typing", len: 3 },
      { t: 900, u: "zang", k: "guess", mask: ["cold", "cold", "warm", "cold", "cold"], status: "playing" },
    ] };
    const withReject = { ...base, events: [
      base.events[0],
      { t: 500, u: "zang", k: "reject", word: "BENAN" },
      base.events[1],
    ] };
    expect(ghostPlayersAt(withReject, 2000)).toEqual(ghostPlayersAt(base, 2000));
  });
});
```

- [ ] **Step 2: Run tests to verify the TS one fails**

Run: `npx vitest run test/ghost-core.test.ts test/ghost-replay.test.js`
Expected: ghost-core test FAILS to compile (`k: "reject"` not assignable to GhostEvent). The ghost-replay test may already pass (the `for` loop's `if/else if` chain skips unknown kinds) — that's fine, it's the regression guard.

- [ ] **Step 3: Extend the GhostEvent union**

In `src/ghost-core.ts`, the union (~line 8) becomes:

```ts
export type GhostEvent =
  | { t: number; u: string; k: "typing"; len: number }
  | { t: number; u: string; k: "guess"; mask: Color[]; status: "playing" | "won" | "lost" }
  | { t: number; u: string; k: "reject"; word: string } // a dud submit, letters included — leak-safe: a rejected word is by definition not in the word list, so it can never be the answer
  | { t: number; u: string; k: "finish"; status: "won" | "lost"; guesses: number };
```

Also update the file-top comment ("NEVER letters or the answer") to read: guess events never carry letters; `reject` events do carry their letters, which is leak-safe (not-in-list words can't be the answer).

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run test/ghost-core.test.ts test/ghost-replay.test.js && npm run typecheck`
Expected: PASS, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add src/ghost-core.ts test/ghost-core.test.ts test/ghost-replay.test.js
git commit -m "feat(replay): reject tape event type — duds carry letters, ghost replay skips them"
```

---

### Task 2: Tape every multiplayer round (not just seeded)

**Files:**
- Modify: `src/room.ts` (runStart ~line 777; four tapePush guards ~lines 959, 981, 1038, 1045)

No new unit test (the DO has no test harness; the pure pieces were tested in Task 1, the gating helper is tested in Task 4). Verification = typecheck + existing suite + the manual smoke in Task 9.

- [ ] **Step 1: Move tape creation out of the seed branch**

In `src/room.ts` `runStart`, the seed branch currently ends (~line 777):

```ts
      this.state.tape = newTape(this.state.wordLength, this.state.maxGuesses,
        this.state.players.map((p) => ({ username: p.username, host: !p.isBot })));
    }
    this.state.phase = "playing";
```

Delete those two tape lines from inside the seed branch and insert after the brace, so every non-daily round records:

```ts
    }
    // Every multiplayer round records a tape (rhythm + rejects + finishes). It powers the
    // finished-screen race replay (ships in the snapshot only at phase "finished" — see
    // tapeForSnapshot) and, for seeded rounds, the ghost tape filed to the Challenge DO.
    // Unseeded tapes never leave room state: the filing (~line 1577) stays seed-gated.
    this.state.tape = this.state.isDaily ? undefined : newTape(this.state.wordLength, this.state.maxGuesses,
      this.state.players.map((p) => ({ username: p.username, host: !p.isBot })));
    this.state.phase = "playing";
```

- [ ] **Step 2: Drop the `seed` condition from all four tapePush guards**

There are exactly four sites guarded by `if (this.state.tape && this.state.seed && this.state.startedAt)` — onTyping (~959), emitBotTyping (~981), applyGuess guess-commit (~1038) and finish (~1045). Each becomes:

```ts
    if (this.state.tape && this.state.startedAt) {
```

(`grep -n "state.tape && this.state.seed" src/room.ts` must return nothing afterwards.)

- [ ] **Step 3: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: clean. (The Challenge filing at ~1577 keeps its own `this.state.seed && this.state.shareChallengeId` guard — do NOT touch it.)

- [ ] **Step 4: Commit**

```bash
git add src/room.ts
git commit -m "feat(replay): record a tape for every multiplayer round, not just seeded arenas"
```

---

### Task 3: Record rejected words on the tape

**Files:**
- Modify: `src/room.ts` (`onGuess` "not in word list" branch, ~line 937)

- [ ] **Step 1: Tape the dud**

In `onGuess`, the branch currently reads:

```ts
    const pool = WORDS_BY_SIZE[len];
    if (!pool?.valid.has(word)) {
      this.send(ws, { type: "invalid_guess", reason: "not in word list" });
      return;
    }
```

becomes:

```ts
    const pool = WORDS_BY_SIZE[len];
    if (!pool?.valid.has(word)) {
      // Tape the dud for the race replay (letters are leak-safe — see GhostEvent).
      if (this.state.tape && this.state.startedAt) {
        tapePush(this.state.tape, { t: this.tapeT(Date.now()), u: player.username, k: "reject", word });
      }
      this.send(ws, { type: "invalid_guess", reason: "not in word list" });
      return;
    }
```

The wrong-length branch above it is NOT taped (the client prevents short submits; only anomalies hit it). Note: rejects are NOT persisted here (no `persistAndBroadcast` on the reject path — same durability class as typing pulses; a hibernation may drop duds since the last guess, which is acceptable).

- [ ] **Step 2: Typecheck + suite**

Run: `npm run typecheck && npm test`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/room.ts
git commit -m "feat(replay): tape rejected words — the duds star in the race replay"
```

---

### Task 4: Ship the tape in the snapshot at `finished` only

**Files:**
- Modify: `src/ghost-core.ts` (new helper), `src/room.ts` (`snapshotFor` ~line 1940, NOTE comment ~line 98)
- Test: `test/ghost-core.test.ts`

- [ ] **Step 1: Write the failing test**

In `test/ghost-core.test.ts`:

```ts
describe("tapeForSnapshot", () => {
  const tape = newTape(5, 6, [{ username: "zang", host: true }]);
  it("withholds the tape while the game is live (it now carries reject letters)", () => {
    expect(tapeForSnapshot("lobby", tape)).toBeUndefined();
    expect(tapeForSnapshot("playing", tape)).toBeUndefined();
  });
  it("ships the tape once finished", () => {
    expect(tapeForSnapshot("finished", tape)).toBe(tape);
    expect(tapeForSnapshot("finished", undefined)).toBeUndefined();
  });
});
```

(Add `tapeForSnapshot` to the import at the top of the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ghost-core.test.ts`
Expected: FAIL — `tapeForSnapshot` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/ghost-core.ts`:

```ts
// The tape ships over the room socket only once the game is over: it carries rejected
// words WITH letters and the field's full rhythm — finished-screen replay data, gated
// exactly like `word` in snapshotFor. Mid-game it stays server-side.
export function tapeForSnapshot(phase: string, tape: GhostTape | undefined): GhostTape | undefined {
  return phase === "finished" ? tape : undefined;
}
```

- [ ] **Step 4: Use it in snapshotFor**

In `src/room.ts` (~line 1940), replace:

```ts
      tape: undefined, // internal-only ghost tape; ships to late visitors via the Challenge DO, never the room socket
```

with:

```ts
      tape: tapeForSnapshot(this.state.phase, this.state.tape), // finished-only: powers the race replay; live games keep it server-side (it carries reject letters + rhythm)
```

Add `tapeForSnapshot` to the ghost-core import at the top (~line 19). Also update the stale NOTE at ~line 98 ("Stripped outbound in snapshotFor like `seed`") to say it ships outbound only at phase "finished" via `tapeForSnapshot`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run test/ghost-core.test.ts && npm run typecheck && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ghost-core.ts src/room.ts test/ghost-core.test.ts
git commit -m "feat(replay): ship the tape in snapshots at finished only (gated like word)"
```

---

### Task 5: `replay-core.js` — buildReplay (merge + compression)

**Files:**
- Create: `public/replay-core.js`
- Test: `test/replay-core.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/replay-core.test.js`:

```js
import { describe, it, expect } from "vitest";
import { buildReplay, replayPlayersAt, nextCueAfter, closingStats, REJECT_FLASH_MS } from "../public/replay-core.js";

const PLAYERS = [{ username: "zang", host: true }, { username: "maya", host: false }];
const MASK = ["cold", "cold", "warm", "cold", "cold"];
const HOT = ["hot", "hot", "hot", "hot", "hot"];

function tape(events) {
  return { v: 1, wordLength: 5, maxGuesses: 6, players: PLAYERS, events };
}
// Snapshot players as the client sees them at finished (letters present).
const SNAP_PLAYERS = [
  { username: "zang", status: "lost", points: -50, guesses: [{ word: "PENNE", mask: MASK }] },
  { username: "maya", status: "won", points: 120, guesses: [{ word: "ADIEU", mask: MASK }, { word: "LEANS", mask: HOT }] },
];

describe("buildReplay merge", () => {
  it("pairs the i-th guess event per user with that user's i-th snapshot guess", () => {
    const r = buildReplay(tape([
      { t: 1000, u: "maya", k: "guess", mask: MASK, status: "playing" },
      { t: 2000, u: "zang", k: "guess", mask: MASK, status: "lost" },
      { t: 3000, u: "maya", k: "guess", mask: HOT, status: "won" },
      { t: 3000, u: "maya", k: "finish", status: "won", guesses: 2 },
    ]), SNAP_PLAYERS);
    const words = r.events.filter((e) => e.k === "guess").map((e) => e.word);
    expect(words).toEqual(["ADIEU", "PENNE", "LEANS"]);
  });

  it("a player missing from the snapshot (left the room) degrades to letterless rows", () => {
    const r = buildReplay(tape([{ t: 1000, u: "maya", k: "guess", mask: MASK, status: "playing" }]), []);
    expect(r.events[0].word).toBe("");
  });
});

describe("buildReplay compression", () => {
  it("clamps think-pauses to gapCapMs, preserving short gaps exactly (sub-target game plays 1:1)", () => {
    const r = buildReplay(tape([
      { t: 500, u: "zang", k: "typing", len: 1 },
      { t: 60500, u: "zang", k: "guess", mask: MASK, status: "playing" }, // 60s think
      { t: 61000, u: "zang", k: "typing", len: 2 },
    ]), SNAP_PLAYERS, { gapCapMs: 2000, targetMs: 12000 });
    // 500 + clamp(60000→2000) + 500 = 3000 total ≤ 12000 ⇒ speed 1, no scaling.
    expect(r.events.map((e) => e.t)).toEqual([500, 2500, 3000]);
    expect(r.durationMs).toBe(3000);
  });

  it("scales a long game down to ~targetMs", () => {
    const events = [];
    for (let i = 1; i <= 24; i++) events.push({ t: i * 2000, u: "zang", k: "typing", len: 1 });
    const r = buildReplay(tape(events), SNAP_PLAYERS, { gapCapMs: 2000, targetMs: 12000 });
    // clamped total 48000 ⇒ speed 4 ⇒ last event at 12000.
    expect(r.durationMs).toBe(12000);
    expect(r.events[0].t).toBe(500);
  });

  it("keeps real finish times for the closing chips (uncompressed)", () => {
    const r = buildReplay(tape([
      { t: 95000, u: "maya", k: "guess", mask: HOT, status: "won" },
      { t: 95000, u: "maya", k: "finish", status: "won", guesses: 1 },
    ]), SNAP_PLAYERS);
    expect(r.realFinishMs.get("maya")).toBe(95000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/replay-core.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement buildReplay**

Create `public/replay-core.js`:

```js
// public/replay-core.js — pure race-replay math (no DOM), unit-tested in
// test/replay-core.test.js (the ghost-replay.js pattern). The finished-screen replay
// merges the round's tape (rhythm + rejects + finish stamps, ships only at phase
// "finished") with the snapshot's guesses (letters + masks), compresses time, and
// answers "what does the field look like at playback t". app.js owns the clock + DOM.

// How long a rejected word stays painted red on the active row during playback.
export const REJECT_FLASH_MS = 900;

// Merge + compress. players = snapshot players at finished (guesses carry words).
// Compression: clamp every inter-event gap to gapCapMs, then scale uniformly so the
// total runs ≈ targetMs — speed = max(1, clampedTotal / targetMs), so a game already
// under targetMs plays its clamped timeline 1:1 (never sped up).
export function buildReplay(tape, players, { gapCapMs = 2000, targetMs = 12000 } = {}) {
  const byUser = new Map((players ?? []).map((p) => [p.username, p]));
  const counts = new Map();
  const events = [];
  let prevT = 0;
  let clamped = 0;
  for (const ev of tape.events) {
    clamped += Math.min(Math.max(0, ev.t - prevT), gapCapMs);
    prevT = ev.t;
    const e = { ...ev, t: clamped };
    if (ev.k === "guess") {
      const i = counts.get(ev.u) ?? 0;
      counts.set(ev.u, i + 1);
      // i-th guess event ↔ i-th snapshot guess; a vanished player degrades to mask-only.
      e.word = byUser.get(ev.u)?.guesses?.[i]?.word ?? "";
    }
    events.push(e);
  }
  const speed = Math.max(1, clamped / targetMs);
  for (const e of events) e.t = Math.round(e.t / speed);
  // Real (uncompressed) finish stamps — the closing chips show true race time.
  const realFinishMs = new Map();
  for (const ev of tape.events) if (ev.k === "finish") realFinishMs.set(ev.u, ev.t);
  return {
    wordLength: tape.wordLength,
    maxGuesses: tape.maxGuesses,
    usernames: tape.players.map((p) => p.username),
    events,
    durationMs: events.length ? events[events.length - 1].t : 0,
    realFinishMs,
  };
}
```

- [ ] **Step 4: Run the buildReplay tests**

Run: `npx vitest run test/replay-core.test.js`
Expected: the `buildReplay` describes PASS (replayPlayersAt/nextCueAfter/closingStats tests come next task — if Step 1's import already references them, vitest fails on import; either add the Task 6 tests in Task 6, or stub-export them as `export function replayPlayersAt() {}` etc. Preferred: write only the buildReplay tests in Step 1 and grow the file in Task 6).

- [ ] **Step 5: Commit**

```bash
git add public/replay-core.js test/replay-core.test.js
git commit -m "feat(replay): replay-core buildReplay — tape⋈snapshot merge + clamped-gap compression"
```

---

### Task 6: `replay-core.js` — playback state, cues, closing stats

**Files:**
- Modify: `public/replay-core.js`
- Test: `test/replay-core.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/replay-core.test.js`:

```js
describe("replayPlayersAt", () => {
  const r = buildReplay(tape([
    { t: 300, u: "zang", k: "typing", len: 3 },
    { t: 800, u: "zang", k: "reject", word: "BENAN" },
    { t: 900, u: "zang", k: "typing", len: 0 },
    { t: 1500, u: "zang", k: "guess", mask: MASK, status: "lost" },
    { t: 1500, u: "zang", k: "finish", status: "lost", guesses: 1 },
    { t: 1800, u: "maya", k: "guess", mask: HOT, status: "won" },
    { t: 1800, u: "maya", k: "finish", status: "won", guesses: 1 },
  ]), SNAP_PLAYERS);

  it("starts everyone on empty playing boards", () => {
    const ps = replayPlayersAt(r, 0);
    expect(ps).toHaveLength(2);
    for (const p of ps) {
      expect(p.guesses).toEqual([]);
      expect(p.status).toBe("playing");
      expect(p.replay).toBe(true);
    }
  });

  it("typing fills then wipes (len back to 0)", () => {
    expect(replayPlayersAt(r, 300).find((p) => p.username === "zang").typingLen).toBe(3);
    expect(replayPlayersAt(r, 900).find((p) => p.username === "zang").typingLen).toBe(0);
  });

  it("a reject flashes its letters for REJECT_FLASH_MS, then clears", () => {
    const at = replayPlayersAt(r, 800).find((p) => p.username === "zang");
    expect(at.rejectFlash).toEqual({ word: "BENAN", sinceMs: 0 });
    const later = replayPlayersAt(r, 800 + REJECT_FLASH_MS).find((p) => p.username === "zang");
    expect(later.rejectFlash).toBeNull();
  });

  it("guesses commit with letters and statuses land at their moments", () => {
    const zang = replayPlayersAt(r, 1500).find((p) => p.username === "zang");
    expect(zang.guesses).toEqual([{ word: "PENNE", mask: MASK }]);
    expect(zang.status).toBe("lost");
    expect(replayPlayersAt(r, 1799).find((p) => p.username === "maya").status).toBe("playing");
    expect(replayPlayersAt(r, 1800).find((p) => p.username === "maya").status).toBe("won");
  });
});

describe("nextCueAfter", () => {
  const r = buildReplay(tape([
    { t: 800, u: "zang", k: "reject", word: "BENAN" },
    { t: 3000, u: "zang", k: "guess", mask: MASK, status: "lost" },
  ]), SNAP_PLAYERS);
  it("returns the next event time", () => {
    expect(nextCueAfter(r, 0)).toBe(800);
  });
  it("includes the reject-flash expiry as a cue (the flash must be cleared between events)", () => {
    expect(nextCueAfter(r, 800)).toBe(800 + REJECT_FLASH_MS);
  });
  it("null when exhausted", () => {
    expect(nextCueAfter(r, 99999)).toBeNull();
  });
});

describe("closingStats", () => {
  it("real time + gold per player; never-finished players get null time", () => {
    const r = buildReplay(tape([
      { t: 95000, u: "maya", k: "guess", mask: HOT, status: "won" },
      { t: 95000, u: "maya", k: "finish", status: "won", guesses: 1 },
    ]), SNAP_PLAYERS);
    expect(closingStats(r, SNAP_PLAYERS)).toEqual([
      { username: "zang", status: "lost", timeMs: null, gold: -50 },
      { username: "maya", status: "won", timeMs: 95000, gold: 120 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/replay-core.test.js`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `public/replay-core.js`:

```js
// Field state at playback time t: player objects shaped like snapshot players (the
// ghostPlayersAt convention) so renderBoards draws them unchanged — but WITH letters,
// plus a transient rejectFlash for the active row. `replay: true` is the render hint
// (letters + typing ghost-fill even though the room phase is "finished").
export function replayPlayersAt(replay, t) {
  const players = new Map(replay.usernames.map((u) => [u, {
    username: u, connected: true, status: "playing", guesses: [],
    points: 0, pointsSpent: 0, ready: false, role: "duelist",
    replay: true, typingLen: 0, rejectFlash: null,
  }]));
  for (const ev of replay.events) {
    if (ev.t > t) break; // events are ascending
    const p = players.get(ev.u);
    if (!p) continue;
    p.rejectFlash = null; // any later event supersedes the flash
    if (ev.k === "typing") p.typingLen = ev.len;
    else if (ev.k === "guess") {
      p.guesses.push({ word: ev.word, mask: ev.mask });
      p.typingLen = 0;
      p.status = ev.status;
    } else if (ev.k === "reject") {
      const age = t - ev.t;
      if (age < REJECT_FLASH_MS) p.rejectFlash = { word: ev.word, sinceMs: age };
      p.typingLen = 0;
    } else if (ev.k === "finish") {
      p.status = ev.status;
      p.typingLen = 0;
    }
  }
  return [...players.values()];
}

// Next moment the field changes: the next event, or a live reject-flash expiring —
// whichever comes first. Drives app.js's setTimeout cadence. Null = playback done.
export function nextCueAfter(replay, t) {
  let best = null;
  for (const ev of replay.events) {
    if (ev.k === "reject") {
      const end = ev.t + REJECT_FLASH_MS;
      if (end > t && (best == null || end < best)) best = end;
    }
    if (ev.t > t) {
      if (best == null || ev.t < best) best = ev.t;
      break;
    }
  }
  return best;
}

// Closing chips: per player, true (uncompressed) race time + round gold (p.points,
// the server's earned−spent tally everyone already sees on the finished boards).
export function closingStats(replay, players) {
  const byUser = new Map((players ?? []).map((p) => [p.username, p]));
  return replay.usernames.map((u) => {
    const p = byUser.get(u);
    return {
      username: u,
      status: p?.status ?? "lost",
      timeMs: replay.realFinishMs.get(u) ?? null,
      gold: p?.points ?? 0,
    };
  });
}
```

- [ ] **Step 4: Run all replay-core tests**

Run: `npx vitest run test/replay-core.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/replay-core.js test/replay-core.test.js
git commit -m "feat(replay): replay-core playback state, cue scheduling, closing stats"
```

---

### Task 7: Letter reveal at finish (renderBoards)

**Files:**
- Modify: `public/app.js` (renderBoards, ~lines 2981–3009)

- [ ] **Step 1: Reveal letters when the game is over (and for replay players)**

In `renderBoards`, both letter sites currently gate on `isMe` (~lines 2986 and 2990):

```js
            if (isMe) tile.textContent = guess.word[c];
```

Both become (note `|| ""` — a vanished player's merged replay rows have `word: ""`):

```js
            if (isMe || snap.phase === "finished") tile.textContent = guess.word[c] || "";
```

Why this is safe: words already ship in every snapshot (`projectPlayerForClient` passes guesses through); this only changes *rendering*, and only once `phase === "finished"` (everyone done — an out player can't chat-leak a racing player's guesses). Daily renders only your own board (`game.isDaily` branch at the top of renderBoards), so it's untouched. Replay players ride the same gate: playback happens at phase "finished".

- [ ] **Step 2: Let replay players ghost-type at phase "finished"**

The opponent live-typing branch (~line 3001) requires `snap.phase === "playing"`:

```js
        } else if (!isMe && isCurrentRow && snap.phase === "playing" && p.status === "playing") {
```

becomes (replay players type while the room phase is "finished"; during replay even MY board is a spectator board):

```js
        } else if (isCurrentRow && p.status === "playing" && (p.replay || (!isMe && snap.phase === "playing"))) {
```

The `isMe` input-row/cursor/pending branches above are inert during replay (they all require `snap.phase === "playing"`), so no other renderBoards change is needed.

- [ ] **Step 3: Run suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: clean (renderBoards has no unit tests; behavior verified in Task 9's smoke).

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(replay): reveal everyone's letters once the race is finished"
```

---

### Task 8: Replay UI — button, playback loop, reject flash, closing chips

**Files:**
- Modify: `public/index.html` (button beside `#rematchBtn`), `public/app.js`, `public/style.css`, `public/locales/en.js`

- [ ] **Step 1: Markup + i18n**

In `public/index.html`, next to `#rematchBtn` (match its container/classes exactly — read the surrounding markup first):

```html
<button id="replayBtn" hidden>▶ <span id="replayBtnLabel"></span></button>
```

In `public/locales/en.js`, add to the `endscreen` group (match existing key style):

```js
  "endscreen.watchReplay": "Watch replay",
  "endscreen.skipReplay": "Skip",
```

Set the label wherever the other endscreen buttons get their text (search `endscreen.playAgain` in app.js, ~line 3994, and mirror): `$("#replayBtnLabel").textContent = t("endscreen.watchReplay");`

**iOS guard:** buttons aren't inputs, but run `npx vitest run test/ios-input-zoom.test.ts` after styling to be sure nothing regressed.

- [ ] **Step 2: app.js — import, state, button wiring**

Top of `app.js` (beside the `/endcard.js` import, line 4):

```js
import { buildReplay, replayPlayersAt, nextCueAfter, closingStats } from "/replay-core.js";
```

On the `game` state object (~line 614, beside `lastRejected`):

```js
  replay: null,       // { data, t0 } — active race replay (clock anchor + built timeline)
  replayChips: null,  // closingStats result, re-painted across renders until next round
```

Bind once where `#rematchBtn`'s listener is bound (~line 777):

```js
  $("#replayBtn").addEventListener("click", () => {
    if (game.replay) skipReplay();
    else startRaceReplay();
  });
```

Button visibility — where `rematchBtn` visibility is decided per snapshot (~lines 2541–2565):

```js
  const replayBtn = $("#replayBtn");
  replayBtn.hidden = !(snap.phase === "finished" && !game.isDaily && snap.tape && snap.tape.events?.length);
```

- [ ] **Step 3: app.js — playback loop (mirrors tickGhostReplay, ~line 3077)**

```js
let replayTimer = 0;

function startRaceReplay() {
  const snap = game.snapshot;
  if (!snap?.tape || game.replay) return;
  game.replay = { data: buildReplay(snap.tape, snap.players), t0: Date.now() };
  game.replayChips = null;
  $("#replayBtnLabel").textContent = t("endscreen.skipReplay");
  tickRaceReplay();
}

function tickRaceReplay() {
  clearTimeout(replayTimer);
  const rp = game.replay;
  if (!rp || !game.snapshot) return;
  const t = Date.now() - rp.t0;
  renderReplayField(t);
  const at = nextCueAfter(rp.data, t);
  if (at != null) replayTimer = setTimeout(tickRaceReplay, Math.max(16, at - t));
  else endRaceReplay();
}

// Draw the field as it looked at playback t: substitute replay players into a view
// snapshot and reuse renderBoards (replay players carry `replay: true`, so letters and
// ghost-typing render even though phase stays "finished"). Reject flashes are painted
// as a post-pass — they're transient row state, not guesses.
function renderReplayField(t) {
  const rp = game.replay;
  const players = replayPlayersAt(rp.data, t);
  for (const p of players) {
    if (p.typingLen > 0) game.typing.set(p.username, p.typingLen);
    else game.typing.delete(p.username);
  }
  const view = { ...game.snapshot, players };
  renderBoards(view, players.find((p) => p.username === getUsername()));
  for (const p of players) paintRejectFlash(p);
}

function paintRejectFlash(p) {
  if (!p.rejectFlash) return;
  const board = document.querySelector(`.player-board[data-player="${CSS.escape(p.username)}"]`);
  const row = board?.querySelectorAll(".grid-row")[p.guesses.length];
  if (!row) return;
  row.querySelectorAll(".tile").forEach((tile, c) => {
    tile.textContent = p.rejectFlash.word[c] ?? "";
    tile.classList.add("reject");
  });
  // The −50 sting, riding the row like the live drain does.
  if (!row.querySelector(".replay-sting")) {
    const sting = document.createElement("span");
    sting.className = "replay-sting";
    sting.textContent = `−${GOLD.invalidPenalty}`;
    row.appendChild(sting);
  }
}

function endRaceReplay() {
  const rp = game.replay;
  cancelReplay();
  if (rp && game.snapshot) game.replayChips = closingStats(rp.data, game.snapshot.players);
  render(); // restores the true finished boards (letters revealed) + paints chips
}

function skipReplay() { endRaceReplay(); }

// Hard stop with no chips — a rematch/new round started under the replay.
function cancelReplay() {
  clearTimeout(replayTimer);
  game.replay = null;
  game.typing.clear();
  $("#replayBtnLabel").textContent = t("endscreen.watchReplay");
}
```

`GOLD` is already imported in app.js (search `GOLD.invalidPenalty`, ~line 2153). `t()` is the i18n helper already in scope.

- [ ] **Step 4: app.js — yield + lifecycle hooks**

1. **Snapshot renders must not stomp playback.** At the `renderBoards(snap, me)` call site inside `render()` (~line 2591):

```js
  if (game.replay) renderReplayField(Date.now() - game.replay.t0);
  else renderBoards(snap, me);
```

2. **A new round kills the replay + chips.** In the snapshot handler where phase transitions are detected (~line 2097, the `phaseEnded` block), add:

```js
    if (msg.room.phase !== "finished") {
      if (game.replay) cancelReplay();
      game.replayChips = null;
    }
```

3. **Chips survive re-renders.** At the end of the per-player loop in `renderBoards` (after `root.appendChild(board)`, ~line 3020):

```js
    if (snap.phase === "finished" && !game.replay && game.replayChips) {
      const s = game.replayChips.find((x) => x.username === p.username);
      if (s) {
        const chip = document.createElement("div");
        chip.className = "replay-chip";
        const mins = s.timeMs != null ? Math.floor(s.timeMs / 60000) : null;
        const secs = s.timeMs != null ? Math.round((s.timeMs % 60000) / 1000) : null;
        chip.textContent = `${mins != null ? `${mins}:${String(secs).padStart(2, "0")}` : "—"} · ${s.gold >= 0 ? "+" : ""}${s.gold}`;
        board.appendChild(chip);
      }
    }
```

(If app.js already has a mm:ss formatter — search `padStart(2, "0")` — reuse it instead of inlining.)

- [ ] **Step 5: CSS**

In `public/style.css` (match the file's existing var/color conventions — read neighboring tile styles first):

```css
/* Race replay: a rejected word slams in red on the active row, then wipes. */
.tile.reject {
  background: #5b1a1a;
  border-color: #b91c1c;
  color: #fff;
  animation: reject-shake 0.35s;
}
@keyframes reject-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-3px); }
  40%, 80% { transform: translateX(3px); }
}
.grid-row { position: relative; } /* only if not already positioned — check first */
.replay-sting {
  position: absolute;
  right: -2.2em;
  top: 50%;
  transform: translateY(-50%);
  color: #f87171;
  font-weight: 700;
  animation: sting-fade 0.9s forwards;
}
@keyframes sting-fade {
  from { opacity: 1; }
  to { opacity: 0; transform: translateY(-130%); }
}
.replay-chip {
  margin-top: 0.35rem;
  font-size: 0.8rem;
  opacity: 0.85;
  text-align: center;
}
```

- [ ] **Step 6: Suite + guards**

Run: `npm test && npm run typecheck && npx vitest run test/ios-input-zoom.test.ts`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js public/style.css public/locales/en.js
git commit -m "feat(replay): ▶ Watch replay — compressed full-field playback with duds, stings, closing chips"
```

---

### Task 9: Smoke + ship

- [ ] **Step 1: Local smoke (`npm run dev`, two browser tabs)**

1. Create an arena room in tab A, join in tab B, race with a bot if present.
2. Mid-race: tab B sees tab A's colors only (no letters), no `tape` key on snapshots in devtools Network/WS frames.
3. Submit a dud ("BENAN") in tab A mid-race.
4. Finish the race. Both tabs: every board's letters appear instantly; "▶ Watch replay" visible.
5. Click it: boards wipe and replay — typing fills, the dud flashes red with −50, guesses flip at compressed pace, WON/OUT land in order; chips show time + gold at the end.
6. Click again mid-replay: skips to final boards + chips.
7. Rematch: button hides, chips clear, new round records a fresh tape (finish again → replay shows round 2 only).
8. Verify a seeded ghost race still replays normally (regression: reject events in the shared tape are skipped).

- [ ] **Step 2: Ship**

```bash
bash dev/ship.sh
```

Then post the Post-Deploy Summary (≤5 bullets, ≤3 test steps on wordul.com).

---

## Self-review notes (already applied)

- Spec §"Tape every multiplayer round" → Task 2. §"Tape rejects" → Tasks 1+3. §"Ship at finished" → Task 4. §"replay-core" → Tasks 5+6. §"Letter reveal" → Task 7. §"Trigger + playback UX" + chips → Task 8. §"Testing" → Tasks 1, 4, 5, 6 (unit) + Task 9 (gating smoke; the DO has no unit harness, so snapshot gating is covered by the `tapeForSnapshot` unit test + WS-frame inspection in smoke step 2).
- Types consistent: `rejectFlash {word, sinceMs}`, `replay.usernames`, `realFinishMs` Map used identically in Tasks 5/6/8.
- Line numbers are from main @ 2026-06-06 (commit 6d7fc91) — re-locate by searching the quoted code, not by line, if the file has drifted.
