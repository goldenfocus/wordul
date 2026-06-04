# Vibe Studio v1 — Increment 2: Theme-Driven Day Page (palette re-theming) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a curated daily's `colorScheme` (the `{a1,a2,a3}` palette from Increment 1) + `vibeTitle` actually re-theme the day page — `a1` re-lights all existing accent chrome, `a1/a2/a3` atoms drive bespoke palette layers (atmosphere glow, deep-tinted veil, gradient title), and `vibeTitle` becomes the board title — degrading cleanly to today's exact look for legacy days that carry no palette.

**Architecture:** The palette is additive on the existing edition system. Server threads `colorScheme`/`vibeTitle` from the World through `RoomSnapshot` (auto-flows to the client via `snapshotFor`'s `...this.state` spread — these fields don't leak the answer, so unlike `story` they ride un-gated). The client applies them right after `applyEdition`: a pure helper maps the palette to CSS custom properties on `<html>` and flags `html[data-themed]`; new CSS layers gated on that flag paint the bespoke skin. A null palette clears the atoms + flag, leaving the edition's own `--accent` untouched.

**Tech Stack:** TypeScript (server, `src/`), vanilla ESM + CSS custom properties (client, `public/`), Vitest + jsdom (`test/`).

**Context:** Worktree `.claude/worktrees/vibe-studio` on branch `vibe-studio`, rebased onto `origin/main` (`cdfe793`). Increment 1 (`World` palette fields + `normalizeWorld`) shipped as `prod-300`; Lane 0 (`prod-298`) already routes `.daily-unlock` chrome through `color-mix(var(--accent))`. The DAILY DO `/resolve` returns the full normalized World via `Response.json(world)` (`src/daily.ts:31`), so `colorScheme`/`vibeTitle` already reach the Room DO — no `daily.ts` change. Tests: `npm test` · Typecheck: `npm run typecheck` · Dev: `npm run dev` · Ship: `bash dev/ship.sh`.

**Scope (confirmed with user):** Full palette re-theme using **only data that exists today** (`colorScheme`, `vibeTitle`). Deferred to later increments because no assets/authoring exist yet: image bands + per-band `glow` + `playlist` autoplay → Increment 2b/5; variable `rows` (changes difficulty) → 2b.

**Why no server-side unit test (honest test shape):** vitest runs `environment: "node"` with no `cloudflare:test` pool, so the `Room` DO is not bootable in tests (`test/room-seed.test.ts` only tests the pure `projectPlayerForClient`). The server change is a type widening + two field assignments that flow through an existing `...this.state` spread — **typecheck-verified, guaranteed by construction.** Real TDD lives in Tasks 2–3 (the pure client helpers, unit-tested in jsdom). Tasks 4–5 (app.js wiring, CSS) are verified in the browser against a locally-scheduled themed day.

---

## File Structure

- **Modify:** `src/types.ts` — add `colorScheme?` + `vibeTitle?` to the `RoomSnapshot` type (the single type `room.ts` uses for `this.state` and the outbound snapshot).
- **Modify:** `src/room.ts` — widen the `seedDailyIfNeeded` World-fetch type; assign the two fields into `this.state`.
- **Modify:** `public/edition.js` — add two exported functions: pure `colorSchemeVars(cs)` (palette→CSS-var map) and `applyColorScheme(cs)` (apply/clear on `<html>`). Single responsibility: the palette↔CSS-var contract lives next to `applyEdition`, which owns `--accent`.
- **Modify:** `public/app.js` — import + call `applyColorScheme` after `applyEdition` in `onServerMessage`; clear it on home; use `vibeTitle` as the daily board title.
- **Modify:** `public/style.css` — convert the daily-story kicker's hardcoded ultraviolet to `--accent`; add `html[data-themed]` bespoke layers (atmosphere glow, deep-tinted veil, gradient `vibeTitle`).
- **Test:** `test/edition.test.js` — unit tests for `colorSchemeVars` + `applyColorScheme` (jsdom).

---

## Task 1: Server — thread `colorScheme` + `vibeTitle` through the snapshot

