# The Real Solve — Full Keystroke Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every daily solve as a keystroke-level event tape (letters, backspaces, clears, rejects, power-ups, voice lines) and play it back as a "watch the real solve" mode in the leaderboard replay modal, gated by the existing finisher token.

**Architecture:** Client recorder (`tape-recorder.js`) buffers compact events during play and mirrors to localStorage; one WS `{type:"tape"}` upload on finish; Room DO validates (`src/tape-core.ts`) and stores under `tape:<username>` (separate storage key — never inside `state`, so snapshots/persists stay light); `GET /api/daily/<date>/tape` proxies to the room behind the finisher-token gate; pure scheduler (`tape-replay-core.js`) compresses think-gaps and a DOM driver (`tape-replay.js`) plays it in the modal with timer + speed controls + recorded voice lines.

**Tech Stack:** Vanilla JS modules in `public/` (ES imports, no bundler), Cloudflare Workers + Durable Objects in `src/` (TypeScript), vitest (jsdom for client tests — `test/setup.js` already handles Node 25 localStorage).

**Spec:** `docs/superpowers/specs/2026-06-07-real-solve-replay-design.md`

---

## Read-first context (10 minutes, saves hours)

- **CLAUDE.md hub-file rule:** `public/app.js` (cap 6000 lines), `src/room.ts` (cap 2600), `src/worker.ts` (cap 1300) take ONLY imports + wiring (`test/loc-ratchet.test.ts` enforces). All logic lives in the new modules.
- **Many tabs ship to this repo daily.** Line numbers below were verified on `origin/main` @ `d0750d7` but WILL drift — every step gives a grep-able anchor; trust the anchor, not the number.
- Patterns to imitate: `src/ghost-core.ts` (event tape + cap), `public/stamp-replay-core.js` (pure scheduler), `test/daily-board-unlock.test.ts` (Room DO test harness), `test/board-replay-dom.test.js` (DOM driver test).
- **Event vocabulary** (single-letter kinds, array events `[t, kind, data?]`, t = ms since recording start, monotonic):
  - `"k"` letter typed (data: `"S"`), `"b"` backspace, `"c"` clear-line, `"e"` guess submitted, `"r"` submit rejected, `"p"` power-up/penalty (data: string tag), `"v"` companion line (data: `{raw, text, voice, revealVoice, answer?}`).
  - An `"e"` is **accepted** unless an `"r"` appears before the next `"k"/"b"/"c"/"e"` event. Accepted rows flip with the mask from the leaderboard entry's `grid[row]` — the tape never duplicates masks or final words.

---

### Task 1: `public/tape-recorder.js` — recording core + localStorage mirror

**Files:**
- Create: `public/tape-recorder.js`
- Test: `test/tape-recorder.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/tape-recorder.test.js — the daily solve recorder: pure event buffer + crash mirror.
import { describe, it, expect, beforeEach } from "vitest";
import {
  newTape, tapePush, TAPE_EVENT_CAP,
  tapeStart, tapeRecord, tapeForUpload, tapeMirror, tapeClear, tapeIsLive,
} from "../public/tape-recorder.js";

describe("tape core", () => {
  it("records events as [t, kind, data?] with ms offsets from t0", () => {
    const tape = newTape(1000);
    tapePush(tape, "k", "S", 1500);
    tapePush(tape, "b", undefined, 2000);
    expect(tape.events).toEqual([[500, "k", "S"], [1000, "b"]]);
  });
  it("clamps a skewed clock so t stays monotonic", () => {
    const tape = newTape(1000);
    tapePush(tape, "k", "A", 2000);
    tapePush(tape, "k", "B", 1500); // clock went backwards
    expect(tape.events[1][0]).toBe(1000); // clamped to previous t
  });
  it("stops at the event cap and marks truncated", () => {
    const tape = newTape(0);
    for (let i = 0; i <= TAPE_EVENT_CAP + 5; i++) tapePush(tape, "k", "A", i);
    expect(tape.events.length).toBe(TAPE_EVENT_CAP);
    expect(tape.truncated).toBe(true);
  });
});

describe("live recorder + mirror", () => {
  beforeEach(() => { localStorage.clear(); tapeClear("2026-06-07"); });
  it("is a no-op before tapeStart (recording must never break gameplay)", () => {
    expect(() => tapeRecord("k", "A")).not.toThrow();
    expect(tapeIsLive()).toBe(false);
  });
  it("records after start and mirrors to localStorage every 10 events", () => {
    tapeStart("2026-06-07", 0);
    for (let i = 0; i < 9; i++) tapeRecord("k", "A", i);
    expect(localStorage.getItem("wr.tape:2026-06-07")).toBeNull();
    tapeRecord("k", "B", 9); // 10th event → mirror flush
    const mirrored = JSON.parse(localStorage.getItem("wr.tape:2026-06-07"));
    expect(mirrored.events.length).toBe(10);
  });
  it("tapeForUpload returns the live tape once, then clears live + mirror", () => {
    tapeStart("2026-06-07", 0);
    tapeRecord("k", "A", 100);
    const up = tapeForUpload("2026-06-07");
    expect(up.events).toEqual([[100, "k", "A"]]);
    expect(tapeIsLive()).toBe(false);
    expect(localStorage.getItem("wr.tape:2026-06-07")).toBeNull();
    expect(tapeForUpload("2026-06-07")).toBeNull(); // nothing left
  });
  it("tapeForUpload falls back to a crash mirror when no live tape exists", () => {
    localStorage.setItem("wr.tape:2026-06-07", JSON.stringify({ v: 1, t0: 0, truncated: false, events: [[5, "k", "Z"]] }));
    const up = tapeForUpload("2026-06-07");
    expect(up.events).toEqual([[5, "k", "Z"]]);
  });
  it("tapeStart resumes from a same-day mirror instead of losing earlier events", () => {
    localStorage.setItem("wr.tape:2026-06-07", JSON.stringify({ v: 1, t0: 0, truncated: false, events: [[5, "k", "Z"]] }));
    tapeStart("2026-06-07", 1000);
    tapeRecord("k", "A", 1100);
    const up = tapeForUpload("2026-06-07");
    expect(up.events[0]).toEqual([5, "k", "Z"]);   // mirror preserved
    expect(up.events[1][1]).toBe("k");             // new event appended after it
    expect(up.events[1][0]).toBeGreaterThanOrEqual(5); // still monotonic
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tape-recorder.test.js`
Expected: FAIL — `Cannot find module '../public/tape-recorder.js'`

