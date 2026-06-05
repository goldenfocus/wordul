# Arena Ghost Replay (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared arena room link never dead-ends — late visitors race the same word against a keystroke-accurate ghost replay of the original field, and arena races start with a real 3-2-1-GO.

**Architecture:** Seeded arena rooms mint a challenge (`/c/<id>`) for each round's word at race start, record a spectator-safe event tape (typing lengths + color masks, never letters) during the race, and post it to the Challenge DO at finish. The "room full" rejection becomes an `arena_handoff` message that routes the visitor into the existing challenge solo-race, where a client-side scheduler replays the tape through the same opponent-rendering path used live. Arena auto-start reuses the duel countdown phase.

**Tech Stack:** Cloudflare Workers + Durable Objects (TypeScript, `src/`), vanilla ES-module client (`public/`), vitest.

**Worktree:** `/Users/vibeyang/wordul/.claude/worktrees/ghost-replay` (branch `ghost-replay`). All commands run from there. Spec: `docs/superpowers/specs/2026-06-05-arena-ghost-replay-design.md`.

**House testing style (important):** this repo tests *pure cores* (`src/*-core.ts`, `public/*.js` pure modules), not DO classes — there is no DO test harness. DO/room wiring is kept thin, verified by `npm run typecheck` + source-invariant tests (see `test/room-core.test.ts` "snapshot strips internal rematch fields", which greps `src/room.ts` source). Follow that pattern; do NOT try to instantiate `Room` in vitest.

---

### Task 1: `src/ghost-core.ts` — pure tape logic

**Files:**
- Create: `src/ghost-core.ts`
- Test: `test/ghost-core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/ghost-core.test.ts
import { describe, it, expect } from "vitest";
import { newTape, tapePush, TAPE_EVENT_CAP, type GhostTape } from "../src/ghost-core.ts";

const mkTape = (): GhostTape =>
  newTape(5, 6, [{ username: "paul", host: true }, { username: "maya", host: false }]);

describe("newTape", () => {
  it("stamps shape + roster and starts empty", () => {
    const t = mkTape();
    expect(t.v).toBe(1);
    expect(t.wordLength).toBe(5);
    expect(t.maxGuesses).toBe(6);
    expect(t.players).toEqual([{ username: "paul", host: true }, { username: "maya", host: false }]);
    expect(t.events).toEqual([]);
  });
});

describe("tapePush", () => {
  it("appends in order", () => {
    const t = mkTape();
    tapePush(t, { t: 100, u: "paul", k: "typing", len: 1 });
    tapePush(t, { t: 250, u: "paul", k: "typing", len: 2 });
    expect(t.events.map((e) => e.t)).toEqual([100, 250]);
  });

  it("clamps a backwards clock to stay monotonic", () => {
    const t = mkTape();
    tapePush(t, { t: 500, u: "paul", k: "typing", len: 1 });
    tapePush(t, { t: 400, u: "maya", k: "typing", len: 1 }); // skewed
    expect(t.events[1].t).toBe(500);
  });

  it("drops events past the cap", () => {
    const t = mkTape();
    for (let i = 0; i < TAPE_EVENT_CAP + 10; i++) tapePush(t, { t: i, u: "paul", k: "typing", len: 1 });
    expect(t.events.length).toBe(TAPE_EVENT_CAP);
  });

  it("a guess event carries masks only — letters can never enter a tape", () => {
    const t = mkTape();
    tapePush(t, { t: 900, u: "paul", k: "guess", mask: ["hot", "warm", "cold", "cold", "cold"], status: "playing" });
    tapePush(t, { t: 1500, u: "paul", k: "finish", status: "won", guesses: 3 });
    const json = JSON.stringify(t);
    expect(json).not.toContain("word");   // no `word` key anywhere in a tape
    expect(json).not.toContain("CRANE");  // sanity: no letter payloads
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ghost-core.test.ts`
Expected: FAIL — `Cannot find module '../src/ghost-core.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// src/ghost-core.ts — pure ghost-tape logic (unit-tested). A tape is the spectator-safe
// event stream of one seeded Arena race: length-only typing pulses, color-mask guess
// commits, and finish stamps — NEVER letters or the answer (the same hidden-word rule
// the live spectator boards follow). Recorded by the Room DO, stored on the Challenge
// DO, replayed client-side so a late visitor races the original field.
import type { Color } from "./color.ts";

export type GhostEvent =
  | { t: number; u: string; k: "typing"; len: number }
  | { t: number; u: string; k: "guess"; mask: Color[]; status: "playing" | "won" | "lost" }
  | { t: number; u: string; k: "finish"; status: "won" | "lost"; guesses: number };

export type GhostTape = {
  v: 1;
  wordLength: number;
  maxGuesses: number;
  players: { username: string; host: boolean }[]; // host = the original human racer
  events: GhostEvent[];                           // ascending t (ms since GO)
};

// Backstop only — a real race is a few hundred events.
export const TAPE_EVENT_CAP = 5000;

export function newTape(
  wordLength: number,
  maxGuesses: number,
  players: { username: string; host: boolean }[],
): GhostTape {
  return { v: 1, wordLength, maxGuesses, players, events: [] };
}

// Append, clamping a skewed clock so t stays monotonic, dropping past the cap.
export function tapePush(tape: GhostTape, ev: GhostEvent): void {
  if (tape.events.length >= TAPE_EVENT_CAP) return;
  const last = tape.events[tape.events.length - 1];
  if (last && ev.t < last.t) ev.t = last.t;
  tape.events.push(ev);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ghost-core.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ghost-core.ts test/ghost-core.test.ts
git commit -m "feat(ghost): pure ghost-tape core — spectator-safe race event stream"
```

