# Difficulty Tiers + Easy-Mode Live Typing Hints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `hardMode` boolean with a 3-tier `difficulty` setting (easy/medium/hard, default easy) and give Easy a live "knowledge lens" on the typing row — dead letters dim + blink red, proven-green slots get a green ring, proven-present letters get a yellow dot.

**Architecture:** A new pure module `public/hints.js` derives per-column hints from prior guesses (reusing `deadLettersFrom` from `celebrate.js`). `settings.js` owns the tier + migration and exports an `activeDifficulty()` resolver every consumer reads through (the future per-world override layer interposes there). Both pending-row render paths in `app.js` (full `renderBoards` + the `syncMyInputRow` typing fast-path) apply `hint-*` classes; CSS does the rest. **No server changes** — the `hard` flag on the guess ws message keeps its boolean shape.

**Tech Stack:** Vanilla ES modules (Cloudflare Workers static assets), vitest (+ jsdom for settings tests). Tests import public modules via the `/xxx.js` aliases in `vitest.config.ts`.

**Spec:** `docs/superpowers/specs/2026-06-07-difficulty-tiers-easy-hints-design.md`

**Tier table (locked):** Easy = live hints, no penalties. Medium = today's prod default exactly. Hard = today's Hard Mode exactly (must-use-hints rule + dead-letter drain + bankruptcy −300).

---

## File map

| File | Role |
|---|---|
| Create `public/hints.js` | Pure `typingHints(pending, guesses)` — per-column knowledge derivation |
| Create `test/hints.test.js` | Truth-table unit tests for `typingHints` |
| Modify `public/settings.js` | `difficulty` default + migration in `getSettings`, export `activeDifficulty()`, chip wiring in `openSettings` |
| Modify `test/settings.test.js` | Migration + default tests; update `hardMode`-era assertions |
| Modify `public/app.js` | 3 hardMode reads → `activeDifficulty()`, hint classes in both pending-row paths |
| Modify `public/powerups.js` | bankruptcy gate reads `activeDifficulty()` |
| Modify `public/index.html` | Hard Mode toggle row → Easy/Medium/Hard chip row |
| Modify `public/style.css` | `.tile.hint-dead/.hint-confirmed/.hint-present` + reduced-motion exemption |
| Modify `public/how-to-play.html` | 3-line Difficulty note |
| Modify `vitest.config.ts` | `/hints.js` alias |

Conventions to respect: pending tiles are rebuilt per keystroke via `syncMyInputRow` (app.js:3869) which early-returns on unchanged tiles — hint classes must be applied in BOTH the full render branch (app.js:~3740) and the rewrite branch of `syncMyInputRow`. Colorblind support is free if CSS uses `var(--hot)` / `var(--warm)` (overridden by `body.cb`). Red = existing `var(--error)`.

---

### Task 1: `hints.js` — pure knowledge derivation

**Files:**
- Create: `public/hints.js`
- Test: `test/hints.test.js`
- Modify: `vitest.config.ts` (alias list, after the `/celebrate.js` entry)

- [ ] **Step 1: Add the vitest alias**

In `vitest.config.ts`, in the `resolve.alias` array directly after the `/celebrate.js` line, add:

```ts
      { find: /^\/hints\.js$/, replacement: new URL("./public/hints.js", import.meta.url).pathname },
```

- [ ] **Step 2: Write the failing tests**

Create `test/hints.test.js`:

