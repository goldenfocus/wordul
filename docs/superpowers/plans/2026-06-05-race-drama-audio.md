# Race Drama Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opponent-driven reactive audio in race rooms — progress stings, a time-bomb danger tick when an opponent is deep, a chiptune fanfare when they bust.

**Architecture:** New `public/drama.js` with a pure, unit-tested cue detector (`detectCues`) that diffs consecutive snapshot player lists, plus a small impure Web Audio synth half (tick layer + one-shot stings) — wired into `public/app.js`'s snapshot handler with one call. Spec: `docs/superpowers/specs/2026-06-05-race-drama-audio-design.md`.

**Tech Stack:** Vanilla ES modules, Web Audio API (zero asset files), vitest.

**Repo facts the implementer needs:**
- Snapshot handler: `public/app.js:1742` (`if (msg.type === "snapshot")`), `prev = game.snapshot`, next is `msg.room`. Players carry `{ username, status, guesses: [{ mask }] }`; mask colors are `"hot"` / `"warm"` / `"cold"`.
- `public/celebrate.js` already exports `newGreensInLast(guesses)` / `newYellowsInLast(guesses)` — "new hots/warms in the latest row, per column, vs all prior rows". Reuse; do NOT reimplement.
- Tests import public modules via absolute paths (`import ... from "/drama.js"`) that `vitest.config.ts` aliases to `public/` — a new module needs a new alias entry.
- WS close listener: `public/app.js:1550`.

---

### Task 1: Pure cue detector — failing tests first

**Files:**
- Test: `test/drama.test.js` (create)
- Modify: `vitest.config.ts` (one alias line)

- [ ] **Step 1: Add the vitest alias for `/drama.js`**

In `vitest.config.ts`, in the `alias` array, after the `endcard.js` line add:

```ts
      { find: /^\/drama\.js$/, replacement: new URL("./public/drama.js", import.meta.url).pathname },
```

- [ ] **Step 2: Write the failing test file**

Create `test/drama.test.js`:

```js
import { describe, it, expect } from "vitest";
import { detectCues } from "/drama.js";

const G = "hot", Y = "warm", X = "cold";
const row = (mask) => ({ mask });
const P = (username, status, masks) => ({ username, status, guesses: masks.map(row) });
const CTX = { me: "yan", maxGuesses: 6, phase: "playing", isDaily: false };
const ME = P("yan", "playing", [[X, X, X, X, X]]);

describe("detectCues — gates", () => {
  it("silent with no prev snapshot (first snapshot / reconnect)", () => {
    expect(detectCues(null, [ME, P("bot", "playing", [[G, X, X, X, X]])], CTX))
      .toEqual({ cues: [], dangerLevel: 0 });
  });
  it("silent in the daily", () => {
    const r = detectCues([ME], [ME, P("bot", "playing", [[G, X, X, X, X]])], { ...CTX, isDaily: true });
    expect(r).toEqual({ cues: [], dangerLevel: 0 });
  });
  it("silent when the round is over", () => {
    const prev = [ME, P("bot", "playing", [[G, X, X, X, X]])];
    const next = [ME, P("bot", "won", [[G, X, X, X, X], [G, G, G, G, G]])];
    expect(detectCues(prev, next, { ...CTX, phase: "finished" })).toEqual({ cues: [], dangerLevel: 0 });
  });
  it("silent once I'm not playing (lost/won/spectating)", () => {
    const meLost = P("yan", "lost", [[X, X, X, X, X]]);
    const prev = [meLost, P("bot", "playing", [])];
    const next = [meLost, P("bot", "playing", [[G, G, X, X, X]])];
    expect(detectCues(prev, next, CTX)).toEqual({ cues: [], dangerLevel: 0 });
  });
  it("my own rows never produce cues", () => {
    const prev = [P("yan", "playing", [])];
    const next = [P("yan", "playing", [[G, G, G, X, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([]);
  });
});

describe("detectCues — progress stings", () => {
  it("new hot letters in an opponent's fresh row → hot cue with count", () => {
    const prev = [ME, P("bot", "playing", [[G, X, X, X, X]])];
    const next = [ME, P("bot", "playing", [[G, X, X, X, X], [G, G, X, G, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "hot", count: 2 }]);
  });
  it("re-confirmed hot columns are not news", () => {
    const prev = [ME, P("bot", "playing", [[G, G, X, X, X]])];
    const next = [ME, P("bot", "playing", [[G, G, X, X, X], [G, G, X, X, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([]);
  });
  it("warm-only progress → warm cue", () => {
    const prev = [ME, P("bot", "playing", [])];
    const next = [ME, P("bot", "playing", [[Y, X, X, Y, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "warm" }]);
  });
  it("no new row → no sting (snapshot for unrelated reasons)", () => {
    const prev = [ME, P("bot", "playing", [[G, X, X, X, X]])];
    const next = [ME, P("bot", "playing", [[G, X, X, X, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([]);
  });
  it("an opponent who joined mid-round produces no cues yet", () => {
    const prev = [ME];
    const next = [ME, P("newbot", "playing", [[G, G, G, X, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([]);
  });
});

describe("detectCues — danger layer", () => {
  const rows = (n) => Array.from({ length: n }, () => [X, X, X, X, X]);
  it("level 0 below maxGuesses-2", () => {
    const bot = P("bot", "playing", rows(3));
    expect(detectCues([ME, bot], [ME, bot], CTX).dangerLevel).toBe(0);
  });
  it("level 1 at maxGuesses-2 committed rows", () => {
    const bot = P("bot", "playing", rows(4));
    expect(detectCues([ME, bot], [ME, bot], CTX).dangerLevel).toBe(1);
  });
  it("level 2 on the final row", () => {
    const bot = P("bot", "playing", rows(5));
    expect(detectCues([ME, bot], [ME, bot], CTX).dangerLevel).toBe(2);
  });
  it("multi-opponent: deepest still-playing opponent wins", () => {
    const a = P("a", "playing", rows(5));
    const b = P("b", "playing", rows(2));
    expect(detectCues([ME, a, b], [ME, a, b], CTX).dangerLevel).toBe(2);
  });
  it("a lost opponent stops driving the layer", () => {
    const deadDeep = P("a", "lost", rows(6));
    expect(detectCues([ME, deadDeep], [ME, deadDeep], CTX).dangerLevel).toBe(0);
  });
});

describe("detectCues — busts", () => {
  const rows = (n) => Array.from({ length: n }, () => [X, X, X, X, X]);
  it("opponent playing→lost while I'm alive → bust cue, deep when they were row-4+", () => {
    const prev = [ME, P("bot", "playing", rows(5))];
    const next = [ME, P("bot", "lost", rows(6))];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "bust", deep: true }]);
  });
  it("shallow bust (early give-up) → bust cue, deep:false", () => {
    const prev = [ME, P("bot", "playing", rows(1))];
    const next = [ME, P("bot", "lost", rows(1))];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "bust", deep: false }]);
  });
  it("no bust cue when I went down in the same snapshot (opponent solved first)", () => {
    const prev = [P("yan", "playing", rows(2)), P("a", "playing", rows(3)), P("b", "playing", rows(4))];
    const next = [P("yan", "lost", rows(2)), P("a", "won", rows(4)), P("b", "lost", rows(4))];
    expect(detectCues(prev, next, CTX)).toEqual({ cues: [], dangerLevel: 0 });
  });
  it("malformed players (missing guesses) stay silent, never throw", () => {
    const prev = [ME, { username: "bot", status: "playing" }];
    const next = [ME, { username: "bot", status: "lost" }];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "bust", deep: false }]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/drama.test.js`