**Files:**
- Modify: `src/types.ts` (the `RoomSnapshot` type, around lines 79–84)
- Modify: `src/room.ts` (`seedDailyIfNeeded`, the World-fetch type ~440–443 and the assignments ~454–456)

No unit test (see "Why no server-side unit test" above) — verified by `npm run typecheck`.

- [ ] **Step 1: Add the two optional fields to `RoomSnapshot`** in `src/types.ts`, immediately after the `voice?:` line (currently line 84):

```ts
  voice?: string;          // World companion voice id (forward-compat; client still defaults)
  // --- Vibe Studio v1: curated day-page theming (additive; absent on legacy days) ---
  colorScheme?: { a1: string; a2: string; a3: string } | null; // palette → CSS-var re-theme
  vibeTitle?: string;      // curated title; becomes the daily board title when present
```

- [ ] **Step 2: Widen the World-fetch type** in `src/room.ts` `seedDailyIfNeeded` (currently lines 440–443):

```ts
      const world = (await res.json()) as {
        word: string; edition: string; voice: string;
        story: { title: string; body: string; tip?: string };
        colorScheme?: { a1: string; a2: string; a3: string };
        vibeTitle?: string;
      };
```

- [ ] **Step 3: Assign the fields into `this.state`** in `seedDailyIfNeeded`, immediately after `this.state.story = world.story ?? null;` (currently line 456):

```ts
      this.state.colorScheme = world.colorScheme ?? null;
      this.state.vibeTitle = world.vibeTitle;
```