- [ ] **Step 3: Write the implementation**

```js
// public/tape-recorder.js — records the real daily solve as a compact event tape:
// every letter, backspace, clear, submit, reject, power-up, and companion line, with
// ms offsets from recording start. Uploaded ONCE on finish (app.js sends {type:"tape"});
// the server stores it behind the finisher-token gate. Mirrored to localStorage every
// few events so a crashed tab can still file its tape on the next visit.
// Pattern: src/ghost-core.ts (cap + monotonic clamp), kept DOM-free for tests.
export const TAPE_EVENT_CAP = 5000; // backstop — a real solve is a few hundred events
const MIRROR_EVERY = 10;            // localStorage flush cadence (events)
const LS_PREFIX = "wr.tape:";

export function newTape(now = Date.now()) {
  return { v: 1, t0: now, truncated: false, events: [] };
}

// Append [t, kind, data?]: clamp a skewed clock so t stays monotonic, drop past the cap.
export function tapePush(tape, kind, data, now = Date.now()) {
  if (tape.truncated) return;
  if (tape.events.length >= TAPE_EVENT_CAP) { tape.truncated = true; return; }
  let t = Math.max(0, now - tape.t0);
  const last = tape.events[tape.events.length - 1];
  if (last && t < last[0]) t = last[0];
  tape.events.push(data === undefined ? [t, kind] : [t, kind, data]);
}

// --- the live singleton app.js records into -----------------------------------
let live = null; // { tape, key, dirty }

function readMirror(date) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + date);
    const tape = raw ? JSON.parse(raw) : null;
    return tape && Array.isArray(tape.events) ? tape : null;
  } catch { return null; }
}

// Start (or resume) recording for a date. A same-day mirror means the tab reloaded
// mid-game — resume from it so the early guesses aren't lost; t0 shifts so new events
// stay monotonic after the mirrored ones.
export function tapeStart(date, now = Date.now()) {
  const mirror = readMirror(date);
  const tape = mirror ?? newTape(now);
  if (mirror) {
    const lastT = mirror.events.length ? mirror.events[mirror.events.length - 1][0] : 0;
    tape.t0 = now - lastT; // new events land at >= lastT
  }
  live = { tape, key: LS_PREFIX + date, dirty: 0 };
}

export function tapeIsLive() { return !!live; }

// Record one event. Wrapped so a recorder bug can NEVER break gameplay.
export function tapeRecord(kind, data, now = Date.now()) {
  if (!live) return;
  try {
    tapePush(live.tape, kind, data, now);
    if (++live.dirty >= MIRROR_EVERY) {
      live.dirty = 0;
      localStorage.setItem(live.key, JSON.stringify(live.tape));
    }
  } catch { /* never throw into the input path */ }
}

// The finish hand-off: return the tape to upload (live recording, else a crash
// mirror from an earlier tab), and clear both — the upload is one-shot.
export function tapeForUpload(date) {
  try {
    const tape = live && live.key === LS_PREFIX + date ? live.tape : readMirror(date);
    live = null;
    localStorage.removeItem(LS_PREFIX + date);
    if (!tape || !tape.events.length) return null;
    return { events: tape.events, truncated: !!tape.truncated };
  } catch { return null; }
}

export function tapeMirror(date) { return readMirror(date); }
export function tapeClear(date) {
  live = null;
  try { localStorage.removeItem(LS_PREFIX + date); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/tape-recorder.test.js`
Expected: PASS (all 8)

- [ ] **Step 5: Commit**

```bash
git add public/tape-recorder.js test/tape-recorder.test.js
git commit -m "feat(replay): tape recorder core — event buffer, cap, crash mirror"
```

---

### Task 2: `src/tape-core.ts` — server-side tape validation

**Files:**
- Create: `src/tape-core.ts`
- Test: `test/tape-core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/tape-core.test.ts — upload validation: shape, kinds, monotonic t, byte cap.
import { describe, it, expect } from "vitest";
import { validateTapeEvents, TAPE_EVENT_CAP, TAPE_BYTE_CAP } from "../src/tape-core.ts";

const ok = [[0, "k", "S"], [120, "k", "T"], [300, "b"], [900, "e"], [1400, "r"], [1500, "c"],
  [3000, "p", "vowels"], [3200, "v", { raw: "oof", text: "oof", voice: { mode: "silent" } }]];

describe("validateTapeEvents", () => {
  it("accepts a well-formed tape", () => {
    expect(validateTapeEvents(ok)).toEqual(ok);
  });
  it("rejects non-arrays, empty tapes, and over-cap tapes", () => {
    expect(validateTapeEvents(null)).toBeNull();
    expect(validateTapeEvents([])).toBeNull();
    expect(validateTapeEvents(Array.from({ length: TAPE_EVENT_CAP + 1 }, (_, i) => [i, "b"]))).toBeNull();
  });
  it("rejects unknown kinds, bad timestamps, and non-monotonic t", () => {
    expect(validateTapeEvents([[0, "z"]])).toBeNull();          // unknown kind
    expect(validateTapeEvents([[-5, "b"]])).toBeNull();          // negative t
    expect(validateTapeEvents([["x", "b"]])).toBeNull();         // non-numeric t
    expect(validateTapeEvents([[100, "b"], [50, "b"]])).toBeNull(); // t went backwards
  });
  it("rejects a letter event that isn't a single A-Z character", () => {
    expect(validateTapeEvents([[0, "k", "SS"]])).toBeNull();
    expect(validateTapeEvents([[0, "k", 7]])).toBeNull();
  });
  it("rejects tapes over the byte cap", () => {
    const fat = [[0, "v", { raw: "x".repeat(TAPE_BYTE_CAP) }]];
    expect(validateTapeEvents(fat)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tape-core.test.ts`