```js
import { describe, it, expect } from "vitest";
import { typingHints } from "/hints.js";

// mask shorthand: g=hot(green) y=warm(yellow) x=cold(gray) — same helper style as penalties.test.js
const g = (word, m) => ({
  word,
  mask: [...m].map((c) => (c === "g" ? "hot" : c === "y" ? "warm" : "cold")),
});

describe("typingHints", () => {
  it("returns null hints on an empty board (nothing proven yet)", () => {
    expect(typingHints("CRANE", [])).toEqual([null, null, null, null, null]);
  });

  it("flags a proven-dead letter as dead", () => {
    const prior = [g("CRANE", "xxxxx")]; // C,R,A,N,E all proven absent
    expect(typingHints("CLOUD", prior)).toEqual(["dead", null, null, null, "dead"]);
  });

  it("confirms a green only at its proven column", () => {
    const prior = [g("CRANE", "xgxxx")]; // R proven hot at col 1
    // R typed at col 1 → confirmed; R typed elsewhere → present (in word, slot unproven)
    expect(typingHints("BRAVO", prior)).toEqual([null, "confirmed", null, null, null]);
    expect(typingHints("ROBIN", prior)).toEqual(["present", null, null, null, null]);
  });

  it("marks a proven-present (yellow) letter as present at ANY column — even its old yellow column", () => {
    const prior = [g("CRANE", "xxyxx")]; // A warm at col 2: in word, not at col 2
    // honest-claims rule: the dot only says "this letter is in the word"
    expect(typingHints("ALOHA", prior)).toEqual(["present", null, null, null, "present"]);
    expect(typingHints("STAIR", prior)).toEqual([null, null, "present", null, null]); // col 2 still shows the dot
  });

  it("is dup-letter safe: a letter green somewhere is never dead (EERIE-style)", () => {
    const prior = [g("EERIE", "gxxxx")]; // first E hot → E present, not dead, despite cold E's
    const hints = typingHints("EVENT", prior);
    expect(hints[0]).toBe("confirmed"); // E at col 0 proven green
    expect(hints[2]).toBe("present");   // E elsewhere: in word
    expect(hints).not.toContain("dead");
  });

  it("upgrades yellow→green: the green column confirms, other columns stay present", () => {
    const prior = [g("CRANE", "xxyxx"), g("ALOHA", "gxxxx")]; // A warm@2 then hot@0
    expect(typingHints("ABBEY", prior)[0]).toBe("confirmed");
    expect(typingHints("OCTAL", prior)[3]).toBe("present");
  });

  it("handles a pending word shorter than the row (only typed columns get hints)", () => {
    const prior = [g("CRANE", "xxxxx")];
    expect(typingHints("CR", prior)).toEqual(["dead", "dead"]);
  });

  it("dead and present can coexist in one pending word", () => {
    const prior = [g("CRANE", "xyxxx")]; // C dead, R present
    expect(typingHints("CURRY", prior)).toEqual(["dead", null, "present", "present", null]);
  });

  it("is case-insensitive on the pending input", () => {
    const prior = [g("CRANE", "xxxxx")];
    expect(typingHints("cr", prior)).toEqual(["dead", "dead"]);
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run test/hints.test.js`
Expected: FAIL — cannot resolve `/hints.js` (module doesn't exist yet).

- [ ] **Step 4: Implement `public/hints.js`**

```js
// Wordul — Easy-mode typing hints (pure; no DOM, no app.js imports)
// Derives what prior guesses PROVED about each letter of the pending word, so the
// typing row can confirm/warn live. Honest-claims rule: every hint is a statement
// proven by prior masks — nothing speculative.
//   "dead"      — letter proven absent (gray somewhere, never green/yellow anywhere)
//   "confirmed" — this letter was proven GREEN at exactly this column
//   "present"   — letter proven in the word (green/yellow anywhere), slot unproven
//   null        — nothing proven about this letter
// Reuses deadLettersFrom (celebrate.js) — the dup-letter-safe two-pass — rather than
// duplicating that logic. Mirrors the purity discipline of celebrate.js/roomConfig.js.
import { deadLettersFrom } from "/celebrate.js";

export function typingHints(pending, guesses) {
  const word = (pending || "").toUpperCase();
  const out = new Array(word.length).fill(null);
  if (!word.length) return out;
  const dead = deadLettersFrom(guesses || []);
  const greenAt = new Map(); // col -> letter proven hot there
  const present = new Set(); // letters proven in-word (hot or warm anywhere)
  for (const gRow of guesses || []) {
    if (!gRow || !gRow.mask) continue;
    const w = gRow.word || "";
    for (let i = 0; i < gRow.mask.length; i++) {
      const c = (w[i] || "").toUpperCase();
      if (gRow.mask[i] === "hot") { greenAt.set(i, c); present.add(c); }
      else if (gRow.mask[i] === "warm") present.add(c);
    }
  }
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (dead.has(c)) out[i] = "dead";
    else if (greenAt.get(i) === c) out[i] = "confirmed";
    else if (present.has(c)) out[i] = "present";
  }
  return out;
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run test/hints.test.js`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add public/hints.js test/hints.test.js vitest.config.ts
git commit -m "feat(hints): pure typingHints knowledge derivation for Easy mode"
```

---

### Task 2: `difficulty` setting + migration + `activeDifficulty()`

**Files:**
- Modify: `public/settings.js` (DEFAULT_SETTINGS at line ~15, `getSettings` at ~31, new export)
- Test: `test/settings.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/settings.test.js` (and fix the two existing assertions that reference `hardMode` defaults — see Step 3):

```js
import { activeDifficulty } from "/settings.js"; // add to the existing import line

describe("difficulty setting", () => {
  it("defaults to easy when nothing is stored", () => {
    expect(getSettings().difficulty).toBe("easy");
    expect(activeDifficulty()).toBe("easy");
  });
  it("migrates legacy hardMode:true to hard", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ hardMode: true }));
    expect(getSettings().difficulty).toBe("hard");
  });
  it("migrates legacy hardMode:false to easy", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ hardMode: false }));
    expect(getSettings().difficulty).toBe("easy");
  });
  it("a stored difficulty wins over the legacy hardMode key", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ hardMode: true, difficulty: "medium" }));
    expect(getSettings().difficulty).toBe("medium");
  });
  it("falls back to easy on a garbage stored value", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ difficulty: "nightmare" }));
    expect(getSettings().difficulty).toBe("easy");
  });
  it("activeDifficulty tracks saved changes", () => {
    saveSettings({ ...getSettings(), difficulty: "hard" });
    expect(activeDifficulty()).toBe("hard");
  });
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `npx vitest run test/settings.test.js`
Expected: new `difficulty` describe FAILS (`difficulty` undefined / `activeDifficulty` not exported). Pre-existing tests still pass.