---

### Task 2: Challenge DO stores + serves tapes (wordless)

**Files:**
- Modify: `src/challenge-core.ts`
- Modify: `src/challenge.ts`
- Modify: `src/types.ts` (re-export line only)
- Test: `test/challenge-core.test.js`

- [ ] **Step 1: Write the failing test (append to `test/challenge-core.test.js`)**

Match the file's existing import style (it imports from `../src/challenge-core.ts`).

```js
describe("ghostsOf", () => {
  const base = {
    id: "Ab3Xy", word: "CRANE", wordLength: 5, owner: "paul",
    ownerScore: "4/6", ownerGrid: [], createdAt: 1, attempts: [],
  };

  it("returns null ghosts when no tape was filed", () => {
    expect(ghostsOf(base)).toEqual({ ghosts: null });
  });

  it("returns the tape and NEVER the word", () => {
    const tape = {
      v: 1, wordLength: 5, maxGuesses: 6,
      players: [{ username: "paul", host: true }],
      events: [{ t: 900, u: "paul", k: "guess", mask: ["hot", "hot", "hot", "hot", "hot"], status: "won" }],
    };
    const out = ghostsOf({ ...base, ghosts: tape });
    expect(out.ghosts).toEqual(tape);
    expect(JSON.stringify(out)).not.toContain("CRANE");
  });
});
```

Add `ghostsOf` to the import at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/challenge-core.test.js`
Expected: FAIL — `ghostsOf` is not exported

- [ ] **Step 3: Implement**

In `src/challenge-core.ts`:

```ts
import type { GhostTape } from "./ghost-core.ts";
```

Add to `ChallengeState` (after `attempts`):

```ts
  ghosts?: GhostTape;  // original race's replay tape (masks only); absent on plain challenges
```

Add at the bottom:

```ts
// The wordless ghost view — the ONLY shape /ghosts may return (answer never ships).
export function ghostsOf(state: ChallengeState): { ghosts: GhostTape | null } {
  return { ghosts: state.ghosts ?? null };
}
```

In `src/challenge.ts`, import `ghostsOf` and `toMeta, computeRecord` stay as-is; add three routes before the final `return new Response("not found", ...)`:

```ts
    // File the original race's ghost tape. First write wins — a rematch round minting a
    // NEW challenge id files its own tape; this id's tape is immutable once set.
    if (req.method === "POST" && url.pathname === "/tape") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      if (state.ghosts) return Response.json({ ok: true });
      const b = (await req.json().catch(() => null)) as { ghosts?: import("./ghost-core.ts").GhostTape } | null;
      if (!b?.ghosts || !Array.isArray(b.ghosts.events)) return new Response("bad request", { status: 400 });
      state.ghosts = b.ghosts;
      await this.ctx.storage.put("state", state);
      return Response.json({ ok: true });
    }

    // Wordless replay feed for the challenge client (same trust model as /meta).
    if (req.method === "GET" && url.pathname === "/ghosts") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      return Response.json(ghostsOf(state));
    }

    // Stamp the owner's real result once they finish (seeded Arena mints the challenge
    // BEFORE the race resolves, so ownerScore starts empty and lands here).
    if (req.method === "POST" && url.pathname === "/owner-result") {
      const state = await this.load();
      if (!state) return new Response("not found", { status: 404 });
      const b = (await req.json().catch(() => null)) as { ownerScore?: string; ownerGrid?: string[][] } | null;
      if (typeof b?.ownerScore === "string") state.ownerScore = b.ownerScore;
      if (Array.isArray(b?.ownerGrid)) state.ownerGrid = b.ownerGrid;
      await this.ctx.storage.put("state", state);
      return Response.json({ ok: true });
    }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run test/challenge-core.test.js && npm run typecheck`
Expected: PASS / no type errors

- [ ] **Step 5: Commit**

```bash
git add src/challenge-core.ts src/challenge.ts test/challenge-core.test.js
git commit -m "feat(ghost): challenge DO stores + serves the race tape, wordless"
```

---

### Task 3: Worker route `GET /api/challenge/<id>/ghosts`

**Files:**
- Modify: `src/worker.ts` (next to the `/meta` route at ~line 188)

- [ ] **Step 1: Add the route** (directly after the `/meta` block)

```ts
    // Challenge ghost tape (no word): GET /api/challenge/<id>/ghosts
    const ghostsMatch = url.pathname.match(/^\/api\/challenge\/([0-9A-Za-z]{5})\/ghosts$/);
    if (ghostsMatch && req.method === "GET") {
      const stub = env.CHALLENGE.get(env.CHALLENGE.idFromName(ghostsMatch[1]));
      return stub.fetch(new Request("https://do/ghosts", { method: "GET" }));
    }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat(ghost): /api/challenge/<id>/ghosts route"