Expected: FAIL — `Cannot find module '../src/tape-core.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// src/tape-core.ts — pure validation for an uploaded solve tape (unit-tested).
// A tape is the keystroke-level record of one daily solve, recorded client-side
// (public/tape-recorder.js) and stored on the Room DO under `tape:<username>` —
// a SEPARATE storage key, never inside room state, so snapshots stay light.
// Served only behind the finisher token (same gate as real letter rows).

export const TAPE_EVENT_CAP = 5000;       // mirrors the client cap (ghost-core precedent)
export const TAPE_BYTE_CAP = 32 * 1024;   // serialized backstop

export type TapeEvent = [number, string, ...unknown[]];

const KINDS = new Set(["k", "b", "c", "e", "r", "s", "p", "v"]);

// Returns the events array if valid, else null. Per-kind checks stay light — the
// byte cap bounds abuse; "k" is checked tightly because it renders into the board.
export function validateTapeEvents(raw: unknown): TapeEvent[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TAPE_EVENT_CAP) return null;
  let prev = 0;
  for (const ev of raw) {
    if (!Array.isArray(ev) || ev.length < 2 || ev.length > 3) return null;
    const [t, kind, data] = ev as [unknown, unknown, unknown];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t < prev) return null;
    if (typeof kind !== "string" || !KINDS.has(kind)) return null;
    if (kind === "k" && !(typeof data === "string" && /^[A-Z]$/.test(data))) return null;
    prev = t;
  }
  try {
    if (JSON.stringify(raw).length > TAPE_BYTE_CAP) return null;
  } catch { return null; }
  return raw as TapeEvent[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/tape-core.test.ts`
Expected: PASS (all 5)

- [ ] **Step 5: Commit**

```bash
git add src/tape-core.ts test/tape-core.test.ts
git commit -m "feat(replay): server tape validation core"
```

---

### Task 3: Room DO — accept `{type:"tape"}` uploads + token-gated `GET /tape`

**Files:**
- Modify: `src/types.ts` (~line 142, anchor `export type ClientMessage =`)
- Modify: `src/room.ts` (two small wirings — see anchors)
- Test: `test/room-tape.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/room-tape.test.ts — tape upload + serving on the daily Room DO. Invariants:
//   1. Only a FINISHED daily player's own tape is stored; first write wins.
//   2. GET /tape returns events only with the finisher token (the letters gate).
// Harness modeled on test/daily-board-unlock.test.ts.
import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

import { Room } from "../src/room.ts";

const greens = ["hot", "hot", "hot", "hot", "hot"];

function makeRoom() {
  const store = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => { store.set(k, v); },
    },
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    getWebSockets: () => [] as unknown[],
    waitUntil: vi.fn(),
  };
  const env = { USER: { idFromName: (n: string) => n, get: () => ({ fetch: vi.fn() }) } };
  const room = new Room(ctx as never, env as never) as never as {
    state: Record<string, unknown>;
    fetch: (r: Request) => Promise<Response>;
    webSocketMessage: (ws: unknown, raw: string) => Promise<void>;
  };
  room.state = {
    path: "daily/2026-06-07", owner: "daily", slug: "2026-06-07", name: "daily",
    phase: "playing", word: "CRANE", winner: "yan", startedAt: 1, finishedAt: null,
    round: 1, chat: [], wordLength: 5, maxGuesses: 6, mode: "daily", scoreboard: [],
    history: [], edition: "default", isDaily: true, story: null, challengeId: null,
    rotation: "koth", queue: [], throne: null,
    finisherSecret: "secret-123",
    players: [
      { username: "yan", status: "won", guesses: [{ word: "CRANE", mask: greens }],
        points: 120, pointsSpent: 0, isBot: false, scored: true, goldAwarded: 120 },
      { username: "bob", status: "playing", guesses: [],
        points: 0, pointsSpent: 0, isBot: false },
    ],
  };
  return { room, store };
}

const wsFor = (username: string) => ({
  deserializeAttachment: () => ({ username }),
  send: vi.fn(),
});

const upload = (room: ReturnType<typeof makeRoom>["room"], who: string, events: unknown) =>
  room.webSocketMessage(wsFor(who) as never, JSON.stringify({ type: "tape", events }));

const EVENTS = [[0, "k", "C"], [80, "k", "R"], [160, "k", "A"], [240, "k", "N"], [320, "k", "E"], [900, "e"]];

describe("tape upload", () => {
  it("stores a finished player's valid tape under tape:<username>", async () => {
    const { room, store } = makeRoom();
    await upload(room, "yan", EVENTS);
    expect(store.get("tape:yan")).toEqual({ events: EVENTS, truncated: false });
  });
  it("rejects a still-playing player (no spoiler tapes mid-game)", async () => {
    const { room, store } = makeRoom();
    await upload(room, "bob", EVENTS);
    expect(store.get("tape:bob")).toBeUndefined();
  });
  it("first write wins — a second upload never overwrites", async () => {
    const { room, store } = makeRoom();
    await upload(room, "yan", EVENTS);
    await upload(room, "yan", [[0, "b"]]);
    expect(store.get("tape:yan")).toEqual({ events: EVENTS, truncated: false });
  });
  it("drops malformed events", async () => {
    const { room, store } = makeRoom();
    await upload(room, "yan", [[0, "zap"]]);
    expect(store.get("tape:yan")).toBeUndefined();
  });
});

describe("GET /tape", () => {
  it("returns the tape only with the finisher token", async () => {
    const { room } = makeRoom();
    await upload(room, "yan", EVENTS);
    const okRes = await room.fetch(new Request("https://do/tape?u=yan&t=secret-123"));
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ events: EVENTS, truncated: false });
    const noTok = await room.fetch(new Request("https://do/tape?u=yan"));
    expect(noTok.status).toBe(403);
    const badTok = await room.fetch(new Request("https://do/tape?u=yan&t=wrong"));
    expect(badTok.status).toBe(403);
  });
  it("404s when the player has no tape", async () => {
    const { room } = makeRoom();
    const res = await room.fetch(new Request("https://do/tape?u=bob&t=secret-123"));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/room-tape.test.ts`
Expected: FAIL — tape uploads ignored (`store.get("tape:yan")` undefined) and `GET /tape` 404s through to room.fetch's `not found`.

- [ ] **Step 3: Add the ClientMessage member (src/types.ts)**

Anchor: `grep -n "export type ClientMessage" src/types.ts`. Add one union member alongside the others:

```ts
  | { type: "tape"; events: unknown; truncated?: boolean }
```

- [ ] **Step 4: Wire room.ts — the handler case, onTape, and the GET route**

(a) In the `handle()` switch (anchor: `case "typing":`), add:

```ts
      case "tape":
        return this.onTape(ws, msg.events, msg.truncated);
```

(b) Add the handler next to `onTyping` (import `validateTapeEvents` from `./tape-core.ts` at the top of room.ts):