- [ ] **Step 3: Implement in `public/settings.js`**

Replace `hardMode: false,` in `DEFAULT_SETTINGS` with:

```js
  // Difficulty tiers (spec 2026-06-07): easy = live typing hints, medium = the classic
  // game (no hints, no penalties), hard = must-use-hints + dead-letter drain + bankruptcy.
  // Default EASY while the new-player features land (Yan, Jun 7 2026). Legacy hardMode
  // is migrated in getSettings and the old key is left in storage, ignored (cheap rollback).
  difficulty: "easy",
```

Replace the body of `getSettings` with:

```js
const DIFFICULTIES = ["easy", "medium", "hard"];

export function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const s = { ...DEFAULT_SETTINGS, ...stored };
    // Migration: pre-tier saves have hardMode but no (valid) difficulty.
    if (!DIFFICULTIES.includes(stored.difficulty)) {
      s.difficulty = stored.hardMode === true ? "hard" : "easy";
    }
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// THE difficulty resolver — every consumer reads through this (never getSettings()
// directly) so the future per-world/room override layer can interpose here
// (spec §5: a world forcing hard replaces the player's local pick).
export function activeDifficulty() {
  return getSettings().difficulty;
}
```

(Keep `SETTINGS_KEY` above; `DIFFICULTIES` sits next to `DEFAULT_SETTINGS`.)

- [ ] **Step 4: Fix the two legacy assertions in `test/settings.test.js`**

The existing test `"returns the defaults when nothing is stored"` does `toEqual(DEFAULT_SETTINGS)` — still fine (hardMode key is simply gone from defaults). Update these two:
- `"merges stored values over the defaults"`: change `expect(s.hardMode).toBe(true);` to `expect(s.difficulty).toBe("hard");` (the stored `{hardMode:true}` now migrates).
- `"does not mutate DEFAULT_SETTINGS between calls"`: change the `hardMode` mutations to `difficulty` (`a.difficulty = "hard"` / expect `getSettings().difficulty` to be `"easy"` / `DEFAULT_SETTINGS.difficulty` to be `"easy"`).
- `"lets a stored companionComments=true override the off default"`: change `expect(getSettings().hardMode).toBe(false);` to `expect(getSettings().difficulty).toBe("easy");`.

- [ ] **Step 5: Run tests, verify all pass**

Run: `npx vitest run test/settings.test.js`
Expected: PASS, including the migration suite.

- [ ] **Step 6: Commit**

```bash
git add public/settings.js test/settings.test.js
git commit -m "feat(settings): difficulty tiers (easy/medium/hard) + legacy hardMode migration"
```

---

### Task 3: Switch every hardMode read to `activeDifficulty()`

**Files:**
- Modify: `public/app.js` (3 sites: penalty gate ~2264, submit constraint gate ~4074, guess message ~4086)
- Modify: `public/powerups.js` (~301)

- [ ] **Step 1: app.js — import the resolver**

`app.js` already imports from `/settings.js` (find the existing import line containing `getSettings`); add `activeDifficulty` to that import list.

- [ ] **Step 2: app.js — penalty gate (~line 2264)**

