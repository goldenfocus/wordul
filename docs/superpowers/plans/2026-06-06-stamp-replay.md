# Clickable Solve-Stamp Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking any solve stamp (home recap, featured leaderboard card, profile recent games) plays a condensed cinematic replay in place — tiles type in and flip row-by-row at a fixed snappy cadence (≤8s total).

**Architecture:** A pure scheduler (`stamp-replay-core.js`: grid → timeline of type/flip steps) + a thin DOM driver (`stamp-replay.js`) that reads the board **off the already-rendered `.daily-stamp` markup** (classes + letters), veils the cells, and applies steps via `setTimeout`. One delegated `document` click listener wired once in `app.js` covers every stamp render site — no data plumbing, no server changes.

**Tech Stack:** Vanilla ES modules (public/), vitest, CSS keyframes.

**Spec:** `docs/superpowers/specs/2026-06-06-stamp-replay-design.md`

---

### Task 1: Pure step scheduler (`stamp-replay-core.js`)

**Files:**
- Create: `public/stamp-replay-core.js`
- Test: `test/stamp-replay.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/stamp-replay.test.js
import { describe, it, expect } from "vitest";
import { buildReplaySteps, TIMING } from "../public/stamp-replay-core.js";

describe("buildReplaySteps", () => {
  it("types each cell then flips it, row by row, in order", () => {
    const { steps } = buildReplaySteps(["xyg", "ggg"], true);
    const row0 = steps.filter((s) => s.row === 0);
    // 3 type + 3 flip per row
    expect(row0.filter((s) => s.kind === "type").map((s) => s.col)).toEqual([0, 1, 2]);
    expect(row0.filter((s) => s.kind === "flip").map((s) => s.col)).toEqual([0, 1, 2]);
    // within a row: every type happens before every flip
    const lastType = Math.max(...row0.filter((s) => s.kind === "type").map((s) => s.t));
    const firstFlip = Math.min(...row0.filter((s) => s.kind === "flip").map((s) => s.t));
    expect(firstFlip).toBeGreaterThanOrEqual(lastType + TIMING.TYPE_MS);
    // row 1 starts strictly after row 0's last flip
    const row1First = Math.min(...steps.filter((s) => s.row === 1).map((s) => s.t));
    const row0LastFlip = Math.max(...row0.filter((s) => s.kind === "flip").map((s) => s.t));
    expect(row1First).toBeGreaterThan(row0LastFlip);
  });

  it("colors-only boards skip the typing phase entirely", () => {
    const { steps } = buildReplaySteps(["xyg", "ggg"], false);
    expect(steps.every((s) => s.kind === "flip")).toBe(true);
    expect(steps.length).toBe(6);
  });

  it("caps a full 6-row board with letters under 8 seconds", () => {
    const grid = Array(6).fill("gygxy");
    expect(buildReplaySteps(grid, true).total).toBeLessThanOrEqual(8000);
  });

  it("empty grid → no steps, zero total", () => {
    expect(buildReplaySteps([], true)).toEqual({ steps: [], total: 0 });
    expect(buildReplaySteps(undefined, true)).toEqual({ steps: [], total: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/stamp-replay.test.js`
Expected: FAIL — cannot resolve `../public/stamp-replay-core.js`

- [ ] **Step 3: Write minimal implementation**

```js
// public/stamp-replay-core.js — condensed cinematic replay scheduler for solve
// stamps. Pure: grid in, ordered timeline of steps out. Fixed cadence (never the
// real solve timing — see the spec), so a 5-minute think still replays in ~7s.
// The DOM driver (stamp-replay.js) applies the steps; tests run on this file alone.
export const TIMING = { TYPE_MS: 80, FLIP_STAGGER_MS: 70, FLIP_MS: 260, ROW_BEAT_MS: 380 };

// grid: array of row strings ("g"/"y"/"x"). typed: whether the stamp has letters
// (typed boards type each letter in before the flip; colors-only boards just flip).
// Returns { steps: [{ t, row, col, kind: "type"|"flip" }], total } — t in ms.
export function buildReplaySteps(grid, typed) {
  const steps = [];
  let t = 0;
  for (let row = 0; row < (Array.isArray(grid) ? grid.length : 0); row++) {
    const cols = String(grid[row] ?? "").length;
    if (typed) for (let col = 0; col < cols; col++) { steps.push({ t, row, col, kind: "type" }); t += TIMING.TYPE_MS; }
    for (let col = 0; col < cols; col++) steps.push({ t: t + col * TIMING.FLIP_STAGGER_MS, row, col, kind: "flip" });
    t += (cols - 1) * TIMING.FLIP_STAGGER_MS + TIMING.FLIP_MS + TIMING.ROW_BEAT_MS;
  }
  return { steps, total: steps.length ? t - TIMING.ROW_BEAT_MS : 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/stamp-replay.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add public/stamp-replay-core.js test/stamp-replay.test.js
git commit -m "feat(replay): pure step scheduler for condensed stamp replay"
```

---

### Task 2: DOM driver + CSS + wiring

**Files:**
- Create: `public/stamp-replay.js`
- Modify: `public/style.css` (after the `.stamp-cell` block, ~line 2965)
- Modify: `public/app.js` (import block + one call)
- Modify: `public/daily-card.js:85` (replay affordance attrs on the stamp)

- [ ] **Step 1: Write the DOM driver**