```

---

### Task 4: Types — `shareChallengeId` + `arena_handoff`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the snapshot field** (in `RoomSnapshot`, after the `challengeId` line at ~101)

```ts
  shareChallengeId?: string | null; // seeded Arena: the challenge minted from THIS round's word — public, late visitors race it (+ its ghost tape)
```

- [ ] **Step 2: Add the server message** (in `ServerMessage`, after the `"error"` line)

```ts
  | { type: "arena_handoff"; challengeId: string; host: string; hostDone: boolean } // seeded room is 1-human: route the visitor to the share challenge instead of a dead-end
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck` → clean.

```bash
git add src/types.ts
git commit -m "feat(ghost): shareChallengeId snapshot field + arena_handoff message type"
```

---

### Task 5: Room DO — mint at start, post results, handoff, countdown, tape

This is the one fat task because all five hooks live in `src/room.ts` and share state. Keep each edit surgical; the invariant test in Step 8 locks the load-bearing wiring.

**Files:**
- Modify: `src/room.ts`
- Test: `test/room-ghost-wiring.test.ts` (source-invariant style, like `test/room-core.test.ts:154`)

- [ ] **Step 1: Write the failing source-invariant test**

```ts
// test/room-ghost-wiring.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// House pattern (see room-core.test.ts "snapshot strips internal rematch fields"):
// no DO harness exists, so load-bearing room.ts wiring is locked by source assertions.
const src = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");

describe("seeded arena ghost wiring (spec 2026-06-05-arena-ghost-replay)", () => {
  it("seeded auto-start enters the countdown, not an instant runStart", () => {
    const block = src.slice(src.indexOf("FILL the remaining seats"), src.indexOf("Public human Arena room"));
    expect(block).toContain("beginCountdown");
    expect(block).not.toContain('runStart("arena")');
  });

  it("seeded rejections hand off to the share challenge instead of a bare room-full", () => {
    expect(src).toContain("sendArenaHandoffOrFull");
    expect(src).toContain('"arena_handoff"');
  });

  it("runStart mints the share challenge for seeded rooms", () => {
    expect(src).toContain("shareChallengeId = id");
    expect(src).toContain("share-challenge mint");
  });

  it("tape posts to the challenge DO at finish", () => {
    expect(src).toContain('"https://do/tape"');
  });

  it("tape records masks via tapePush, never a word field", () => {
    // every tapePush callsite in room.ts must not pass the guess word
    const calls = src.split("tapePush(").slice(1).map((s) => s.slice(0, 200));
    expect(calls.length).toBeGreaterThanOrEqual(4); // human typing, bot typing, guess, finish
    for (const c of calls) expect(c).not.toMatch(/\bword\b/);
  });
});
```

- [ ] **Step 2: Run it — FAIL**

Run: `npx vitest run test/room-ghost-wiring.test.ts`
Expected: all 5 fail.

- [ ] **Step 3: State + imports**

In `src/room.ts`:
- Add imports: `import { makeChallengeId } from "./challenge-core.ts";` and `import { newTape, tapePush, type GhostTape } from "./ghost-core.ts";`
- Constructor initial state object (~line 124, after `challengeId: null,`): add `shareChallengeId: null,`
- Class field next to `chatThrottle` (~line 95):

```ts
  /** Ghost tape for the current seeded round. In-memory only — a mid-race eviction
   *  loses it (replay degrades to no ghosts); typing must never hammer DO storage. */
  private tape: GhostTape | null = null;
```

- Restore backfill (in `blockConcurrencyWhile`, near the other backfills): `if (restored.shareChallengeId === undefined) restored.shareChallengeId = null;`

- [ ] **Step 4: Mint in `runStart`** — insert right after `if (!this.state.word) return false;` (~line 725):

```ts
    // Seeded Arena: publish this round's word as a challenge so a late visitor to the
    // shared link races the same word (+ the field's ghost tape, filed at finish).
    // Awaited — the handoff path needs the id now — but a mint hiccup only costs the
    // late-visitor experience; the race itself starts regardless.
    if (this.state.seed && !this.state.challengeId) {
      this.state.shareChallengeId = null;
      const host = this.state.players.find((p) => !p.isBot)?.username ?? this.state.owner;
      const id = makeChallengeId();
      try {
        const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(id));
        const res = await cs.fetch(new Request("https://do/", {
          method: "POST",
          body: JSON.stringify({ id, word: this.state.word, wordLength: this.state.wordLength, owner: host, ownerScore: "", ownerGrid: [] }),
          headers: { "content-type": "application/json" },
        }));
        if (res.ok) this.state.shareChallengeId = id;
        else console.error("share-challenge mint non-ok", res.status);
      } catch (e) { console.error("share-challenge mint failed", (e as Error).message); }
      this.tape = newTape(this.state.wordLength, this.state.maxGuesses,
        this.state.players.map((p) => ({ username: p.username, host: !p.isBot })));
    }