```ts
  // The real-solve tape: a finished daily player files their keystroke record exactly
  // once. Stored as a SEPARATE storage key (never in state — snapshots stay light);
  // served only behind the finisher token (see /tape below). Guard is status-based,
  // not scored-based: scorePlayer broadcasts the terminal snapshot BEFORE the mint
  // confirms scored=true, and the client uploads on that first terminal snapshot.
  private async onTape(ws: WebSocket, events: unknown, truncated?: boolean): Promise<void> {
    const username = this.userFor(ws);
    if (!username || !this.state.isDaily) return;
    const player = this.state.players.find((p) => p.username === username);
    if (!player || player.status === "playing") return;
    const key = `tape:${username}`;
    if (await this.ctx.storage.get(key)) return; // first write wins
    const valid = validateTapeEvents(events);
    if (!valid) return;
    await this.ctx.storage.put(key, { events: valid, truncated: !!truncated });
  }
```

(c) In `fetch()`, directly BEFORE the leaderboard block (anchor: `url.pathname.endsWith("/leaderboard")`), add:

```ts
    // The real-solve tape: keystroke-level replay, gated by the SAME finisher token
    // as letter rows — a tape contains typed letters (including the answer).
    if (req.method === "GET" && url.pathname.endsWith("/tape")) {
      const t = url.searchParams.get("t") ?? "";
      if (!this.state.finisherSecret || t !== this.state.finisherSecret) {
        return new Response("forbidden", { status: 403 });
      }
      const u = (url.searchParams.get("u") ?? "").toLowerCase().trim();
      const rec = await this.ctx.storage.get(`tape:${u}`);
      if (!rec) return new Response("not found", { status: 404 });
      return Response.json(rec); // { events, truncated }
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/room-tape.test.ts`
Expected: PASS (all 6)

- [ ] **Step 6: Run the full server suite + typecheck (room.ts is a hub file — prove no regressions)**

Run: `npm run typecheck && npx vitest run test/daily-board-unlock.test.ts test/room-core.test.ts test/room-capacity.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/room.ts test/room-tape.test.ts
git commit -m "feat(replay): Room DO accepts one tape per finished daily player, serves it behind the finisher token"
```

---

### Task 4: Worker route — `GET /api/daily/<date>/tape`

**Files:**
- Modify: `src/worker.ts` (anchor: the `dailyLb` block, `/api\\/daily\\/.*leaderboard`)

(Worker routes here are thin proxies and have no fetch-level test harness — the room test above covers the logic; this is wiring, verified by typecheck + the dev-server smoke in Task 7.)

- [ ] **Step 1: Add the route directly AFTER the daily leaderboard proxy block**

```ts
    // Real-solve tape: /api/daily/<YYYY-MM-DD>/tape?u=<player>&t=<finisher token>.
    // Proxies to the day's Room DO; the room enforces the token gate (tapes contain letters).
    const dailyTape = url.pathname.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})\/tape$/);
    if (dailyTape && req.method === "GET") {
      const u = normalizeUsername(url.searchParams.get("u") ?? "");
      const t = url.searchParams.get("t") ?? "";
      const stub = env.ROOM.get(env.ROOM.idFromName(`daily/${dailyTape[1]}`));
      return stub.fetch(new Request(
        `https://do/tape?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`,
        { method: "GET" },
      ));
    }
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run check-graph`
Expected: PASS (no missing-module refs, worker compiles)

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat(replay): /api/daily/<date>/tape proxy route"
```

---

### Task 5: app.js wiring — record during play, upload on finish

