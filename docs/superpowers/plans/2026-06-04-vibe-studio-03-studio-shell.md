# Vibe Studio Increment 3 — Studio Shell + Word/size + Palette — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone, admin-facing "Stage" page at `/vibe-studio` where you set a day's title, word + size + guesses, and a 3-colour palette, and watch the whole page re-light live through the Increment-2 CSS-var contract.

**Architecture:** A self-contained `public/vibe-studio.html` + `public/vibe-studio.js` that loads the existing `public/style.css` and imports the already-shipped pure functions `colorSchemeVars`/`applyColorScheme` from `public/edition.js`. All non-trivial logic lives in a new pure module `public/vibe-studio-core.js` (no DOM, unit-tested). The board is a static themed preview that reflows `len × rows`; a working `vibe` object is auto-saved to localStorage. No server mutation; scheduling is an inert seam.

**Tech Stack:** Vanilla ESM modules, Cloudflare Workers static assets (`./public`), vitest (`node` env for pure tests), the locked `--a1/--a2/--a3 → --accent` CSS-var contract.

---

## File structure

- **Create** `public/vibe-studio-core.js` — pure logic: `randomHarmony`, `reflowDims`, `classifyWord`, `serializeDraft`, `restoreDraft`. No DOM, no fetch.
- **Create** `test/vibe-studio-core.test.js` — unit tests for the pure module.
- **Create** `public/vibe-studio.html` — the Stage shell (Glass-Aurora layout, header, board zone, tool rail, inert schedule bar). Loads `style.css` + `vibe-studio.js`.
- **Create** `public/vibe-studio.js` — DOM wiring: read inputs → `vibe` object → re-render board/label, apply palette via `colorSchemeVars`, draft save/restore, debounced badge (the real `dictionaryapi.dev` lookup lives here, injected into `classifyWord`).
- **Modify** `vitest.config.ts` — add a resolve alias `/vibe-studio-core.js` → `./public/vibe-studio-core.js` so tests and `vibe-studio.js` import it by the same root path the browser uses.
- **Modify (maybe)** `src/worker.ts` — only if we want the pretty `/vibe-studio` URL; confirmed in Task 6.

---

### Task 1: Pure core — `reflowDims` (clamp size & rows)

**Files:**
- Create: `public/vibe-studio-core.js`
- Create: `test/vibe-studio-core.test.js`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the resolve alias so tests can import the new module by root path**

In `vitest.config.ts`, inside the `resolve.alias` array, add (after the existing `daily-card` line):

```js
      { find: /^\/vibe-studio-core\.js$/, replacement: new URL("./public/vibe-studio-core.js", import.meta.url).pathname },
```

- [ ] **Step 2: Write the failing test**

Create `test/vibe-studio-core.test.js`:

```js
import { describe, it, expect } from "vitest";
import { reflowDims } from "/vibe-studio-core.js";

describe("reflowDims", () => {
  it("passes through in-range integers", () => {
    expect(reflowDims(5, 6)).toEqual({ len: 5, rows: 6 });
  });
  it("clamps len to 4..12 and rows to 3..10", () => {
    expect(reflowDims(2, 1)).toEqual({ len: 4, rows: 3 });
    expect(reflowDims(99, 99)).toEqual({ len: 12, rows: 10 });
  });
  it("floors non-integers and defaults NaN to the minimums", () => {
    expect(reflowDims(5.9, 6.9)).toEqual({ len: 5, rows: 6 });
    expect(reflowDims(NaN, NaN)).toEqual({ len: 4, rows: 3 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- vibe-studio-core`
Expected: FAIL — `reflowDims` is not exported / module not found.

- [ ] **Step 4: Write minimal implementation**

Create `public/vibe-studio-core.js`:

```js
// Pure logic for the Vibe Studio "Stage" editor. No DOM, no fetch — everything
// here is unit-tested. The DOM wiring lives in vibe-studio.js.

const clampInt = (n, lo, hi) => {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
};

// Clamp a word length to 4..12 and guess-rows to 3..10 (parent-spec limits).
export function reflowDims(len, rows) {
  return { len: clampInt(len, 4, 12), rows: clampInt(rows, 3, 10) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- vibe-studio-core`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add public/vibe-studio-core.js test/vibe-studio-core.test.js vitest.config.ts