```

Note: `snapshotFor` spreads `...this.state`, so `shareChallengeId` ships to clients automatically — it is public by design (it's the share link), so it is NOT added to the strip list.

- [ ] **Step 5: Result posting in `applyGuess`** — replace the existing challenge-attempt block (~line 991):

```ts
    // Post the finished human's result: to the pinned challenge this room is PLAYING
    // (challengeId), or to the challenge this seeded room PUBLISHED (shareChallengeId).
    const cid = this.state.challengeId ?? this.state.shareChallengeId;
    if (cid && (player.status === "won" || player.status === "lost") && !player.isBot) {
      const solved = player.status === "won";
      const score = solved ? `${player.guesses.length}/${this.state.maxGuesses}` : `X/${this.state.maxGuesses}`;
      const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(cid));
      this.ctx.waitUntil(cs.fetch(new Request("https://do/attempt", {
        method: "POST",
        body: JSON.stringify({ username: player.username, score, solved, guesses: player.guesses.length }),
        headers: { "content-type": "application/json" },
      })));
      // Seeded share-challenge: the human IS the challenge owner — stamp their real
      // result + color grid onto the card late visitors see.
      if (cid === this.state.shareChallengeId) {
        this.ctx.waitUntil(cs.fetch(new Request("https://do/owner-result", {
          method: "POST",
          body: JSON.stringify({ ownerScore: score, ownerGrid: encodeSolveGrid(player.guesses) }),
          headers: { "content-type": "application/json" },
        })));
      }
    }
```

(`encodeSolveGrid` is already imported in room.ts.)

- [ ] **Step 6: Handoff instead of "room full"** — replace the bodies of the two seeded rejections in `onHello` (~lines 398 and 427) with `this.sendArenaHandoffOrFull(ws); return;` (keep the surrounding `if` conditions and comments), and add the helper near `userFor`:

```ts
  // A seeded room seats exactly 1 human — but its word is published as a challenge.
  // Instead of a dead-end "room full", hand the visitor the challenge id: same word,
  // the original field's ghosts, the host's score to beat. Falls back to the legacy
  // error only when the mint failed or the race hasn't produced a host yet.
  private sendArenaHandoffOrFull(ws: WebSocket): void {
    const id = this.state.shareChallengeId;
    const host = this.state.players.find((p) => !p.isBot);
    if (!id || !host) {
      this.send(ws, { type: "error", message: "room full" });
      return;
    }
    this.send(ws, {
      type: "arena_handoff",
      challengeId: id,
      host: host.username,
      hostDone: host.status !== "playing" || this.state.phase === "finished",
    });
  }
```

- [ ] **Step 7: Countdown for seeded auto-start** — in `onHello` (~line 517) replace `await this.runStart("arena");` with:

```ts
      this.closeArena(); // a human committed — delist now, not 3s later at go-live
      await this.beginCountdown();
```

And in `goLive` (~line 810) change the `runStart` caller name so the system line reads right for arena:

```ts
    const ok = await this.runStart(this.state.seed ? "arena" : (this.state.throne?.username ?? "the duel"));
```

(`beginCountdown` is duel-named but generic: stamps `goAt`, arms the alarm; the `alarm()` countdown branch calls `goLive` → `runStart`, and the client overlay keys off the phase. The restore guard at ~160 already drops a stale countdown to lobby; a returning human's hello re-enters this block and re-arms it.)

- [ ] **Step 8: Tape recording hooks** — all gated on `this.tape && this.state.seed && this.state.startedAt`:

Add a tiny private helper near `elapsedSinceStart`:

```ts
  private tapeT(at: number): number {
    return Math.max(0, at - (this.state.startedAt ?? at));
  }
```

In `onTyping` (~line 904), right before the `const payload = ...` line:

```ts
    if (this.tape && this.state.seed && this.state.startedAt) {
      tapePush(this.tape, { t: this.tapeT(Date.now()), u: username, k: "typing", len });
    }
```

In `emitBotTyping` (~line 922), right before its `const payload = ...` line (note the var is `n` here):

```ts
    if (this.tape && this.state.seed && this.state.startedAt) {
      tapePush(this.tape, { t: this.tapeT(Date.now()), u: username, k: "typing", len: n });
    }