Expected: FAIL — cannot resolve `/drama.js` (module doesn't exist yet).

- [ ] **Step 4: Commit the red state**

```bash
git add test/drama.test.js vitest.config.ts
git commit -m "test(drama): cue-detector spec for race drama audio (red)"
```

### Task 2: Implement `public/drama.js`

**Files:**
- Create: `public/drama.js`

- [ ] **Step 1: Write the module (both halves)**

Create `public/drama.js`:

```js
// Reactive race audio: opponents you can HEAR. A pure cue detector (tested) diffs
// consecutive snapshots into drama cues; a tiny chiptune Web Audio half plays them —
// progress stings, a time-bomb tick while an opponent is deep, a fanfare when they
// bust. Zero assets, zero server involvement; honors the global 🔊 mute. Spec:
// docs/superpowers/specs/2026-06-05-race-drama-audio-design.md
import { newGreensInLast, newYellowsInLast } from "/celebrate.js";

// --- pure half ---------------------------------------------------------------

// Diff two snapshot player lists into drama cues from MY point of view.
// ctx = { me, maxGuesses, phase, isDaily }. Total function: bad/missing input → silence.
// Cues: {kind:"hot",count} new hot letters · {kind:"warm"} warm-only row ·
// {kind:"bust",deep} opponent ran out while I'm alive. dangerLevel 0|1|2 tracks the
// DEEPEST still-playing opponent (maxGuesses-2 rows → 1, final row → 2).
export function detectCues(prevPlayers, nextPlayers, ctx) {
  const none = { cues: [], dangerLevel: 0 };
  if (!prevPlayers || !nextPlayers || !ctx || ctx.isDaily || ctx.phase !== "playing") return none;
  const meP = nextPlayers.find((p) => p.username === ctx.me);
  if (!meP || meP.status !== "playing") return none;
  const deepRows = ctx.maxGuesses - 2;
  const cues = [];
  let dangerLevel = 0;
  for (const p of nextPlayers) {
    if (p.username === ctx.me) continue;
    const before = prevPlayers.find((q) => q.username === p.username);
    if (!before) continue; // joined this snapshot — their board is history, not news
    if (before.status === "playing" && p.status === "lost") {
      cues.push({ kind: "bust", deep: (before.guesses?.length ?? 0) >= deepRows });
      continue;
    }
    if (p.status !== "playing") continue;
    const rows = p.guesses?.length ?? 0;
    if (rows >= ctx.maxGuesses - 1) dangerLevel = 2;
    else if (rows >= deepRows) dangerLevel = Math.max(dangerLevel, 1);
    if (rows > (before.guesses?.length ?? 0)) {
      const hots = newGreensInLast(p.guesses);
      if (hots > 0) cues.push({ kind: "hot", count: hots });
      else if (newYellowsInLast(p.guesses) > 0) cues.push({ kind: "warm" });
    }
  }
  return { cues, dangerLevel };
}

// --- impure half: the chiptune synth -------------------------------------------

const MUTE_LS = "wordul.muted"; // same key playChime/playNoise honor
const STING_COOLDOWN_MS = 1500;
const TICK_MS = [0, 1100, 550]; // per dangerLevel

let audioCtx = null;
let layerLevel = 0;
let layerTimer = null;
let lastStingAt = 0;

function isMuted() { return localStorage.getItem(MUTE_LS) === "1"; }

// Own lazy AudioContext, same suspended-until-gesture handling as app.js's chimes.
function ac() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => { try { ac(); } catch { /* nice-to-have */ } }, { once: true });
  window.addEventListener("touchend", () => { try { ac(); } catch { /* nice-to-have */ } }, { once: true });
}

function note(freq, at, dur, gainPeak, type = "square") {
  const a = ac();
  const t0 = a.currentTime + at;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function tickBlip(level) {
  if (isMuted()) return;
  try {
    note(level === 2 ? 1250 : 1000, 0, 0.035, level === 2 ? 0.09 : 0.05);
    if (level === 2) note(65, 0, 0.1, 0.2, "sine"); // heartbeat thump under the fast tick
  } catch { /* audio is a nice-to-have */ }
}

// One tick loop total: recreated on level change, cleared at level 0. setInterval
// cadence (±50ms wobble) reads MORE human for a bomb tick than sample-accurate audio.
function setLayer(level) {
  if (level === layerLevel) return;
  layerLevel = level;
  if (layerTimer) { clearInterval(layerTimer); layerTimer = null; }
  if (level > 0) layerTimer = setInterval(() => tickBlip(layerLevel), TICK_MS[level]);
}

function sting(cue) {
  if (isMuted()) return;
  try {
    if (cue.kind === "bust") {
      const g = cue.deep ? 0.14 : 0.1; // shallow busts celebrate a little quieter
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.09, 0.08, g));
    } else if (cue.kind === "hot") {
      const base = 660 * Math.pow(2, (Math.min(cue.count, 5) - 1) / 12); // +1 semitone per extra hot
      note(base, 0, 0.07, 0.12);
      note(base * Math.pow(2, -1 / 12), 0.08, 0.09, 0.12); // minor-2nd drop = wrongness
    } else {
      note(240, 0, 0.09, 0.07, "triangle"); // warm: they're sniffing around
    }
  } catch { /* audio is a nice-to-have */ }
}

// Apply one snapshot's worth of drama: ONE tick layer at the deepest opponent's level,
// at most one sting per cooldown window (bust > hot > warm). A bust bypasses the
// cooldown — it's the payoff, and it just killed the tension layer.
export function dramaApply({ cues, dangerLevel }) {
  setLayer(dangerLevel);
  if (!cues.length) return;
  const best = cues.find((c) => c.kind === "bust")
    ?? cues.find((c) => c.kind === "hot")
    ?? cues[0];
  const now = Date.now();
  if (best.kind !== "bust" && now - lastStingAt < STING_COOLDOWN_MS) return;
  lastStingAt = now;
  sting(best);
}

export function dramaStop() {
  setLayer(0);
}

// The one-call site for app.js: diff → apply.
export function dramaUpdate(prevPlayers, nextPlayers, ctx) {
  dramaApply(detectCues(prevPlayers, nextPlayers, ctx));
}
```

- [ ] **Step 2: Run tests to verify green**

Run: `npx vitest run test/drama.test.js`
Expected: PASS (all tests).

- [ ] **Step 3: Commit**

```bash
git add public/drama.js
git commit -m "feat(drama): race drama audio module — cue detector + chiptune synth layer"
```

### Task 3: Wire into app.js

**Files:**
- Modify: `public/app.js:22` (imports), `public/app.js:1760` (snapshot handler, after the typing-ghost cleanup block), `public/app.js:1550` (ws close listener)

- [ ] **Step 1: Add the import**

After line 22 (`import { EDITIONS, getEdition } from "/editions/index.js";`) add:

```js
import { dramaUpdate, dramaStop } from "/drama.js";
```

- [ ] **Step 2: Call dramaUpdate from the snapshot handler**

In the `msg.type === "snapshot"` block, immediately AFTER the typing-ghost cleanup block (the `if (game.typing.size) { ... }` that ends before the `// The room owns the theme` comment), insert:

```js
    // Drama audio: opponents' progress → stings / danger tick / bust fanfare. Snapshot-
    // driven, so every end-of-round path (win, loss, outpaced, rematch reset) re-evaluates
    // to silence on its own — no per-path stop calls needed.
    dramaUpdate(prev?.players ?? null, msg.room.players, {
      me: getUsername(), maxGuesses: msg.room.maxGuesses ?? 6,
      phase: msg.room.phase, isDaily: !!msg.room.isDaily,
    });
```

- [ ] **Step 3: Stop the layer when the socket dies**

In the `ws.addEventListener("close", () => {` handler (line ~1550), add as the FIRST line of the callback:

```js
    dramaStop(); // no more snapshots will arrive to stop the tick — kill it now
```

(Before the staleness `return` — a superseding socket's next snapshot restarts the layer if it's still warranted.)

- [ ] **Step 4: Full gauntlet**

Run: `npm run check-graph && npm run typecheck && npm test`
Expected: all PASS (check-graph confirms `/drama.js` resolves from app.js).

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(drama): wire drama audio into the snapshot handler + socket close"
```

### Task 4: Ship + live smoke

- [ ] **Step 1: Ship via the /push pipeline** (rebase → gauntlet → push → CI deploy → smoke curls → worktree cleanup)

- [ ] **Step 2: Live smoke on wordul.com** — race 2+ bots with sound on: hot rows sting, tick starts at an opponent's 4th row, doubles on their 5th, fanfare when one busts, mute (🔊) kills everything instantly.

- [ ] **Step 3: Post-Deploy Summary**