git commit -m "feat(studio): reflowDims clamp for vibe studio core"
```

---

### Task 2: Pure core — `randomHarmony` (HSL triad → 3 hexes)

**Files:**
- Modify: `public/vibe-studio-core.js`
- Modify: `test/vibe-studio-core.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/vibe-studio-core.test.js`:

```js
import { randomHarmony } from "/vibe-studio-core.js";

describe("randomHarmony", () => {
  const HEX = /^#[0-9a-f]{6}$/;
  it("returns three valid lowercase hex colours", () => {
    const cs = randomHarmony(200);
    expect(cs.a1).toMatch(HEX);
    expect(cs.a2).toMatch(HEX);
    expect(cs.a3).toMatch(HEX);
  });
  it("is deterministic for a given seed hue", () => {
    expect(randomHarmony(120)).toEqual(randomHarmony(120));
  });
  it("produces three distinct colours", () => {
    const { a1, a2, a3 } = randomHarmony(40);
    expect(new Set([a1, a2, a3]).size).toBe(3);
  });
  it("wraps hue into 0..359 so out-of-range seeds still work", () => {
    expect(randomHarmony(380)).toEqual(randomHarmony(20));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- vibe-studio-core`
Expected: FAIL — `randomHarmony` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `public/vibe-studio-core.js`:

```js
// HSL → #rrggbb. h in degrees, s/l in 0..1.
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to2 = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

// A coherent 3-colour palette from a base hue: a1 vivid base, a2/a3 a split-
// complementary pair. Deterministic given baseHue so it is unit-testable; the
// live "🎲" supplies a varied hue.
export function randomHarmony(baseHue = 210) {
  const h = ((baseHue % 360) + 360) % 360;
  return {
    a1: hslToHex(h, 0.68, 0.58),
    a2: hslToHex(h + 150, 0.62, 0.62),
    a3: hslToHex(h + 210, 0.6, 0.55),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- vibe-studio-core`
Expected: PASS (all randomHarmony + reflowDims tests).

- [ ] **Step 5: Commit**

```bash
git add public/vibe-studio-core.js test/vibe-studio-core.test.js
git commit -m "feat(studio): randomHarmony HSL triad palette"
```

---

### Task 3: Pure core — `classifyWord` (soft real/invented badge logic)

**Files:**
- Modify: `public/vibe-studio-core.js`
- Modify: `test/vibe-studio-core.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/vibe-studio-core.test.js`:

```js
import { classifyWord } from "/vibe-studio-core.js";

describe("classifyWord", () => {
  const yes = async () => true;
  const no = async () => false;
  it("flags words shorter than 4 as tooShort without calling lookup", async () => {
    let called = false;
    const spy = async () => { called = true; return true; };
    expect(await classifyWord("CAT", spy)).toBe("tooShort");
    expect(called).toBe(false);
  });
  it("returns real when the lookup resolves true", async () => {
    expect(await classifyWord("EMBER", yes)).toBe("real");
  });
  it("returns invented when the lookup resolves false", async () => {
    expect(await classifyWord("ZQXVW", no)).toBe("invented");
  });
  it("treats a lookup error as invented (soft, never throws)", async () => {
    const boom = async () => { throw new Error("network"); };
    expect(await classifyWord("EMBER", boom)).toBe("invented");
  });
  it("empty/blank word is tooShort", async () => {
    expect(await classifyWord("", yes)).toBe("tooShort");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- vibe-studio-core`
Expected: FAIL — `classifyWord` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `public/vibe-studio-core.js`:

```js
// Soft, NON-BLOCKING classifier for the real ✓ / invented ✨ badge. `lookup` is
// an injected async (word) => boolean (the live one wraps dictionaryapi.dev), so
// this stays pure and fetch-free for tests. Any error → "invented" (never throws,
// never gates input). The only hard rule elsewhere is length 4–12.
export async function classifyWord(word, lookup) {
  const w = String(word || "").trim();
  if (w.length < 4) return "tooShort";
  try {
    return (await lookup(w)) ? "real" : "invented";
  } catch {
    return "invented";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- vibe-studio-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/vibe-studio-core.js test/vibe-studio-core.test.js
git commit -m "feat(studio): classifyWord soft real/invented badge logic"
```

---

### Task 4: Pure core — draft serialize/restore

**Files:**
- Modify: `public/vibe-studio-core.js`
- Modify: `test/vibe-studio-core.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/vibe-studio-core.test.js`:

```js
import { serializeDraft, restoreDraft } from "/vibe-studio-core.js";

describe("draft round-trip", () => {
  const vibe = { vibeTitle: "Embers", word: "EMBER", len: 5, rows: 6,
                 colorScheme: { a1: "#d98a3a", a2: "#3a7fd9", a3: "#7f3ad9" } };
  it("round-trips a full vibe", () => {
    expect(restoreDraft(serializeDraft(vibe))).toEqual(vibe);
  });
  it("returns defaults for null/garbage input", () => {
    const d = restoreDraft(null);
    expect(d.len).toBe(5);
    expect(d.rows).toBe(6);
    expect(d.word).toBe("");
    expect(d.colorScheme).toEqual({ a1: "#5ee27a", a2: "#f2c94c", a3: "#ff8a5c" });
    expect(restoreDraft("{not json")).toEqual(d);
  });
  it("fills missing fields and clamps dims from a partial draft", () => {
    const d = restoreDraft(JSON.stringify({ word: "sky", len: 99 }));
    expect(d.word).toBe("SKY");
    expect(d.len).toBe(12);
    expect(d.rows).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- vibe-studio-core`
Expected: FAIL — `serializeDraft`/`restoreDraft` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `public/vibe-studio-core.js`:

```js
const DEFAULT_SCHEME = { a1: "#5ee27a", a2: "#f2c94c", a3: "#ff8a5c" };

export function defaultVibe() {
  return { vibeTitle: "", word: "", len: 5, rows: 6, colorScheme: { ...DEFAULT_SCHEME } };
}

export function serializeDraft(vibe) {
  return JSON.stringify(vibe);
}

// Tolerant restore: bad/partial input → a complete, clamped vibe (never throws).
export function restoreDraft(raw) {
  let obj = {};
  try { obj = raw ? JSON.parse(raw) : {}; } catch { obj = {}; }
  if (!obj || typeof obj !== "object") obj = {};
  const base = defaultVibe();
  const { len, rows } = reflowDims(obj.len ?? base.len, obj.rows ?? base.rows);
  const cs = obj.colorScheme && typeof obj.colorScheme === "object" ? obj.colorScheme : {};
  return {
    vibeTitle: typeof obj.vibeTitle === "string" ? obj.vibeTitle : base.vibeTitle,
    word: String(obj.word ?? base.word).toUpperCase().replace(/[^A-Z]/g, ""),
    len, rows,
    colorScheme: {
      a1: cs.a1 || DEFAULT_SCHEME.a1,
      a2: cs.a2 || DEFAULT_SCHEME.a2,
      a3: cs.a3 || DEFAULT_SCHEME.a3,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- vibe-studio-core`
Expected: PASS (all core tests).

- [ ] **Step 5: Commit**

```bash
git add public/vibe-studio-core.js test/vibe-studio-core.test.js
git commit -m "feat(studio): tolerant draft serialize/restore + defaultVibe"
```

---

### Task 5: The Stage shell — `vibe-studio.html` + `vibe-studio.js`

This is the DOM layer. It is verified in the browser (Task 6), not by unit tests — all
testable logic already lives in `vibe-studio-core.js`.

**Files:**
- Create: `public/vibe-studio.html`
- Create: `public/vibe-studio.js`

- [ ] **Step 1: Create `public/vibe-studio.html`**

A Glass-Aurora shell that loads the shared stylesheet and the studio module. Mirrors the
existing day-page CSS vars (`--a1/--a2/--a3/--accent`) so `applyColorScheme` re-lights it.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Vibe Studio — Wordul</title>
<link rel="stylesheet" href="/style.css" />
<style>
  /* Studio-only chrome. Re-uses the locked --a1/--a2/--a3/--accent contract. */
  body.studio { min-height: 100vh; margin: 0; background: #0f0f11; color: #f1e9d9;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; overflow-x: hidden; }
  .studio-aurora { position: fixed; inset: -20vmax; z-index: 0; pointer-events: none;
    background:
      radial-gradient(40vmax 40vmax at 20% 15%, color-mix(in srgb, var(--a1) 38%, transparent), transparent 70%),
      radial-gradient(38vmax 38vmax at 82% 22%, color-mix(in srgb, var(--a2) 30%, transparent), transparent 70%),
      radial-gradient(46vmax 46vmax at 50% 92%, color-mix(in srgb, var(--a3) 26%, transparent), transparent 72%);
    filter: blur(8px); transition: background .4s ease; }
  .studio-wrap { position: relative; z-index: 1; max-width: 820px; margin: 0 auto;
    padding: clamp(20px, 5vw, 48px) 20px 120px; }
  .studio-kicker { text-transform: uppercase; letter-spacing: .28em; font-size: 11px;
    color: color-mix(in srgb, var(--accent) 70%, #8a877f); margin-bottom: 10px; }
  #studioTitle { width: 100%; background: transparent; border: 0; outline: none;
    font-size: clamp(34px, 8vw, 64px); font-weight: 800; letter-spacing: -0.02em;
    color: transparent; background-image: linear-gradient(120deg, var(--a1), var(--a2));
    -webkit-background-clip: text; background-clip: text; }
  #studioTitle::placeholder { color: color-mix(in srgb, var(--accent) 50%, #555); -webkit-text-fill-color: initial; }
  .word-label { text-align: center; letter-spacing: .42em; font-weight: 700; font-size: 18px;
    color: color-mix(in srgb, var(--accent) 85%, #fff); margin: 28px 0 12px; min-height: 22px; }
  .preview-board { display: grid; gap: 6px; justify-content: center; margin: 0 auto;
    --tile: clamp(26px, calc((100vw - 80px) / var(--cols, 5)), 52px); }
  .preview-row { display: grid; grid-template-columns: repeat(var(--cols, 5), var(--tile)); gap: 6px; }
  .preview-tile { width: var(--tile); height: var(--tile); border: 2px solid #2c2b28;
    border-radius: 4px; background: #181715; display: grid; place-items: center;
    font-weight: 800; font-size: calc(var(--tile) * 0.42); text-transform: uppercase; color: #f1e9d9; }
  .preview-tile.green  { background: var(--a1); border-color: var(--a1); color: #0f0f11; }
  .preview-tile.yellow { background: var(--a2); border-color: var(--a2); color: #0f0f11; }
  .preview-tile.gray   { background: #2c2b28; border-color: #2c2b28; color: #8a877f; }

  .tool-card { position: relative; z-index: 1; margin: 22px auto 0; max-width: 560px;
    background: color-mix(in srgb, #ffffff 5%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 22%, #2c2b28);
    border-radius: 16px; padding: 18px 18px 20px; backdrop-filter: blur(10px); }
  .tool-card h3 { margin: 0 0 14px; font-size: 12px; letter-spacing: .22em; text-transform: uppercase;
    color: color-mix(in srgb, var(--accent) 70%, #8a877f); font-weight: 700; }
  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
    color: #8a877f; margin-bottom: 6px; }
  .field input[type=text], .field input[type=number] { width: 100%; box-sizing: border-box;
    font-size: 16px; padding: 10px 12px; background: #181715; border: 1px solid #2c2b28;
    border-radius: 8px; color: #f1e9d9; }
  #wordInput { letter-spacing: .3em; text-transform: uppercase; font-weight: 700; text-align: center; }
  .row { display: flex; gap: 14px; }
  .row .field { flex: 1; }
  .badge { display: inline-block; margin-top: 8px; font-size: 13px; font-weight: 600; min-height: 18px; }
  .badge.real { color: var(--a1); }
  .badge.invented { color: var(--a2); }
  .badge.muted { color: #8a877f; }
  .swatches { display: flex; gap: 16px; align-items: flex-end; }
  .swatch-wrap { text-align: center; }
  .swatch-wrap small { display: block; font-size: 10px; color: #8a877f; margin-bottom: 6px; }
  .swatch { width: 46px; height: 46px; border-radius: 50%; border: 2px solid #2c2b28; cursor: pointer; padding: 0; }
  .harmony-btn { margin-left: auto; background: transparent; border: 0; cursor: pointer;
    color: color-mix(in srgb, var(--accent) 85%, #fff); font-size: 13px; font-weight: 600;
    display: inline-flex; align-items: center; gap: 6px; }
  .harmony-btn:hover { text-shadow: 0 0 12px var(--accent); }
  .schedule-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2; text-align: center;
    padding: 16px; background: linear-gradient(to top, #0f0f11, transparent); }
  .schedule-seam { background: transparent; border: 0; color: #8a877f; font-size: 15px; font-weight: 600;
    cursor: not-allowed; display: inline-flex; align-items: center; gap: 8px; }
  .schedule-seam .soon { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; opacity: .7; }
</style>
</head>
<body class="studio">
  <div class="studio-aurora" id="aurora"></div>
  <div class="studio-wrap">
    <div class="studio-kicker">Vibe Studio · draft</div>
    <input id="studioTitle" type="text" placeholder="Name this day…" autocomplete="off" />

    <div class="word-label" id="wordLabel"></div>
    <div class="preview-board" id="previewBoard"></div>

    <div class="tool-card">
      <h3>Word &amp; size</h3>
      <div class="field">
        <label for="wordInput">The word</label>
        <input id="wordInput" type="text" maxlength="12" autocomplete="off" placeholder="EMBER" />
        <span class="badge muted" id="wordBadge"></span>
      </div>
      <div class="row">
        <div class="field">
          <label for="lenInput">Length (4–12)</label>
          <input id="lenInput" type="number" min="4" max="12" />
        </div>
        <div class="field">
          <label for="rowsInput">Guesses (3–10)</label>
          <input id="rowsInput" type="number" min="3" max="10" />
        </div>
      </div>
    </div>

    <div class="tool-card">
      <h3 style="display:flex;align-items:center;">Palette
        <button class="harmony-btn" id="harmonyBtn" type="button">🎲 Random harmony</button>
      </h3>
      <div class="swatches">
        <div class="swatch-wrap"><small>Accent 1</small><input class="swatch" id="sw1" type="color" /></div>
        <div class="swatch-wrap"><small>Accent 2</small><input class="swatch" id="sw2" type="color" /></div>
        <div class="swatch-wrap"><small>Accent 3</small><input class="swatch" id="sw3" type="color" /></div>
      </div>
    </div>
  </div>

  <div class="schedule-bar">
    <button class="schedule-seam" type="button" disabled title="Scheduling arrives in a later increment">
      Submit my day → <span class="soon">coming soon</span>
    </button>
  </div>

  <script type="module" src="/vibe-studio.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/vibe-studio.js`**

```js
import { colorSchemeVars } from "/edition.js";
import {
  reflowDims, randomHarmony, classifyWord, serializeDraft, restoreDraft, defaultVibe,
} from "/vibe-studio-core.js";

const DRAFT_KEY = "wordul.vibeStudio.draft";
const $ = (id) => document.getElementById(id);

// Live dictionary lookup for the soft badge — same CORS-friendly, key-less API
// app.js already uses for definitions. Injected into the pure classifyWord.
async function dictLookup(word) {
  const res = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`
  );
  return res.ok; // 200 → real word; 404 → not found
}

let vibe = restoreDraft(localStorage.getItem(DRAFT_KEY) || serializeDraft(defaultVibe()));

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, serializeDraft(vibe));
}

// Apply the palette through the LOCKED Increment-2 contract (a1→--accent + atoms).
function applyPalette() {
  const vars = colorSchemeVars(vibe.colorScheme); // { --accent, --a1, --a2, --a3 }
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
}

// Sample colour pattern for the preview row: greens/yellows/grays, deterministic by length.
function sampleClass(i, len) {
  const pat = ["green", "gray", "yellow", "green", "gray", "yellow"];
  return pat[i % pat.length] + (len > 6 && i >= 6 ? "" : "");
}

function renderBoard() {
  const board = $("previewBoard");
  board.style.setProperty("--cols", vibe.len);
  const letters = (vibe.word || "").padEnd(vibe.len).slice(0, vibe.len).split("");
  let html = "";
  for (let r = 0; r < vibe.rows; r++) {
    html += '<div class="preview-row">';
    for (let c = 0; c < vibe.len; c++) {
      // Only the first row shows the sample colouring + the word's letters.
      const cls = r === 0 ? " " + sampleClass(c, vibe.len) : "";
      const ch = r === 0 ? (letters[c] || "").trim() : "";
      html += `<div class="preview-tile${cls}">${ch}</div>`;
    }
    html += "</div>";
  }
  board.innerHTML = html;
}

function renderLabel() {
  $("wordLabel").textContent = vibe.word ? vibe.word.split("").join(" ") : "";
}

let badgeToken = 0;
function renderBadge() {
  const el = $("wordBadge");
  const token = ++badgeToken; // ignore stale async results
  if (!vibe.word || vibe.word.length < 4) {
    el.className = "badge muted";
    el.textContent = vibe.word ? "keep typing (min 4)" : "";
    return;
  }
  el.className = "badge muted";
  el.textContent = "checking…";
  classifyWord(vibe.word, dictLookup).then((status) => {
    if (token !== badgeToken) return;
    if (status === "real") { el.className = "badge real"; el.textContent = "✓ real word"; }
    else if (status === "invented") { el.className = "badge invented"; el.textContent = "✨ invented — guess the curator's coinage"; }
    else { el.className = "badge muted"; el.textContent = ""; }
  });
}

function syncInputs() {
  $("studioTitle").value = vibe.vibeTitle;
  $("wordInput").value = vibe.word;
  $("lenInput").value = vibe.len;
  $("rowsInput").value = vibe.rows;
  $("sw1").value = vibe.colorScheme.a1;
  $("sw2").value = vibe.colorScheme.a2;
  $("sw3").value = vibe.colorScheme.a3;
}

function renderAll() {
  applyPalette();
  renderLabel();
  renderBoard();
  renderBadge();
  saveDraft();
}

// --- wiring ---
$("studioTitle").addEventListener("input", (e) => { vibe.vibeTitle = e.target.value; saveDraft(); });

let badgeDebounce;
$("wordInput").addEventListener("input", (e) => {
  const w = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12);
  e.target.value = w;
  vibe.word = w;
  // typing the word auto-sets length to match (still clamped, still editable)
  if (w.length >= 4) { vibe.len = reflowDims(w.length, vibe.rows).len; $("lenInput").value = vibe.len; }
  renderLabel();
  renderBoard();
  saveDraft();
  clearTimeout(badgeDebounce);
  badgeDebounce = setTimeout(renderBadge, 350);
});

$("lenInput").addEventListener("input", (e) => {
  vibe.len = reflowDims(e.target.value, vibe.rows).len;
  renderBoard(); saveDraft();
});
$("lenInput").addEventListener("blur", () => { $("lenInput").value = vibe.len; });

$("rowsInput").addEventListener("input", (e) => {
  vibe.rows = reflowDims(vibe.len, e.target.value).rows;
  renderBoard(); saveDraft();
});
$("rowsInput").addEventListener("blur", () => { $("rowsInput").value = vibe.rows; });

for (const [id, key] of [["sw1", "a1"], ["sw2", "a2"], ["sw3", "a3"]]) {
  $(id).addEventListener("input", (e) => { vibe.colorScheme[key] = e.target.value; applyPalette(); renderBoard(); saveDraft(); });
}

$("harmonyBtn").addEventListener("click", () => {
  // vary the hue each roll without Math.random determinism concerns in core
  const hue = Math.floor(Math.random() * 360);
  vibe.colorScheme = randomHarmony(hue);
  syncInputs();
  applyPalette(); renderBoard(); saveDraft();
});

// --- boot ---
syncInputs();
renderAll();
```

- [ ] **Step 3: Typecheck (no TS errors introduced)**

Run: `npm run typecheck`
Expected: PASS (these are `.js`/`.html`; confirm no config breakage).

- [ ] **Step 4: Commit**

```bash
git add public/vibe-studio.html public/vibe-studio.js
git commit -m "feat(studio): Stage shell — title, reflow board, word/size + palette tools"
```

---

### Task 6: Routing + browser verification

**Files:**
- Possibly modify: `src/worker.ts`

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background). Wait for `http://localhost:8787`.

- [ ] **Step 2: Confirm the bare asset path resolves**

Open `http://localhost:8787/vibe-studio.html`. Expected: the Stage renders, aurora visible.

- [ ] **Step 3: Decide the pretty URL**

If `http://localhost:8787/vibe-studio` (no `.html`) does NOT resolve and we want it, add to
`src/worker.ts` early in `fetch` (before the SPA catch-all, alongside the other `url.pathname ===`
checks):

```ts
    if (url.pathname === "/vibe-studio" || url.pathname === "/vibe-studio/") {
      return env.ASSETS.fetch(new Request(url.origin + "/vibe-studio.html"));
    }
```

(If the bare path already resolves acceptably, skip — prefer no worker change. Document the choice
in the commit message.)

- [ ] **Step 4: Manual smoke (browser)**

Verify, at `/vibe-studio` (or `.html`):
- Type a title → gradient hero updates.
- Type `EMBER` → label `E M B E R`, board first row letters fill, badge shows `✓ real word` after debounce.
- Type `ZQXVW` → badge shows `✨ invented…`.
- Change Length / Guesses → board reflows live.
- Drag a swatch / click 🎲 Random harmony → aurora, title gradient, sample row all re-light.
- Reload the page → title/word/size/palette restored from the draft.
- Schedule seam is visibly disabled ("coming soon").

- [ ] **Step 5: Commit any worker change**

```bash
git add src/worker.ts
git commit -m "feat(studio): pretty /vibe-studio route serves the Stage asset"
```

(Skip if no worker change was needed.)

---

### Task 7: Full test + typecheck gate, then ship

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all prior tests still green + the new `vibe-studio-core` tests (≈ 15 new). Total ≥ 403 + new.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Ship**

Run: `bash dev/ship.sh`
Expected: tests → rebase on origin/main → backup tag → merge → CI deploy → release tag. If main
moved, re-run `dev/ship.sh` (it re-integrates).

- [ ] **Step 4: Update build-status memory**

Append the Increment 3 shipped contract (route, files, draft key, the inert schedule seam, deferred
items) to memory `vibe-studio-build-status.md`.

---

## Self-review notes

- **Spec coverage:** standalone page reusing the contract ✓ (Tasks 5–6, imports `colorSchemeVars`);
  static themed reflow board ✓ (Task 5 `renderBoard`); word/size + real/invented badge ✓ (Tasks 3,5);
  3-swatch palette + Random harmony re-lighting ✓ (Tasks 2,5); localStorage draft ✓ (Task 4); inert
  schedule seam ✓ (Task 5 HTML); `/vibe-studio` route ✓ (Task 6); Glass-Aurora zero-pills ✓ (Task 5 CSS).
- **Deferred per spec:** typing/test-play, voice, images/sound, real scheduling/auth — none built. ✓
- **Type consistency:** `vibe` shape `{ vibeTitle, word, len, rows, colorScheme:{a1,a2,a3} }` used identically
  across core + DOM; `colorSchemeVars` returns `{--accent,--a1,--a2,--a3}` (verified against edition.js:116).
- **No placeholders:** every code step is complete and runnable.