**Files:**
- Modify: `public/app.js` (import + 8 one-line hooks; anchors below — line numbers drift, anchors don't)

This task is wiring-only (hub-file rule); the logic was tested in Tasks 1–3. Verify with the full client suite + Task 7's live smoke.

- [ ] **Step 1: Add the import** (top of app.js, beside `import { playVoice } from "/voice.js";`)

```js
import { tapeStart, tapeRecord, tapeForUpload, tapeIsLive } from "/tape-recorder.js";
```

- [ ] **Step 2: Start recording when a daily becomes playable**

Anchor: `grep -n "wr.dailyToken" public/app.js` — the snapshot handler that stores the finisher token already has the daily `date` in scope; the same handler region sees every snapshot. In the snapshot (`msg.type === "snapshot"` / room-update) handler, where `game.isDaily` and the date string are available, add:

```js
    // Real-solve tape: arm the recorder the moment the daily is playable for me.
    // tapeStart resumes a same-day crash mirror, so a mid-game reload keeps its early events.
    if (game.isDaily && msg.room.phase === "playing" && !tapeIsLive()) {
      const meT = msg.room.players.find((p) => p.username === getUsername());
      if (meT && meT.status === "playing") tapeStart(dailyDate);
    }
```

(`dailyDate` = whatever variable that handler already uses for the `wr.dailyToken:${date}` key — reuse it verbatim; do NOT recompute today's date, the room may be a past-day room once spec 2 lands.)

- [ ] **Step 3: Hook the input path** (each is one line; recording is a no-op outside a live daily)

| Anchor (grep) | After the line that... | Add |
|---|---|---|
| `function typeLetter(l)` | appends to `game.pending` | `tapeRecord("k", l.toUpperCase());` |
| `function backspace()` | shrinks `game.pending` | `tapeRecord("b");` |
| `function clearRow({ silent` | passes the `!game.pending.length` early-return | `tapeRecord("c");` |
| `send({ type: "guess"` in `submitGuess` | sends the guess | `tapeRecord("e");` |
| `msg.type === "invalid_guess"` | calls `showCompanion("invalid")` | `tapeRecord("r");` |
| `handlePowerupMessage(powerupsCtx, msg)` | enters the power-up branch | `tapeRecord("p", msg.type);` |

- [ ] **Step 4: Record which companion line fired**

In `showCompanion` (anchor: `function showCompanion(event, ctx`), after the destructured `companionReact` result and the `if (!text) return;` guard:

```js
  // Tape the line that actually fired (recorder is live only during a daily solve) —
  // the replay re-speaks exactly this line through the viewer's voice engine.
  tapeRecord("v", { raw, text, voice, revealVoice, answer: ctx.answer });
```

- [ ] **Step 5: Upload once on finish**

In the same snapshot-handler region as Step 2, after the daily end-game handling (anchor: `announceGameEnd` call for the daily, or the `dailyCashOutReady` line):

```js
    // File the tape exactly once when MY daily game reaches a terminal status. Covers
    // win, loss, AND resign; also files a crash-mirror from an earlier tab (the server
    // accepts the first write only, so a duplicate send is harmless).
    if (game.isDaily && me && me.status !== "playing" && !game.tapeSent) {
      const tape = tapeForUpload(dailyDate);
      if (tape) { game.tapeSent = true; send({ type: "tape", events: tape.events, truncated: tape.truncated }); }
    }
```

(`game.tapeSent` resets wherever `game` state is re-initialized per room join — confirm the `game = {...}` reset site includes it implicitly by being absent → undefined → falsy. No explicit init needed.)

- [ ] **Step 6: Verify**

Run: `npm run check-graph && npm test`
Expected: PASS — and `test/loc-ratchet.test.ts` still green (app.js gained ~20 lines of wiring).

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat(replay): record the daily solve tape during play, upload on finish"
```

---

### Task 6: `public/tape-replay-core.js` — pure playback scheduler

**Files:**
- Create: `public/tape-replay-core.js`
- Test: `test/tape-replay-core.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/tape-replay-core.test.js — pure scheduler: real rhythm in, playable steps out.
// Gap > GAP_MS compresses to one fixed think beat; "e" resolves to commit/reject by
// lookahead; every step carries trueT so the driver's timer shows TRUE elapsed time.
import { describe, it, expect } from "vitest";
import { buildTapeSchedule, GAP_MS, THINK_MS } from "../public/tape-replay-core.js";

describe("buildTapeSchedule", () => {
  it("keeps real relative timing for small gaps", () => {
    const { steps } = buildTapeSchedule([[0, "k", "A"], [800, "k", "B"]]);
    expect(steps[0]).toMatchObject({ dt: 0, kind: "type", letter: "A", trueT: 0 });
    expect(steps[1]).toMatchObject({ dt: 800, kind: "type", letter: "B", trueT: 800 });
  });
  it("compresses a long think into one fixed beat that reports the true gap", () => {
    const { steps } = buildTapeSchedule([[0, "k", "A"], [60000, "k", "B"]]);
    expect(steps[1]).toMatchObject({ dt: 0, kind: "think", trueMs: 60000, fixed: true });
    expect(steps[1].dt + THINK_MS >= THINK_MS).toBe(true);
    expect(steps[2]).toMatchObject({ kind: "type", letter: "B", dt: THINK_MS, trueT: 60000 });
  });
  it("resolves an accepted submit to a commit with the right row index", () => {
    const events = [[0, "k", "A"], [100, "e"], [200, "k", "B"], [300, "e"]];
    const { steps } = buildTapeSchedule(events);
    const commits = steps.filter((s) => s.kind === "commit");
    expect(commits.map((s) => s.row)).toEqual([0, 1]);
  });
  it("resolves a rejected submit: the e emits nothing, the r emits the shake", () => {
    const events = [[0, "k", "A"], [100, "e"], [400, "r"], [950, "c"], [1200, "k", "B"], [1300, "e"]];
    const { steps } = buildTapeSchedule(events);
    expect(steps.filter((s) => s.kind === "commit").map((s) => s.row)).toEqual([0]); // only the 2nd e commits
    expect(steps.some((s) => s.kind === "reject")).toBe(true);
    expect(steps.some((s) => s.kind === "clear")).toBe(true);
  });
  it("passes voice and power-up payloads through", () => {
    const line = { raw: "oof", text: "oof", voice: { mode: "silent" } };
    const { steps } = buildTapeSchedule([[0, "v", line], [10, "p", "vowels"]]);
    expect(steps[0]).toMatchObject({ kind: "voice", line });
    expect(steps[1]).toMatchObject({ kind: "power", what: "vowels" });
  });
  it("reports total playback ms and true elapsed ms separately", () => {
    const out = buildTapeSchedule([[0, "k", "A"], [60000, "k", "B"]]);
    expect(out.trueMs).toBe(60000);
    expect(out.totalMs).toBeLessThan(5000); // think compressed
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tape-replay-core.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```js
// public/tape-replay-core.js — pure scheduler for the REAL solve replay (the deep-dive
// mode; the synthetic skim replay stays stamp-replay-core.js). Raw tape events in,
// ordered steps out. Real relative rhythm, except a gap > GAP_MS compresses into ONE
// fixed think beat carrying the true duration ("💭 thinking… 1m12s"). Each step also
// carries trueT (the original clock) so the driver's timer chip shows TRUE elapsed.
// Steps: {dt, trueT, kind, ...} — dt = ms after the previous step; the driver divides
// dt by the speed multiplier EXCEPT when fixed:true (think beats stay one beat at 4x).
// An "e" submit commits a row unless an "r" arrives before the next k/b/c/e (the
// reject path); rejected rows emit nothing on the e — the r's shake + the taped "c"
// sweep tell the story, exactly like live play.
export const GAP_MS = 3000;   // a pause longer than this is a "think"
export const THINK_MS = 1200; // every think plays as one fixed beat

export function buildTapeSchedule(events) {
  const steps = [];
  let prevTrue = 0;
  let playT = 0;
  let row = 0;
  const evs = Array.isArray(events) ? events : [];
  for (let i = 0; i < evs.length; i++) {
    const [t, kind, data] = evs[i];
    const gap = Math.max(0, t - prevTrue);
    let dt = gap;
    if (gap > GAP_MS) {
      steps.push({ dt: 0, trueT: prevTrue, kind: "think", trueMs: gap, fixed: true });
      dt = THINK_MS;
    }
    prevTrue = t;
    playT += dt;
    if (kind === "k") steps.push({ dt, trueT: t, kind: "type", letter: data });
    else if (kind === "b") steps.push({ dt, trueT: t, kind: "back" });
    else if (kind === "c") steps.push({ dt, trueT: t, kind: "clear" });
    else if (kind === "r") steps.push({ dt, trueT: t, kind: "reject" });
    else if (kind === "p") steps.push({ dt, trueT: t, kind: "power", what: data });
    else if (kind === "v") steps.push({ dt, trueT: t, kind: "voice", line: data });
    else if (kind === "e") {
      if (rejected(evs, i)) continueWithoutStep(steps, dt, t);
      else steps.push({ dt, trueT: t, kind: "commit", row: row++ });
    }
  }
  return { steps, totalMs: playT, trueMs: prevTrue };
}

// An e is rejected iff an r appears before the next k/b/c/e.
function rejected(evs, i) {
  for (let j = i + 1; j < evs.length; j++) {
    const k = evs[j][1];
    if (k === "r") return true;
    if (k === "k" || k === "b" || k === "c" || k === "e") return false;
  }
  return false;
}

// A rejected e still spends its dt on the clock — fold it into the next step so
// playback timing stays aligned without emitting a no-op step.
function continueWithoutStep(steps, dt, t) {
  steps.push({ dt, trueT: t, kind: "noop" });
}
```

**Note for the implementer:** the `noop` step is deliberate (simplest correct timing); the driver ignores `noop` visually. If the tests above need a `noop` allowance, filter `kind !== "noop"` in the commit/reject assertions — do NOT weaken the timing assertions.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/tape-replay-core.test.js`
Expected: PASS (all 6)

- [ ] **Step 5: Commit**

```bash
git add public/tape-replay-core.js test/tape-replay-core.test.js
git commit -m "feat(replay): pure tape playback scheduler — real rhythm, capped thinks"
```

---

### Task 7: `public/tape-replay.js` — DOM driver (board, timer, controls, voice)

**Files:**
- Create: `public/tape-replay.js`
- Test: `test/tape-replay-dom.test.js` (model: `test/board-replay-dom.test.js`)

- [ ] **Step 1: Read the two reference files first**

Read `public/board-replay.js` and `public/stamp-replay.js` end to end, plus `renderStamp` in `public/daily-card.js` — the driver must reuse the `.daily-stamp` tile classes so the modal CSS just works.

- [ ] **Step 2: Write the failing test**

```js
// test/tape-replay-dom.test.js — driver smoke: builds the stage, applies steps, timer
// shows TRUE elapsed. Steps are applied via the exported applyStep (pure-ish DOM fn)
// so the test doesn't wait on real timers.
import { describe, it, expect, beforeEach } from "vitest";
import { buildTapeStage, applyStep, fmtClock } from "../public/tape-replay.js";

describe("tape replay driver", () => {
  let mount;
  beforeEach(() => { document.body.innerHTML = "<div id='m'></div>"; mount = document.getElementById("m"); });

  it("builds a board of empty tile rows + a timer chip + controls", () => {
    const stage = buildTapeStage(mount, { rows: 6, cols: 5, grid: ["ggggg"], words: ["CRANE"] });
    expect(mount.querySelectorAll(".tape-row").length).toBe(6);
    expect(mount.querySelectorAll(".tape-row .tile").length).toBe(30);
    expect(mount.querySelector(".tape-timer")).toBeTruthy();
    expect(stage.cursor).toEqual({ row: 0, col: 0 });
  });
  it("type/back edit the current row; commit flips it with the grid mask", () => {
    const stage = buildTapeStage(mount, { rows: 6, cols: 5, grid: ["gyxxg"], words: ["CRANE"] });
    for (const l of "CRANE") applyStep(stage, { kind: "type", letter: l, trueT: 0 });
    expect(mount.querySelector(".tape-row").textContent).toBe("CRANE");
    applyStep(stage, { kind: "back", trueT: 0 });
    expect(mount.querySelector(".tape-row").textContent).toBe("CRAN");
    applyStep(stage, { kind: "type", letter: "E", trueT: 0 });
    applyStep(stage, { kind: "commit", row: 0, trueT: 9000 });
    const tiles = mount.querySelectorAll(".tape-row")[0].querySelectorAll(".tile");
    expect(tiles[0].classList.contains("hot")).toBe(true);   // g
    expect(tiles[1].classList.contains("warm")).toBe(true);  // y
    expect(tiles[2].classList.contains("cold")).toBe(true);  // x
    expect(stage.cursor.row).toBe(1);
  });
  it("think shows the true pause; timer renders true elapsed", () => {
    const stage = buildTapeStage(mount, { rows: 6, cols: 5, grid: [], words: [] });
    applyStep(stage, { kind: "think", trueMs: 72000, trueT: 72000 });
    expect(mount.querySelector(".tape-think").textContent).toContain("1m 12s");
    expect(mount.querySelector(".tape-timer").textContent).toBe(fmtClock(72000));
  });
  it("clear empties the current row; reject shakes it", () => {
    const stage = buildTapeStage(mount, { rows: 6, cols: 5, grid: [], words: [] });
    applyStep(stage, { kind: "type", letter: "A", trueT: 0 });
    applyStep(stage, { kind: "reject", trueT: 100 });
    expect(mount.querySelectorAll(".tape-row")[0].classList.contains("shake")).toBe(true);
    applyStep(stage, { kind: "clear", trueT: 200 });
    expect(mount.querySelectorAll(".tape-row")[0].textContent).toBe("");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/tape-replay-dom.test.js`
Expected: FAIL — module not found

- [ ] **Step 4: Write the implementation**

```js
// public/tape-replay.js — DOM driver for the real-solve replay ("watch the real solve").
// Consumes buildTapeSchedule steps inside the leaderboard replay modal. Decoupling rule
// (daily-lb.js pattern): NEVER imports app.js. Voice goes straight to /voice.js with the
// DESCRIPTOR RECORDED IN THE TAPE (the player's world voice at solve time); the viewer's
// mute is enforced both here and inside voice.js. Timer chip always counts TRUE elapsed
// time — speed (1x/2x/4x) squeezes dt between steps but never lies about the clock.
import { buildTapeSchedule, THINK_MS } from "/tape-replay-core.js";
import { playVoice } from "/voice.js";

const MUTE_LS = "wordul.muted";
const SPEEDS = [1, 2, 4];

export function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
const fmtThink = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};
const CELL = { g: "hot", y: "warm", x: "cold" };

// Build the replay stage: empty tile rows + timer + think bubble + controls bar.
// grid/words come from the leaderboard entry (words exist — the tape fetch needed the
// same finisher token). Returns the mutable stage handle applyStep works against.
export function buildTapeStage(mount, { rows, cols, grid, words }) {
  mount.innerHTML = `
    <div class="tape-stage">
      <div class="tape-head"><span class="tape-timer">0:00</span><span class="tape-think" hidden></span></div>
      <div class="tape-board">${Array.from({ length: rows }, () =>
        `<div class="tape-row">${'<span class="tile"></span>'.repeat(cols)}</div>`).join("")}</div>
      <div class="tape-controls">
        <button type="button" class="tape-play" aria-label="Pause">⏸</button>
        <button type="button" class="tape-speed">1×</button>
        <button type="button" class="tape-skip" aria-label="Skip to next guess">⏭</button>
      </div>
    </div>`;
  return {
    mount, grid: grid ?? [], words: words ?? [], cols,
    cursor: { row: 0, col: 0 },
    rowsEls: [...mount.querySelectorAll(".tape-row")],
    timerEl: mount.querySelector(".tape-timer"),
    thinkEl: mount.querySelector(".tape-think"),
  };
}

// Apply ONE step to the stage. Exported separately so tests drive it without timers.
export function applyStep(stage, step) {
  stage.timerEl.textContent = fmtClock(step.trueT ?? 0);
  const rowEl = stage.rowsEls[stage.cursor.row];
  if (!rowEl && step.kind !== "voice") return;
  const tiles = rowEl ? rowEl.querySelectorAll(".tile") : [];
  if (step.kind === "type" && stage.cursor.col < stage.cols) {
    tiles[stage.cursor.col].textContent = step.letter;
    stage.cursor.col++;
  } else if (step.kind === "back" && stage.cursor.col > 0) {
    stage.cursor.col--;
    tiles[stage.cursor.col].textContent = "";
  } else if (step.kind === "clear") {
    tiles.forEach((t) => { t.textContent = ""; });
    stage.cursor.col = 0;
    rowEl.classList.remove("shake");
  } else if (step.kind === "reject") {
    rowEl.classList.remove("shake");
    void rowEl.offsetWidth;
    rowEl.classList.add("shake");
  } else if (step.kind === "commit") {
    const mask = String(stage.grid[step.row] ?? "");
    const word = String(stage.words[step.row] ?? "");
    tiles.forEach((t, i) => {
      if (word[i]) t.textContent = word[i]; // server truth beats taped keys
      t.classList.add(CELL[mask[i]] ?? "cold");
    });
    stage.cursor = { row: step.row + 1, col: 0 };
  } else if (step.kind === "think") {
    stage.thinkEl.hidden = false;
    stage.thinkEl.textContent = `💭 thinking… ${fmtThink(step.trueMs)}`;
    setTimeout(() => { stage.thinkEl.hidden = true; }, THINK_MS);
  } else if (step.kind === "power") {
    stage.thinkEl.hidden = false;
    stage.thinkEl.textContent = `⚡ ${step.what}`;
    setTimeout(() => { stage.thinkEl.hidden = true; }, 900);
  } else if (step.kind === "voice") {
    const l = step.line ?? {};
    if (localStorage.getItem(MUTE_LS) !== "1" && l.voice) {
      playVoice(l.voice, l.raw ?? l.text ?? "", l.text ?? l.raw ?? "", { answer: l.answer }, l.revealVoice ?? "robot");
    }
  }
}

// Play a full tape into mount. Returns { stop } so the modal can cancel on close.
export function playTapeReplay(mount, { events, grid, words, rows, cols, truncated }) {
  const stage = buildTapeStage(mount, { rows, cols, grid, words });
  const { steps } = buildTapeSchedule(events);
  let i = 0, timer = 0, paused = false, speedIdx = 0;
  const playBtn = mount.querySelector(".tape-play");
  const speedBtn = mount.querySelector(".tape-speed");
  const skipBtn = mount.querySelector(".tape-skip");
  const finish = () => {
    // Truncated tape (capped recorder): jump-cut to the final board so it always ends true.
    if (truncated) (grid ?? []).forEach((_, r) => applyStep(stage, { kind: "commit", row: r, trueT: steps.at(-1)?.trueT ?? 0 }));
    playBtn.disabled = skipBtn.disabled = true;
  };
  const next = () => {
    if (paused) return;
    if (i >= steps.length) return finish();
    const step = steps[i++];
    if (step.kind !== "noop") applyStep(stage, step);
    const upcoming = steps[i];
    if (!upcoming) return finish();
    const dt = upcoming.fixed ? upcoming.dt : upcoming.dt / SPEEDS[speedIdx];
    timer = setTimeout(next, Math.min(dt, 10000)); // belt-and-braces: no multi-minute stall
  };
  playBtn.addEventListener("click", () => {
    paused = !paused;
    playBtn.textContent = paused ? "▶" : "⏸";
    if (!paused) next();
    else clearTimeout(timer);
  });
  speedBtn.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    speedBtn.textContent = `${SPEEDS[speedIdx]}×`;
  });
  skipBtn.addEventListener("click", () => {
    clearTimeout(timer);
    while (i < steps.length && steps[i].kind !== "commit") applyStep(stage, steps[i++]);
    if (i < steps.length) applyStep(stage, steps[i++]); // land the commit itself
    if (!paused) next();
  });
  next();
  return { stop: () => { paused = true; clearTimeout(timer); } };
}
```

- [ ] **Step 5: Add the stage CSS**

Anchor: the modal styles — `grep -rn "daily-lb-modal" public/*.css` — add alongside them:

```css
/* Real-solve replay stage (tape-replay.js) */
.tape-stage { display: grid; gap: 10px; justify-items: center; }
.tape-head { display: flex; gap: 10px; align-items: center; min-height: 22px; }
.tape-timer { font-variant-numeric: tabular-nums; opacity: 0.8; font-size: 0.9rem; }
.tape-think { font-size: 0.85rem; opacity: 0.7; }
.tape-board { display: grid; gap: 4px; }
.tape-row { display: grid; grid-auto-flow: column; gap: 4px; }
.tape-row .tile { width: 34px; height: 34px; display: grid; place-items: center;
  border: 1px solid var(--border, #444); border-radius: 4px; font-weight: 700; }
.tape-row .tile.hot { background: var(--hot, #538d4e); border-color: transparent; }
.tape-row .tile.warm { background: var(--warm, #b59f3b); border-color: transparent; }
.tape-row .tile.cold { background: var(--cold, #3a3a3c); border-color: transparent; }
.tape-controls { display: flex; gap: 8px; }
.tape-controls button { min-width: 40px; }
```

(Match the variable names actually used in the existing CSS — read the tile classes in the stylesheet before pasting; reuse the site's `--hot/--warm/--cold` tokens if they exist, keep the fallbacks if not.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/tape-replay-dom.test.js`
Expected: PASS (all 4)

- [ ] **Step 7: Commit**

```bash
git add public/tape-replay.js public/tape-replay-core.js test/tape-replay-dom.test.js <the css file>
git commit -m "feat(replay): tape replay DOM driver — board, true-time timer, speed, voice"
```

---

### Task 8: Modal integration — "▶ watch the real solve"

**Files:**
- Modify: `public/daily-lb.js` (`openReplayModal`, `wireReplayRows`, `mountDailyLeaderboard`)
- Test: extend `test/daily-lb.test.js` (read it first; add a new `describe`, don't disturb existing ones)

- [ ] **Step 1: Write the failing test** (append to `test/daily-lb.test.js`, adapting to its existing helpers/mocks — it already mocks `fetch` and mounts modals; follow its conventions exactly)

```js
describe("real-solve tape mode", () => {
  it("shows the watch-the-real-solve button only when the tape endpoint 200s", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events: [[0, "k", "C"]] }) });
    const entry = { username: "yan", gold: 120, guesses: 2, won: true, grid: ["ggggg"], words: ["CRANE"] };
    const overlay = openReplayModal(entry, null, { date: "2026-06-07", token: "secret-123" });
    await Promise.resolve(); await Promise.resolve(); // let the fetch settle
    expect(overlay.querySelector(".tape-mode-btn")).toBeTruthy();
    overlay.remove();
  });
  it("stays in synthetic mode when there is no tape (404) or no token", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const entry = { username: "bob", gold: 0, guesses: 3, won: false, grid: ["xxxxx"] };
    const withToken = openReplayModal(entry, null, { date: "2026-06-07", token: "secret-123" });
    await Promise.resolve(); await Promise.resolve();
    expect(withToken.querySelector(".tape-mode-btn")).toBeNull();
    withToken.remove();
    const noOpts = openReplayModal(entry, null); // stats page path — no opts at all
    expect(noOpts.querySelector(".tape-mode-btn")).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no token → no fetch
    noOpts.remove();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/daily-lb.test.js`
Expected: the two new tests FAIL (`openReplayModal` takes no third arg yet); existing tests still PASS.

- [ ] **Step 3: Implement in daily-lb.js**

(a) Import the driver at the top: `import { playTapeReplay } from "/tape-replay.js";`

(b) `openReplayModal(entry, opener)` → `openReplayModal(entry, opener, opts = {})`. After the existing `playStampReplay(stamp)` auto-play, add:

```js
  // Real-solve deep-dive: if this player filed a tape AND the viewer holds the day's
  // finisher token, offer the full replay. Quick synthetic stays the default —
  // skim fast, dive deep. No tape / no token → the affordance simply never exists.
  let tapeStop = null;
  if (opts.date && opts.token && entry.username) {
    fetch(`/api/daily/${opts.date}/tape?u=${encodeURIComponent(entry.username)}&t=${encodeURIComponent(opts.token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((tape) => {
        if (!tape || !Array.isArray(tape.events) || !tape.events.length) return;
        const card = overlay.querySelector(".daily-lb-modal-card");
        if (!card) return; // modal already closed
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tape-mode-btn";
        btn.textContent = "▶ watch the real solve";
        card.appendChild(btn);
        btn.addEventListener("click", () => {
          btn.remove();
          const stampEl = overlay.querySelector(".daily-stamp");
          const stage = document.createElement("div");
          stampEl.replaceWith(stage);
          tapeStop = playTapeReplay(stage, {
            events: tape.events, grid: entry.grid, words: entry.words,
            rows: boardRows(cols), cols, truncated: !!tape.truncated,
          }).stop;
        });
      })
      .catch(() => {}); // tape is a bonus — its absence never breaks the modal
  }
```

…and inside the existing `close()` function add `tapeStop?.();` (stop audio/timers on dismiss).

(c) Thread opts through the wiring: `wireReplayRows(root, entries)` → `wireReplayRows(root, entries, opts)`, passing `opts` to `openReplayModal(hit, row, opts)`. In `mountDailyLeaderboard`, build it from what's already in scope:

```js
  const opts = token ? { date, token } : {};
  const wireRows = (root) => wireReplayRows(root, entries, opts);
```

(The day Stats page calls `wireReplayRows(root, entries)` with no third arg — `opts` defaults keep it synthetic-only there until someone threads its token through; that's fine and intentional for v1.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/daily-lb.test.js`
Expected: PASS (all, including pre-existing)

- [ ] **Step 5: Commit**

```bash
git add public/daily-lb.js test/daily-lb.test.js
git commit -m "feat(replay): 'watch the real solve' mode in the leaderboard replay modal"
```

---

### Task 9: Full gauntlet, live smoke, ship

- [ ] **Step 1: Full gauntlet**

Run: `npm run check-graph && npm run typecheck && npm test`
Expected: ALL PASS (loc-ratchet included — if app.js tripped the cap, extract, don't raise).

- [ ] **Step 2: Live smoke on the dev server**

Run `npm run dev`, then in a browser (or the `browse` skill — name any test identity `verify-bot-tape` and clean up after, per CLAUDE.md):
1. Play the daily: type letters with a backspace, one rejected word (e.g. "ZZZZZ"-ish), a hold-to-clear, then solve.
2. On the finish ritual, tap your own leaderboard row → modal → "▶ watch the real solve" appears → plays your actual keystrokes with the timer; the rejected word shakes and sweeps; long pauses show "💭 thinking…".
3. Reload the page, reopen the modal — the tape persists (served from the DO).
4. Open the same day's leaderboard logged out / without the token (private window, public stats page) — no tape button, tape endpoint 403s.

- [ ] **Step 3: Ship**

```bash
bash dev/ship.sh
```

Per memory (ship-ci-watch-race): verify the CI run that deploys YOUR commit (`gh run list`, check the head SHA), then smoke prod: solve the daily on wordul.com, confirm the tape button appears on your own row.

---

## Out of scope (do NOT build here)

- Swipe time-travel / past-day navigation (spec 2, separate plan).
- Reduced past-day gold mint (spec 2).
- Tapes for Arena/challenge/lobby rooms; live spectating; scrub bar; retroactive tapes.
- End-of-game reveal voice lines (`speakWinReveal`/`speakLossReveal`) in the tape — the tape ends at the final commit; the mid-game companion lines (`showCompanion`) are the recorded commentary.