```js
        if (getSettings().hardMode) {
```
becomes
```js
        if (activeDifficulty() === "hard") {
```

- [ ] **Step 3: app.js — submit constraint gate (~line 4074)**

```js
  const s = getSettings();
  if (s.hardMode) {
```
becomes
```js
  if (activeDifficulty() === "hard") {
```
(If `s` has no other use in `submitGuess` after this change, delete the `const s = getSettings();` line; Step 4 removes its last use.)

- [ ] **Step 4: app.js — guess message (~line 4086)**

```js
  send({ type: "guess", word: game.pending, hard: !!s.hardMode });
```
becomes
```js
  send({ type: "guess", word: game.pending, hard: activeDifficulty() === "hard" });
```

- [ ] **Step 5: powerups.js — bankruptcy gate (~line 301)**

`powerups.js` imports from `/settings.js` already (it calls `getSettings()`); add `activeDifficulty` to that import, then:

```js
  if (!isBankrupt(getGold(), getSettings().hardMode)) return;
```
becomes
```js
  if (!isBankrupt(getGold(), activeDifficulty() === "hard")) return;
```

- [ ] **Step 6: Verify no read remains + suite passes**

Run: `grep -rn "\.hardMode" public/ | grep -v settings.js` → expected: **no output**.
Run: `npm run check-graph && npm test`
Expected: all pass (1087+ tests — penalty/economy tests are unaffected because the server twin is untouched).

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/powerups.js
git commit -m "refactor(difficulty): all hard-mode gates read activeDifficulty()"
```

---

### Task 4: Hint classes on both pending-row render paths + CSS

**Files:**
- Modify: `public/app.js` (`renderBoards` pending branch ~3740; `syncMyInputRow` ~3869)
- Modify: `public/style.css` (after the `.tile.cold` rule ~line 943; reduced-motion block ~1855)

- [ ] **Step 1: app.js — import typingHints**

Add to the import block at the top of `app.js` (next to the `/celebrate.js` import):

```js
import { typingHints } from "/hints.js";
```

- [ ] **Step 2: app.js — full render path**

In `renderBoards`, the per-player loop already binds `pending` for my current row. Just above the `for (let c = 0; c < cols; c++)` tile loop (~line 3726), where `isMe` and `isCurrentRow` are in scope for the row, add:

```js
      // Easy mode: the typing row wears a live "knowledge lens" — classes derived
      // from what prior guesses PROVED (hints.js). Same facts the keyboard colors
      // show, surfaced where the eyes are. Result fills stay settled-rows-only.
      const rowHints = isMe && isCurrentRow && activeDifficulty() === "easy" && p.guesses
        ? typingHints(pending, p.guesses) : null;
```

Then in the pending-tile branch (~3740):

```js
        } else if (isMe && isCurrentRow && pending[c]) {
          tile.classList.add("filled", "pop");
          if (rowHints?.[c]) tile.classList.add(`hint-${rowHints[c]}`);
          tile.textContent = pending[c];
        }
```

- [ ] **Step 3: app.js — typing fast path (`syncMyInputRow`, ~3869)**

The early-return branch (letter unchanged) keeps its classes — hints only change when a letter changes or a guess lands (which full-renders), so it needs no edit. The rewrite branch does:

```js
function syncMyInputRow(board, snap, me) {
  if (snap.phase !== "playing" || me.status !== "playing") return;
  const inputRow = board.querySelectorAll(".grid-row")[me.guesses.length];
  if (!inputRow) return;
  const pending = game.pending;
  // Easy-mode knowledge lens — must match the full-render path (renderBoards).
  const hints = activeDifficulty() === "easy" ? typingHints(pending, me.guesses) : null;
  inputRow.querySelectorAll(".tile").forEach((tile, c) => {
    const want = pending[c] ?? "";
    const isCursor = c === pending.length;
    if (tile.textContent === want && tile.classList.contains("filled") === !!want) {
      tile.classList.toggle("cursor", isCursor); // letter unchanged — just move the cursor
      return;
    }
    tile.className = "tile";
    tile.textContent = "";
    if (want) {
      tile.classList.add("filled", "pop");
      if (hints?.[c]) tile.classList.add(`hint-${hints[c]}`);
      tile.textContent = want;
    }
    else if (isCursor) tile.classList.add("cursor");
  });
}
```

- [ ] **Step 4: style.css — the hint vocabulary**

After the `.tile.cold` rule (~line 943), add:

```css
/* Easy-mode typing hints (spec 2026-06-07): knowledge wears SHAPES, results wear FILLS.
   Hues reuse the result tokens (so body.cb colorblind overrides apply for free) but a
   pending tile never gets a solid fill — the flip reveal keeps its drama.
   hint-dead      letter proven absent  → dimmed + red, one silent shake-blink on entry
   hint-confirmed letter proven green HERE → green ring
   hint-present   letter proven in-word → yellow underline dot */