(No `RoomState` init/restore default needed — both are optional; `snapshotFor`'s `...this.state` spread carries them to the client automatically, and they are not answer-leaking so they need no reveal-gating.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/room.ts
git commit -m "feat(daily): thread colorScheme + vibeTitle from World into the room snapshot"
```

---

## Task 2: Client pure core — `colorSchemeVars(cs)` palette→CSS-var map

**Files:**
- Modify: `public/edition.js` (add an exported function near `applyEdition`, after the `VAR_MAP` block / line ~109)
- Test: `test/edition.test.js`

- [ ] **Step 1: Write the failing tests** — append to `test/edition.test.js` (after the existing `applyEdition` describe block):

```js
import { colorSchemeVars } from "/edition.js";

describe("colorSchemeVars", () => {
  it("maps a valid trio to accent + atom vars (a1 drives --accent)", () => {
    expect(colorSchemeVars({ a1: "#f0c14b", a2: "#6f9e7a", a3: "#0b0a0c" })).toEqual({
      "--accent": "#f0c14b", "--a1": "#f0c14b", "--a2": "#6f9e7a", "--a3": "#0b0a0c",
    });
  });
  it("returns null for absent or non-object input", () => {
    expect(colorSchemeVars(null)).toBeNull();
    expect(colorSchemeVars(undefined)).toBeNull();
    expect(colorSchemeVars("nope")).toBeNull();
  });
  it("returns null when any member is missing, non-string, or empty", () => {
    expect(colorSchemeVars({ a1: "#fff", a2: "#000" })).toBeNull();
    expect(colorSchemeVars({ a1: "#fff", a2: 5, a3: "#000" })).toBeNull();
    expect(colorSchemeVars({ a1: "#fff", a2: "", a3: "#000" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/edition.test.js -t "colorSchemeVars"`
Expected: FAIL — `colorSchemeVars` is not exported (import error / undefined).

- [ ] **Step 3: Implement `colorSchemeVars`** in `public/edition.js`, immediately after the `VAR_MAP` constant (line ~109, before `export function applyEdition`):

```js
// Vibe Studio — a curated day ships a 3-color palette {a1,a2,a3}. Map it to the CSS custom
// properties the day page re-themes from: a1 drives --accent (re-lighting every existing
// color-mix(var(--accent)) chrome for free), and a1/a2/a3 are exposed as atoms for the
// bespoke palette layers (atmosphere glow, gradient title). Returns null for an absent or
// malformed palette so callers fall straight back to the active edition's own accent.
export function colorSchemeVars(cs) {
  if (!cs || typeof cs !== "object") return null;
  const { a1, a2, a3 } = cs;
  for (const v of [a1, a2, a3]) if (typeof v !== "string" || !v) return null;
  return { "--accent": a1, "--a1": a1, "--a2": a2, "--a3": a3 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/edition.test.js -t "colorSchemeVars"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/edition.js test/edition.test.js
git commit -m "feat(edition): colorSchemeVars — pure palette to CSS-var map"
```

---

## Task 3: Client DOM — `applyColorScheme(cs)` apply/clear on `<html>`

**Files:**
- Modify: `public/edition.js` (add an exported function right after `colorSchemeVars`)
- Test: `test/edition.test.js`

- [ ] **Step 1: Write the failing tests** — append to `test/edition.test.js`:

```js
import { applyColorScheme } from "/edition.js";

describe("applyColorScheme", () => {
  const html = document.documentElement;
  it("applies accent + atoms and flags data-themed for a valid palette", () => {
    expect(applyColorScheme({ a1: "#f0c14b", a2: "#6f9e7a", a3: "#0b0a0c" })).toBe(true);
    expect(html.style.getPropertyValue("--accent").trim()).toBe("#f0c14b");
    expect(html.style.getPropertyValue("--a2").trim()).toBe("#6f9e7a");
    expect(html.dataset.themed).toBe("1");
  });
  it("clears atoms + the flag for a null palette (returns false)", () => {
    applyColorScheme({ a1: "#f0c14b", a2: "#6f9e7a", a3: "#0b0a0c" });
    expect(applyColorScheme(null)).toBe(false);
    expect(html.style.getPropertyValue("--a1").trim()).toBe("");
    expect(html.style.getPropertyValue("--a3").trim()).toBe("");
    expect(html.dataset.themed).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/edition.test.js -t "applyColorScheme"`
Expected: FAIL — `applyColorScheme` is not exported.

- [ ] **Step 3: Implement `applyColorScheme`** in `public/edition.js`, immediately after `colorSchemeVars`:

```js
// Apply (or clear) a curated day's palette on <html>. A valid palette sets the accent + atom
// vars and flags html[data-themed="1"] so the palette-only CSS layers light up; null removes
// the atoms + flag. We deliberately do NOT clear --accent here: applyEdition owns it and is
// always called first, so on a legacy day / non-daily room the edition's own accent is already
// in place and stays. Returns whether a palette was applied.
export function applyColorScheme(cs) {
  const html = document.documentElement;
  const vars = colorSchemeVars(cs);
  if (!vars) {
    for (const v of ["--a1", "--a2", "--a3"]) html.style.removeProperty(v);
    delete html.dataset.themed;
    return false;
  }
  for (const [k, val] of Object.entries(vars)) html.style.setProperty(k, val);
  html.dataset.themed = "1";
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/edition.test.js -t "applyColorScheme"`
Expected: PASS

- [ ] **Step 5: Run the full edition suite** (guards the existing `applyEdition` tests still pass alongside the new exports):

Run: `npx vitest run test/edition.test.js`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add public/edition.js test/edition.test.js
git commit -m "feat(edition): applyColorScheme — apply/clear a day palette on <html>"
```

---

## Task 4: Wire the palette into the day page (`app.js`)

**Files:**
- Modify: `public/app.js` (import line ~5; `onServerMessage` ~1481–1484; home reset ~212; `render` daily title ~1879)

No unit test — `app.js` is not import-aliased in vitest; verified in the browser in Task 6. Each edit is a minimal, surgical hookup.

- [ ] **Step 1: Import `applyColorScheme`** — extend the existing `/edition.js` import at `public/app.js:5`:

```js
import { applyEdition, applyColorScheme, getActiveEditionId, getGold, setGold, drainGold, companionReact, renderEditionPicker, VOICE_EDITION, activeMistakeFx } from "/edition.js";
```

- [ ] **Step 2: Apply the palette on every snapshot** — in `onServerMessage`, immediately after the `if (wantEd && wantEd !== getActiveEditionId()) { applyEdition(wantEd); applySettings(getSettings()); }` line (currently `public/app.js:1484`), add:

```js
    // Vibe Studio: a curated daily ships a colorScheme — re-theme the whole day page from it
    // (a1 → --accent re-lights all the chrome; a1/a2/a3 atoms drive the bespoke palette layers).
    // Non-daily rooms and legacy days pass null → falls back to the active edition's own accent.
    applyColorScheme(game.isDaily ? msg.room.colorScheme : null);
```

- [ ] **Step 3: Clear the palette when leaving for home** — find the home reset that calls `applyEdition("default")` (currently `public/app.js:212`) and add directly beneath it:

```js
    applyColorScheme(null);
```

- [ ] **Step 4: Use `vibeTitle` as the daily board title** — in `render`, replace the `#roomName` assignment in the `if (game.isDaily)` block (currently `public/app.js:1879`):

```js
    const nameBtn = $("#roomName"); if (nameBtn) nameBtn.textContent = snap.vibeTitle || t("daily.boardTitle", { date: game.dailyDate });
```

- [ ] **Step 5: Typecheck + full suite (no regressions)**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(daily): apply curated palette + vibeTitle on the day page; clear on home"
```

---

## Task 5: CSS — bespoke palette layers gated on `html[data-themed]`

**Files:**
- Modify: `public/style.css` (the `.daily-story-kicker` rule ~2473; append new `html[data-themed]` rules after the `.daily-tip` rule ~2501)

No unit test (visual) — verified in the browser in Task 6. All new layers are gated on `html[data-themed]`, so legacy/un-themed days are byte-for-byte unchanged; they also fall back via `var(--a2, var(--accent))` if an atom is somehow missing.

- [ ] **Step 1: Re-light the story kicker from `--accent`** — replace the hardcoded ultraviolet in `.daily-story-kicker` (currently `public/style.css:2473–2479`) so a curated palette recolors it (matches Lane 0's accent-driven approach):

```css
.daily-story-kicker {
  display: block;
  font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--accent);
  text-shadow: 0 0 8px color-mix(in srgb, var(--accent) 50%, transparent);
  margin-bottom: 6px;
}
```

- [ ] **Step 2: Add the bespoke palette layers** — insert after the `.daily-tip { … }` rule (currently ends `public/style.css:2501`):

```css
/* ── Vibe Studio: curated-day re-theme (only when a colorScheme is applied → html[data-themed]) ──
   These layers are inert on legacy days. a1 already drives --accent (re-lighting the rim, border,
   kicker, tip rule); a2 adds a cooler counter-bloom and a3 deepens the glass toward the palette. */
html[data-themed] .daily-unlock {
  background: color-mix(in srgb, var(--a3, #0c0b10) 70%, rgba(12, 11, 16, 0.55));
}
html[data-themed] .daily-unlock::after {
  content: ""; position: absolute; inset: 0; border-radius: 22px; pointer-events: none; z-index: 0;
  background: radial-gradient(ellipse 90% 60% at 50% 100%,
    color-mix(in srgb, var(--a2, var(--accent)) 16%, transparent) 0%, transparent 70%);
}

/* The curated day's title (vibeTitle) wears the palette itself: an a1→a2 gradient ink with an
   a1 glow, printed into the board title. Falls back to a flat accent if background-clip is unset. */
html[data-themed] body.daily #roomName {
  background: linear-gradient(100deg, var(--a1, var(--accent)) 0%,
    color-mix(in srgb, var(--a2, var(--accent)) 70%, var(--a1, var(--accent))) 100%);
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 14px color-mix(in srgb, var(--a1, var(--accent)) 45%, transparent));
}
```

- [ ] **Step 3: Sanity-check the CSS parses** (no build step; quick brace/paren check)

Run: `node -e "const c=require('fs').readFileSync('public/style.css','utf8'); const o=(c.match(/{/g)||[]).length, x=(c.match(/}/g)||[]).length; if(o!==x){console.error('brace mismatch',o,x);process.exit(1)} console.log('braces balanced',o)"`
Expected: `braces balanced <N>` (open === close).

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "feat(daily): palette-driven bespoke day-page layers (atmosphere, deep veil, gradient title)"
```

---

## Task 6: Browser verification + ship

**Files:** none

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all test files pass; `tsc --noEmit` exits 0.

- [ ] **Step 2: Start the local dev server**

Run: `npm run dev` (background)
Note the local URL (e.g. `http://localhost:8787`).

- [ ] **Step 3: Schedule a themed day for TODAY on the LOCAL server** (local DO storage only — never touches prod). Replace `TODAY` with the actual UTC date and `TOKEN` with the local admin token (`DAILY_ADMIN_TOKEN`):

```bash
curl -s -X POST "http://localhost:8787/daily/schedule" \
  -H "Authorization: Bearer $DAILY_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"date":"TODAY","word":"EMBER","vibeTitle":"Embers","colorScheme":{"a1":"#f0c14b","a2":"#6f9e7a","a3":"#0b0a0c"},"story":{"title":"Why EMBER?","body":"A small warmth that outlasts the fire."}}'
```
Expected: 200 + a normalized World echoing `vibeTitle:"Embers"` and the `colorScheme`.

- [ ] **Step 4: Open the daily and verify the re-theme** (browser — use the `browse`/`connect-chrome` skill or open manually). Open `http://localhost:8787/daily/TODAY`, play to completion, and confirm:
  - The board title reads **Embers** in a gold→sage gradient with a soft glow (not the date).
  - The `.daily-unlock` veil rim + border are **gold** (accent = a1), with a cooler sage counter-bloom from the lower half, and the glass is deepened toward a3.
  - The story kicker ("WHY THIS WORD") is **gold**, the tip rule (if any) gold.
  - Then open a **non-themed** day or a normal room and confirm it returns to today's default look (no gold leak, `html` has no `data-themed`, no `--a1/--a2/--a3` set).

- [ ] **Step 5: Stop the dev server.**

- [ ] **Step 6: Ship**

Run: `bash dev/ship.sh`
Expected: tests → rebase onto `origin/main` → backup tag → fast-forward main → CI deploys `origin/main` (or local-deploy fallback) → release tag `prod-<N>`. If main was pushed by another tab, re-run `dev/ship.sh`. (Prod's real daily is untouched — the themed day was scheduled only on the local DO.)

- [ ] **Step 7: Update the build-status memory** at `/Users/zang/.claude/projects/-Users-zang-wordul/memory/vibe-studio-build-status.md` — record `prod-<N>` (Increment 2), the `--accent`/`--a1/--a2/--a3` + `html[data-themed]` contract, and that image/glow/playlist/rows remain deferred to 2b/5.

---

## Self-Review (run against the spec + Increment-2 scope)

**Scope coverage:** `colorScheme` → CSS vars ✓(T2/T3) + applied on the day page ✓(T4) + bespoke CSS layers ✓(T5); `vibeTitle` → board title ✓(T4) + gradient styling ✓(T5); server threading ✓(T1); graceful fallback for legacy days ✓ (null-path in T3 clears atoms/flag; T5 layers gated on `html[data-themed]` and use `var(--atom, var(--accent))`). **Deferred (documented in header):** image bands, per-band `glow`, `playlist` autoplay, variable `rows`.

**Placeholder scan:** none — every code step shows real code; `TODAY`/`TOKEN` in Task 6 are explicitly flagged runtime substitutions, not code placeholders.

**Type/name consistency:** `colorSchemeVars` and `applyColorScheme` are defined in T2/T3 and consumed in T4 with matching signatures; the var names `--accent`/`--a1`/`--a2`/`--a3` and the `html[data-themed]` flag are produced in T3 and consumed by the T5 selectors identically; `colorScheme`/`vibeTitle` field names match the `World` interface (Increment 1) and the `RoomSnapshot` additions in T1.

**Honesty of verification:** server change is typecheck-only by necessity (no DO test harness exists — stated in header + Task 1); real TDD is on the pure client helpers (T2/T3); UI is browser-verified against a locally-scheduled themed day that never touches prod (T6).