```js
// public/stamp-replay.js — click a solve stamp → it plays itself back.
// Reads the board straight off the rendered .daily-stamp DOM (color classes +
// letters), so every render site — home recap, featured leaderboard card,
// profile recent games — gets replay for free with zero data plumbing.
// One delegated listener wires the whole app (wireStampReplays in app.js).
import { buildReplaySteps } from "/stamp-replay-core.js";

const playing = new WeakMap(); // stampEl -> { timers, cells }

// Grid + per-row cell elements off the DOM. Pad rows (is-empty) are skipped.
function stampBoard(stamp) {
  const grid = [], cells = [];
  for (const rowEl of stamp.querySelectorAll(".stamp-row")) {
    const rowCells = Array.from(rowEl.querySelectorAll(".stamp-cell"));
    if (!rowCells.length || rowCells[0].classList.contains("is-empty")) continue;
    grid.push(rowCells.map((c) =>
      c.classList.contains("is-correct") ? "g" : c.classList.contains("is-present") ? "y" : "x").join(""));
    cells.push(rowCells);
  }
  return { grid, cells };
}

// Snap to the final board: cancel timers, strip every replay class.
function finish(stamp) {
  const run = playing.get(stamp);
  if (!run) return;
  run.timers.forEach(clearTimeout);
  run.cells.flat().forEach((c) => c.classList.remove("is-veiled", "is-typed", "stamp-pop"));
  playing.delete(stamp);
}

function play(stamp) {
  if (playing.has(stamp)) { finish(stamp); return; } // tap mid-replay → snap to final
  // Reduced motion: the final board is already on screen; don't animate it away.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { grid, cells } = stampBoard(stamp);
  if (!grid.length) return;
  const { steps, total } = buildReplaySteps(grid, stamp.classList.contains("has-letters"));
  cells.flat().forEach((c) => c.classList.add("is-veiled"));
  const timers = steps.map((s) => setTimeout(() => {
    const cell = cells[s.row]?.[s.col];
    if (!cell) return;
    if (s.kind === "type") cell.classList.add("is-typed");
    else { cell.classList.remove("is-veiled", "is-typed"); cell.classList.add("stamp-pop"); }
  }, s.t));
  timers.push(setTimeout(() => finish(stamp), total + 400)); // sweep pop classes
  playing.set(stamp, { timers, cells });
}

// One delegated listener covers every stamp the app ever renders (the featured
// card and profile lists re-render their stamps freely — nothing to re-wire).
export function wireStampReplays(root = document) {
  root.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return; // @name links etc. keep their meaning
    const stamp = e.target.closest(".daily-stamp");
    if (stamp) play(stamp);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const stamp = e.target.closest && e.target.closest(".daily-stamp");
    if (stamp) { e.preventDefault(); play(stamp); }
  });
}
```

- [ ] **Step 2: Add the replay CSS**

In `public/style.css`, directly after the `.stamp-cell.is-absent .stamp-ch` rule (~line 2965):

```css
/* ── Stamp replay (stamp-replay.js): tap any solve stamp to watch it play back. ── */
.daily-stamp { cursor: pointer; }
.stamp-cell.is-veiled { background: transparent; box-shadow: 0 0 0 1px rgba(255,255,255,.07) inset; }
.stamp-cell.is-veiled::after { display: none; }
.stamp-cell.is-veiled .stamp-ch { visibility: hidden; }
.stamp-cell.is-veiled.is-typed .stamp-ch { visibility: visible; color: #cfd6e3; }
.stamp-cell.stamp-pop { animation: stampPop .26s ease; }
@keyframes stampPop { 0% { transform: scale(.55); } 60% { transform: scale(1.14); } 100% { transform: scale(1); } }
```

- [ ] **Step 3: Replay affordance on the stamp element**

In `public/daily-card.js:85`, the `renderStamp` return line becomes (adds `role`/`tabindex`/`aria-label`/`title`):

```js
  return `<div class="daily-stamp${hasLetters ? " has-letters" : ""}" role="button" tabindex="0" aria-label="Play replay" title="Play replay">${rows.join("")}</div>`;
```

- [ ] **Step 4: Wire once in app.js**

In `public/app.js`, add to the import block (after line 22's `daily-card.js` import):

```js
import { wireStampReplays } from "/stamp-replay.js";
```

And immediately after the import block (top-level, runs once at boot):

```js
wireStampReplays();
```

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green (including `ios-input-zoom.test.ts` — no inputs touched)

- [ ] **Step 6: Commit**

```bash
git add public/stamp-replay.js public/style.css public/app.js public/daily-card.js
git commit -m "feat(replay): tap any solve stamp to play a condensed cinematic replay"
```

---

### Task 3: Manual verify + ship

- [ ] **Step 1: Manual smoke (local)**

Run `npm run dev`, solve (or load a solved state for) the daily, then:
1. Home recap stamp → click → letters type in, rows flip, ends on final board.
2. Click mid-replay → snaps to final instantly; click again → replays.
3. Tap another player on Today's Top → featured stamp (colors-only) → click → flips only, no letters.
4. Profile → Recent games → expand a row → click stamp → replays.

- [ ] **Step 2: Ship**

```bash
bash dev/ship.sh
```

Expected: tests → rebase → backup tag → push to main → CI deploys. Verify CI run goes green and post the Post-Deploy Summary.