```

In `applyGuess`, right before `this.emitAcceptedGuess(player, mask, now);` (~line 971):

```ts
    if (this.tape && this.state.seed && this.state.startedAt) {
      tapePush(this.tape, { t: this.tapeT(now), u: player.username, k: "guess", mask, status: player.status });
    }
```

In the same method, inside the `if (priorStatus === "playing" && player.status !== "playing")` block, after `this.emitPlayerFinished(...)`:

```ts
      if (this.tape && this.state.seed && this.state.startedAt) {
        tapePush(this.tape, { t: this.tapeT(now), u: player.username, k: "finish", status: player.status === "won" ? "won" : "lost", guesses: player.guesses.length });
      }
```

And in the outpaced-losers loop (after `this.emitPlayerFinished(other, "lost", now);`):

```ts
          if (this.tape && this.state.seed && this.state.startedAt) {
            tapePush(this.tape, { t: this.tapeT(now), u: other.username, k: "finish", status: "lost", guesses: other.guesses.length });
          }
```

- [ ] **Step 9: File the tape at finish** — at the END of `finishGame()` (~line 1377, after the existing `waitUntil`):

```ts
    // Seeded Arena: file the race's ghost tape with the share challenge so late
    // visitors race the original field in replay. The DO is first-write-wins, so a
    // re-entry can't double-file; best-effort like every other post-finish write.
    if (this.state.seed && this.state.shareChallengeId && this.tape && this.tape.events.length) {
      const cs = this.env.CHALLENGE.get(this.env.CHALLENGE.idFromName(this.state.shareChallengeId));
      const body = JSON.stringify({ ghosts: this.tape });
      this.ctx.waitUntil(cs.fetch(new Request("https://do/tape", {
        method: "POST", body, headers: { "content-type": "application/json" },
      })));
    }
```

- [ ] **Step 10: Run everything**

Run: `npx vitest run test/room-ghost-wiring.test.ts && npm run typecheck && npm test`
Expected: new test PASS, typecheck clean, full suite green (the wiring must not break `room-core`/`duel`/`arena-core` suites).

- [ ] **Step 11: Commit**

```bash
git add src/room.ts test/room-ghost-wiring.test.ts
git commit -m "feat(ghost): room DO — challenge mint, handoff, arena 3-2-1, tape record+file"
```

---

### Task 6: `public/ghost-replay.js` — pure replay math

**Files:**
- Create: `public/ghost-replay.js`
- Test: `test/ghost-replay.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/ghost-replay.test.js
import { describe, it, expect } from "vitest";
import { ghostPlayersAt, nextEventAfter, hostFinish } from "../public/ghost-replay.js";

const TAPE = {
  v: 1, wordLength: 5, maxGuesses: 6,
  players: [{ username: "paul", host: true }, { username: "maya", host: false }],
  events: [
    { t: 100, u: "paul", k: "typing", len: 1 },
    { t: 220, u: "paul", k: "typing", len: 2 },
    { t: 300, u: "paul", k: "typing", len: 1 },                    // backspace
    { t: 900, u: "paul", k: "guess", mask: ["hot", "cold", "cold", "cold", "warm"], status: "playing" },
    { t: 1200, u: "maya", k: "typing", len: 3 },
    { t: 2000, u: "paul", k: "guess", mask: ["hot", "hot", "hot", "hot", "hot"], status: "won" },
    { t: 2000, u: "paul", k: "finish", status: "won", guesses: 2 },
    { t: 2000, u: "maya", k: "finish", status: "lost", guesses: 0 },
  ],
};

describe("ghostPlayersAt", () => {
  it("starts everyone pristine before the first event", () => {
    const [paul, maya] = ghostPlayersAt(TAPE, 0);
    expect(paul.guesses).toEqual([]);
    expect(paul.typingLen).toBe(0);
    expect(paul.status).toBe("playing");
    expect(paul.ghost).toBe(true);
    expect(paul.ghostHost).toBe(true);
    expect(maya.ghostHost).toBe(false);
  });

  it("replays typing including the backspace", () => {
    expect(ghostPlayersAt(TAPE, 250)[0].typingLen).toBe(2);
    expect(ghostPlayersAt(TAPE, 350)[0].typingLen).toBe(1); // backspace landed
  });

  it("a guess commit clears typing and lands a mask-only row", () => {
    const paul = ghostPlayersAt(TAPE, 1000)[0];
    expect(paul.guesses.length).toBe(1);
    expect(paul.guesses[0].word).toBe("");           // letters never in a tape
    expect(paul.guesses[0].mask[0]).toBe("hot");
    expect(paul.typingLen).toBe(0);
  });

  it("finish stamps land statuses", () => {
    const [paul, maya] = ghostPlayersAt(TAPE, 9999);
    expect(paul.status).toBe("won");
    expect(maya.status).toBe("lost");
  });
});

describe("nextEventAfter", () => {
  it("walks the schedule and exhausts", () => {
    expect(nextEventAfter(TAPE, 0)).toBe(100);
    expect(nextEventAfter(TAPE, 100)).toBe(220);
    expect(nextEventAfter(TAPE, 2000)).toBe(null);
  });
});