.tile.hint-dead {
  color: color-mix(in srgb, var(--error) 70%, var(--fg));
  opacity: 0.55;
  animation: hint-dead-blink 0.45s ease-in-out;
}
@keyframes hint-dead-blink {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-3px); border-color: var(--error); }
  50% { transform: translateX(3px); border-color: var(--error); }
  75% { transform: translateX(-2px); border-color: var(--error); }
}
.tile.hint-confirmed {
  border-color: var(--hot);
  box-shadow: inset 0 0 0 2px var(--hot);
}
.tile.hint-present {
  box-shadow: inset 0 -4px 0 0 var(--warm);
}
```

Note `.tile.pop` already animates `transform` via `pop` — `hint-dead-blink` replaces it on dead tiles (later class, same property, single `animation` declaration wins via specificity tie → order). Both end at identity transform, so no visual conflict; do NOT try to compose the two keyframes.

- [ ] **Step 5: style.css — reduced motion**

In the `body.reduced-motion` block (~line 1855), add `.tile.hint-dead` to the existing animation-killing selector list (`body.reduced-motion .tile.pop, ...`):

```css
body.reduced-motion .tile.hint-dead,
```
(The static dim + red tint stays — only the blink is motion.)

- [ ] **Step 6: Verify**

Run: `npm run check-graph && npm test`
Expected: all pass (`check-graph` proves the new `app.js → /hints.js` edge resolves).

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat(easy): live typing hints on the entry row — dead blink, green ring, yellow dot"
```

---

### Task 5: Settings UI — Easy/Medium/Hard chips

**Files:**
- Modify: `public/index.html` (Gameplay section, the `#setHardMode` row ~lines 451–460)
- Modify: `public/settings.js` (`openSettings` — replace the `#setHardMode` wiring)

- [ ] **Step 1: index.html — replace the Hard Mode toggle row**

Replace the whole `<label class="setting-row" for="setHardMode">…</label>` block (lines ~451–460) with:

```html
        <div class="setting-row" id="difficultyRow">
          <div class="setting-text">
            <div class="setting-name">Difficulty</div>
            <div class="setting-desc" id="difficultyDesc"></div>
          </div>
          <div class="chip-row" id="difficultyPicker">
            <button type="button" class="edition-chip" data-difficulty="easy">Easy</button>
            <button type="button" class="edition-chip" data-difficulty="medium">Medium</button>
            <button type="button" class="edition-chip" data-difficulty="hard">Hard</button>
          </div>
        </div>
```

- [ ] **Step 2: settings.js — wire the chips**

In `openSettings`, delete the `#setHardMode` lines (`const hm = …`, `if (hm) hm.checked = …`, `wire(hm, "hardMode");`) and add, after the `wire(cc, "companionComments");` line:

```js
  // Difficulty chips (easy/medium/hard). Same chip pattern as the layout picker;
  // the desc line re-renders per pick so each tier explains itself.
  const DIFFICULTY_DESC = {
    easy: "Typing shows what you already know: proven letters glow, dead letters blink",
    medium: "No hints, no penalties — the classic game",
    hard: "Revealed hints must be used, reusing eliminated letters drains gold, and bankruptcy past −300 ends the game",
  };
  const diffPicker = document.getElementById("difficultyPicker");
  const diffDesc = document.getElementById("difficultyDesc");
  const paintDifficulty = (cur) => {
    if (diffDesc) diffDesc.textContent = DIFFICULTY_DESC[cur] ?? "";
    diffPicker?.querySelectorAll(".edition-chip").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.difficulty === cur));
  };
  if (diffPicker && diffPicker.dataset.wired !== "1") {
    diffPicker.dataset.wired = "1"; // delegated once — re-opens must not stack handlers
    diffPicker.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-difficulty]");
      if (!chip) return;
      saveSettings({ ...getSettings(), difficulty: chip.dataset.difficulty });
      paintDifficulty(chip.dataset.difficulty);
      onChange?.();
    });
  }
  paintDifficulty(s.difficulty);
```