describe("hostFinish", () => {
  it("finds the host's result to beat", () => {
    expect(hostFinish(TAPE)).toEqual({ username: "paul", t: 2000, status: "won", guesses: 2 });
  });
  it("null when the host never finished (eviction-truncated tape)", () => {
    expect(hostFinish({ ...TAPE, events: TAPE.events.slice(0, 4) })).toBe(null);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`npx vitest run test/ghost-replay.test.js`)

- [ ] **Step 3: Implement**

```js
// public/ghost-replay.js — pure ghost-tape replay math (no DOM), unit-tested in
// test/ghost-replay.test.js (the countdown.js pattern). A tape is the spectator-safe
// stream the original seeded race recorded: typing lengths, mask-only guess commits,
// finish stamps. app.js owns the clock + DOM; this module only answers "what does the
// field look like at elapsed t".

// Ghost player objects shaped like snapshot players, so the existing board renderer
// draws them unchanged. `word` is always "" — letters never exist in a tape.
export function ghostPlayersAt(tape, t) {
  const players = new Map(tape.players.map((p) => [p.username, {
    username: p.username, connected: true, status: "playing", guesses: [],
    points: 0, pointsSpent: 0, ready: false, role: "duelist",
    ghost: true, ghostHost: !!p.host, typingLen: 0,
  }]));
  for (const ev of tape.events) {
    if (ev.t > t) break; // events are recorded ascending
    const g = players.get(ev.u);
    if (!g) continue;
    if (ev.k === "typing") g.typingLen = ev.len;
    else if (ev.k === "guess") {
      g.guesses.push({ word: "", mask: ev.mask });
      g.typingLen = 0;
      g.status = ev.status;
    } else if (ev.k === "finish") {
      g.status = ev.status;
      g.typingLen = 0;
    }
  }
  return [...players.values()];
}

// Offset of the next event strictly after t, or null when the tape is exhausted.
export function nextEventAfter(tape, t) {
  for (const ev of tape.events) if (ev.t > t) return ev.t;
  return null;
}

// The host ghost's finish (the result to beat), or null on a truncated tape.
export function hostFinish(tape) {
  const host = tape.players.find((p) => p.host);
  if (!host) return null;
  for (const ev of tape.events) {
    if (ev.u === host.username && ev.k === "finish") {
      return { username: ev.u, t: ev.t, status: ev.status, guesses: ev.guesses };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run — PASS**, plus `npx vitest run test/module-graph.test.ts` (new public module must not break the graph rules; if it complains, follow its error message — `ghost-replay.js` imports nothing, so it should pass).

- [ ] **Step 5: Commit**

```bash
git add public/ghost-replay.js test/ghost-replay.test.js
git commit -m "feat(ghost): pure client replay math — field state at t, scheduler feed"
```

---

### Task 7: Client wiring — handoff, tap-armed GO, replay driver, verdict

**Files:**
- Modify: `public/app.js`
- Modify: `public/style.css` (ghost badge + ready overlay)

No new text inputs → the iOS input-zoom ratchet is untouched, but run it anyway in Step 7.

- [ ] **Step 1: Import + state.** Add to the import block (~line 22): `import { ghostPlayersAt, nextEventAfter, hostFinish } from "/ghost-replay.js";`
In `showChallenge` (the `game.*` reset block ~800) and in the equivalent reset in `showRoom`/`joinRoom` (find where `game.replay = []` is set, ~817 and ~740): add `game.ghostTape = null; game.ghostT0 = null; game.ghostPlayers = [];`

- [ ] **Step 2: Handoff handler.** In `onServerMessage`, before the final `} else if (msg.type === "error") {` branch (~2077):

```js
  } else if (msg.type === "arena_handoff") {
    // The arena race already has its 1 human — but their word is published as a
    // challenge. Route there: same word, their ghosts, a score to beat. No dead end.
    const who = msg.host ? `@${msg.host}` : "your friend";
    toast(msg.hostDone
      ? `${who} already raced this word — your turn.`
      : `${who} is racing this word right now — race it too.`, { duration: 4200 });
    navigate(`/c/${msg.challengeId}`);
```

- [ ] **Step 3: Ghost fetch + tap-armed GO in `showChallenge`.** After the `/meta` fetch succeeds (~797), fetch the tape:

```js
  let ghosts = null;
  try {
    const gr = await fetch(`/api/challenge/${id}/ghosts`);
    if (gr.ok) ghosts = (await gr.json()).ghosts;
  } catch { /* plain challenge — no ghosts */ }
```

Then where `game.autoStart = true;` is set (~814), replace with:

```js
  game.ghostTape = ghosts && Array.isArray(ghosts.events) && ghosts.events.length ? ghosts : null;
  // A plain challenge keeps the instant board; a GHOST challenge arms a tap — the tap
  // is the start gun AND (vX) the browser audio-unlock gesture.
  game.autoStart = !game.ghostTape;
```

And after `connectChallenge(id);` add:

```js
  if (game.ghostTape) showGhostReadyOverlay();
```

New function near `triggerStartCelebration`:

```js
// Tap-armed start for a ghost challenge: the field is loaded, the player fires the gun.
// On tap: local 3-2-1 (reuses the duel overlay), then the start message — the server
// flips to playing and the snapshot transition starts the replay clock (see onServerMessage).
function showGhostReadyOverlay() {
  const tape = game.ghostTape;
  const host = tape && tape.players.find((p) => p.host);
  const el = document.createElement("div");
  el.id = "ghostReady";
  el.className = "ghost-ready-overlay";
  // DOM-built, no innerHTML — usernames are server-sanitized, but textContent keeps
  // the no-markup-injection rule airtight (house style, same as toast()).
  const card = document.createElement("div");
  card.className = "ghost-ready-card";
  const title = document.createElement("div");
  title.className = "ghost-ready-title";
  title.textContent = "👻 Ghost race";
  const sub = document.createElement("div");
  sub.className = "ghost-ready-sub";
  const others = tape.players.length - 1;
  const fieldLine = (host ? `@${host.username}` : "The field")
    + (others > 0 ? ` + ${others} racer${others > 1 ? "s" : ""}` : "");
  sub.appendChild(document.createTextNode(`${fieldLine} already ran this word.`));
  sub.appendChild(document.createElement("br"));
  sub.appendChild(document.createTextNode("Beat the replay — every keystroke, as it happened."));
  const btn = document.createElement("button");
  btn.className = "hero-btn";
  btn.id = "ghostGoBtn";
  const label = document.createElement("span");
  label.className = "hero-btn-label";
  label.textContent = "I'm ready — GO";
  btn.appendChild(label);
  card.append(title, sub, btn);
  el.appendChild(card);
  document.body.appendChild(el);
  btn.addEventListener("click", () => {
    el.remove();
    startCountdownOverlay(Date.now() + 3000);
    setTimeout(() => { stopCountdownOverlay(); send({ type: "start" }); }, 3000);
  });
}
```

- [ ] **Step 4: Replay driver.** In `onServerMessage`'s snapshot branch, two insertions:

(a) Right after `game.snapshot = msg.room;` (~1794) — re-graft ghosts onto every fresh snapshot (server snapshots only ever contain the solo player in a challenge room):

```js
    if (game.ghostPlayers && game.ghostPlayers.length) {
      game.snapshot.players = [...msg.room.players, ...game.ghostPlayers];
    }
```

(b) In the transition-into-playing block (~1851, next to `triggerStartCelebration()`):

```js
      if (game.ghostTape && game.ghostT0 == null) startGhostReplay();
```

New driver functions (place after `updateOpponentGhost`):

```js
// --- Ghost replay driver: one clock from GO, events fire at their recorded offsets ---
let ghostTimer = null;
function startGhostReplay() {
  game.ghostT0 = Date.now();
  game.ghostPlayers = ghostPlayersAt(game.ghostTape, 0);
  tickGhostReplay();
}

function tickGhostReplay() {
  clearTimeout(ghostTimer);
  if (!game.ghostTape || game.ghostT0 == null || !game.snapshot) return;
  const t = Date.now() - game.ghostT0;
  const prev = game.ghostPlayers;
  const next = ghostPlayersAt(game.ghostTape, t);
  game.ghostPlayers = next;
  const real = game.snapshot.players.filter((p) => !p.ghost);
  game.snapshot.players = [...real, ...next];
  // Typing pulses ride the existing ghost-fill path; commits/finishes need a render.
  let structural = false;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i], b = next[i];
    if (!a || a.guesses.length !== b.guesses.length || a.status !== b.status) { structural = true; break; }
  }
  for (const g of next) {
    if (g.typingLen > 0) game.typing.set(g.username, g.typingLen);
    else game.typing.delete(g.username);
  }
  if (structural) {
    // Drama reacts to ghost commits exactly like live opponents.
    dramaUpdate([...real, ...prev], game.snapshot.players, {
      me: getUsername(), maxGuesses: game.snapshot.maxGuesses ?? 6,
      phase: game.snapshot.phase, isDaily: false,
    });
    render();
  } else {
    for (const g of next) updateOpponentGhost(g.username);
  }
  const at = nextEventAfter(game.ghostTape, t);
  if (at != null) ghostTimer = setTimeout(tickGhostReplay, Math.max(16, at - t));
}
```

Also in `leaveRoom()` (find it; it tears down the socket) add: `clearTimeout(ghostTimer); game.ghostTape = null; game.ghostT0 = null; game.ghostPlayers = [];`

- [ ] **Step 5: Verdict + ghost badges.**

(a) Verdict — in the snapshot branch where `me` finishing is detectable (the existing `if (me && prevMe && me.guesses.length > prevMe.guesses.length)` neighborhood): add after the gold choreography block, guarded so it fires once:

```js
    // Ghost race verdict: my finish vs the host ghost's recorded finish.
    if (game.ghostTape && me && prevMe && prevMe.status === "playing" && me.status !== "playing") {
      const hf = hostFinish(game.ghostTape);
      if (hf && game.ghostT0 != null) {
        const myMs = Date.now() - game.ghostT0;
        const ds = Math.abs(Math.round((hf.t - myMs) / 1000));
        const iWon = me.status === "won" && (hf.status !== "won" || myMs < hf.t || (myMs === hf.t && me.guesses.length <= hf.guesses));
        toast(iWon
          ? `You beat @${hf.username} by ${ds}s 🏆`
          : me.status === "won" ? `@${hf.username} had you by ${ds}s — rematch?` : `@${hf.username} survives this round 👻`,
          { duration: 5000 });
      }
    }
```

(b) Badges — in `renderBoards` next to the throne badge (~2810):

```js
    if (p.ghost) {
      const b = document.createElement("span");
      b.className = "badge ghost-badge";
      b.textContent = p.ghostHost ? "👑 ghost" : "👻";
      name.appendChild(b);
    }
```

- [ ] **Step 6: CSS.** Append to `public/style.css`:

```css
/* --- Ghost race (arena replay) --- */
.ghost-ready-overlay {
  position: fixed; inset: 0; z-index: 60; display: grid; place-items: center;
  background: color-mix(in srgb, var(--bg, #0b0b10) 78%, transparent);
  backdrop-filter: blur(6px);
}
.ghost-ready-card { text-align: center; padding: 28px 24px; max-width: 420px; }
.ghost-ready-title { font-size: 1.6rem; font-weight: 800; margin-bottom: 10px; }
.ghost-ready-sub { opacity: 0.85; line-height: 1.45; margin-bottom: 20px; }
.badge.ghost-badge { opacity: 0.8; }
.player-board:has(.ghost-badge) .grid { opacity: 0.92; }
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run typecheck`
Expected: full suite green, including `test/ios-input-zoom.test.ts` and `test/no-lateral-scroll.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat(ghost): client — handoff routing, tap-armed GO, live ghost replay, verdict"
```

---

### Task 8: Share surfaces send `/c/<id>` from seeded arena rooms

**Files:**
- Modify: `public/app.js` (`shareRoomInvite` ~1118, `copyRoomLink` ~1156)

- [ ] **Step 1: `shareRoomInvite`** — replace the first line of the function:

```js
  // A seeded arena room publishes its word as a challenge — share THAT (it works for
  // unlimited friends, with ghosts), never the 1-human room link.
  const cid = game.snapshot && game.snapshot.shareChallengeId;
  const inviteUrl = cid
    ? `${location.origin}/c/${cid}`
    : `${location.origin}/@${game.owner}/${game.slug}`;
```

And in the `navigator.share` payload, when `cid` is set use `text: "Race my word on Wordul — beat my ghost!"` (keep the existing text otherwise):

```js
        text: cid ? "Race my word on Wordul — beat my ghost!" : `Race me on Wordul in ${game.owner}'s room!`,
```

- [ ] **Step 2: `copyRoomLink`** — same substitution for its URL construction (read the function first; it builds the same `/@owner/slug` URL).

- [ ] **Step 3: Verify + commit**

Run: `npm test` → green.

```bash
git add public/app.js
git commit -m "feat(ghost): arena share surfaces hand out the challenge link"
```

---

### Task 9: Full gauntlet + ship

- [ ] **Step 1:** `npm test && npm run typecheck` — all green.
- [ ] **Step 2:** Manual smoke via `npm run dev`: join an arena room from the hub → expect 3-2-1 overlay → race vs bots → finish → from a SECOND browser profile, open the room URL → expect handoff toast + ghost-ready overlay → tap GO → ghosts replay (typing fills, masked rows, drama stings) → finish → verdict toast. Share button → URL is `/c/<id>`.
- [ ] **Step 3:** Ship per house rules: `bash dev/ship.sh` (tests → rebase → backup tag → merge main → CI deploys). Post the Post-Deploy Summary.

---

## Self-review notes (spec → task map)

- v1.1 mint → Task 5 (steps 3–5) · v1.2 handoff → Tasks 4, 5 (step 6), 7 (step 2) · v1.3 share → Task 8 · v1.4 countdown → Task 5 (step 7) + existing client overlay · v1.5 record → Tasks 1, 2, 5 (steps 8–9) · v1.6 replay → Tasks 3, 6, 7. Word-leak audit → Task 1 (no-letters test), Task 2 (`ghostsOf` wordless test), Task 5 (tapePush source invariant).
- vX/vY (voice/video) are explicitly out of scope for this plan.
- Known accepted edges (per spec): mid-countdown 2nd visitor before mint completes → legacy "room full" (3s window); DO eviction mid-race → tape lost, challenge still playable.