Note: `onChange` is captured per-open by this closure but the listener is wired once — to keep the freshest `onChange`, store it: add `diffPicker.dataset.wired` guard exactly as shown and accept that `onChange` from the FIRST open is reused (it's the same `() => { if (game.snapshot) render(); }` every open — verified at the app.js call site). Do not clone-replace the picker (that would orphan `paintDifficulty`'s node references).

- [ ] **Step 3: chip-row CSS check**

`#difficultyPicker` chips reuse `.edition-chip` styling. Check `grep -n "chip-row" public/style.css` — if `.chip-row` doesn't exist, add next to `.edition-chip` (~line 1756):

```css
.chip-row { display: flex; gap: 6px; flex-wrap: wrap; }
```

- [ ] **Step 4: Verify**

Run: `npm run check-graph && npm test`
Expected: PASS. Also `grep -rn "setHardMode" public/` → expected: **no output** (id fully retired).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/settings.js public/style.css
git commit -m "feat(settings): difficulty chips (Easy/Medium/Hard) replace the Hard Mode toggle"
```

---

### Task 6: How-to-play note + full gate

**Files:**
- Modify: `public/how-to-play.html` (after the Gold section, ~line 126)

- [ ] **Step 1: Add the Difficulty note**

After the closing `</section>` of section 3 (Gold, ~line 126), insert:

```html
  <section class="howto-section">
    <h2>4. Difficulty 🎚️</h2>
    <ul>
      <li><strong>Easy</strong> — typing shows what you already know: proven letters glow, dead letters blink. <span class="muted">(default)</span></li>
      <li><strong>Medium</strong> — no hints, no penalties. The classic game.</li>
      <li><strong>Hard</strong> — revealed hints must be used, dead letters drain gold, bankruptcy past −300 ends the game.</li>
    </ul>
  </section>
```

Then renumber the following section headings (current `4. Power-ups` → `5.`, `5. Editions` → `6.`, and any later ones — check with `grep -n "<h2>" public/how-to-play.html`).

- [ ] **Step 2: Full gate**

Run: `npm run check-graph && npm run typecheck && npm test`
Expected: ALL pass.

- [ ] **Step 3: Commit**

```bash
git add public/how-to-play.html
git commit -m "docs(how-to-play): difficulty tiers note"
```

---

### Task 7: Browser QA (staging lane)

Version preview URLs never work for this DO worker — use the preview worker (memory: `wordul-preview-staging-lane`).

- [ ] **Step 1: Deploy the branch to the preview lane**

```bash
npx wrangler deploy -c wrangler.preview.jsonc
```

- [ ] **Step 2: QA script** (browse skill or manual on `https://wordul-preview.love-00b.workers.dev`)

1. Fresh profile (or `localStorage.clear()`): Settings → Gameplay shows **Difficulty: Easy** active.
2. Start the daily. Guess `CRANE` (or any valid opener). Then type a letter that came back gray → tile dims red + one shake-blink, **no sound, no gold change**. Type a letter that flashed yellow → yellow underline dot. If a green landed, retype it in the same column → green ring; another column → yellow dot.
3. Press Enter on a dead-letter guess → accepted, **no drain** in the hacklog.
4. Settings → Hard: the typed hints disappear; reuse a dead letter → −50 drain + mistake fx return; hard-mode constraint toast blocks a hint-skipping guess.
5. Settings → Medium: no hints, no drain.
6. `localStorage.setItem("wr.settings", JSON.stringify({hardMode:true})); location.reload()` → Settings shows **Hard** active (migration).
7. Reduced Motion ON + Easy: dead letter shows static dim+red, no blink.

- [ ] **Step 3: Done — hand back for ship**

Ship to prod is Yan's call (`/push`), not part of this plan.

---

## Self-review notes

- Spec coverage: §1→Task 2+3, §2→Task 1, §3→Task 4, §4→Task 5, §6 testing→Tasks 1/2/6, §5 (designed-for) → `activeDifficulty()` indirection in Task 2; how-to-play→Task 6. ✓
- `activeDifficulty()` lives in **settings.js** (not app.js as the spec's parenthetical said) — powerups.js needs it too and settings.js is the shared, cycle-free home. Spec intent (single resolver) preserved.
- Type consistency: hint values `"dead"|"confirmed"|"present"|null` (Task 1) ↔ classes `hint-dead/hint-confirmed/hint-present` (Task 4) ↔ CSS selectors (Task 4). `difficulty` values `"easy"|"medium"|"hard"` everywhere. ✓
