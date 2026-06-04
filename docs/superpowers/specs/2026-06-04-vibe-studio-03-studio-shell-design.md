# Vibe Studio — Increment 3: Studio Shell + Word/size + Palette (design)

**Status:** approved design, ready for implementation-planning.
**Parent spec:** `docs/superpowers/specs/2026-06-03-vibe-studio-design.md` (the full Stage vision).
**Builds on:** Increment 2 (`prod-312`) — the locked CSS-var contract `colorScheme.a1 → --accent`
+ atoms `--a1/--a2/--a3`, and the pure client functions `colorSchemeVars(cs)` /
`applyColorScheme(cs)` in `public/edition.js`. This increment **reuses** them, never duplicates.

---

## Goal

Ship the first **authoring surface** — a standalone, admin-facing "Stage" page where you set a
day's **title**, **word + size + guesses**, and a **3-colour palette** and watch the whole page
**re-light live** through the exact CSS-var contract that themes the real day page. It is the
cheap, high-signal core: prove WYSIWYG re-lighting and live board reflow before adding the
heavier tools (voice, images, sound) and real scheduling.

This increment **mutates nothing server-side** and **schedules nothing**. It is a read-only
authoring preview with a local draft.

## Non-goals (deferred to later increments)

- Real scheduling / `POST /daily/schedule` and admin/curator auth gating → **Increment 6**.
- Voice editor over `roomConfig` → **Increment 4**.
- Images & glow, room MP3 player → **Increment 5**.
- Interactive **test-play** board (typing, guess evaluation, keyboard capture) → later. The board
  here is a **static themed preview** only.
- Story editor, AI seams, mobile bottom-sheets → later increments.

## Decisions (locked in brainstorm)

- **Architecture — standalone page reusing the contract (Approach A).** New
  `public/vibe-studio.html` + `public/vibe-studio.js`, served at `/vibe-studio`. It loads the
  **same** `public/style.css` and imports the Increment-2 pure functions from `edition.js`, so a
  palette change drives the identical `--a1/--a2/--a3 → --accent` cascade that themes the live
  day page. Fully isolated from the SPA (`app.js`) — separate document, separate JS, zero risk to
  the live game. (Rejected: embedding in the SPA, iframing the day page — both heavier and
  premature for a shell.)
- **Board — static themed preview.** Renders a grid of `len` columns × `rows` rows that reflows
  live as size/guesses change, with one representative sample row coloured green/yellow/gray that
  re-lights with the palette (green ← `--a1`, yellow ← `--a2`). Tile size is **CSS-derived from
  column count** (not JS px) per the parent spec's mobile rule. No typing this increment.
- **Persistence — localStorage draft.** The working vibe auto-saves to
  `localStorage["wordul.vibeStudio.draft"]` and restores on load. No server.
- **Route — `/vibe-studio`, no auth gate this increment.** Nothing server-side is mutated, so
  there is nothing to protect yet; real gating arrives with scheduling (Increment 6).
- **Aesthetic — Glass Aurora, ZERO pills.** Palette-driven aurora behind the whole page. Tools
  are glass cards with dissolved edges; the Submit/Schedule action is a **non-pill** text+arrow+
  glow seam — and this increment it is **inert** (disabled "coming soon" ghost), present so the
  layout is honest but wired to nothing.
- **Real ✓ / invented ✨ badge — soft, non-blocking, via `dictionaryapi.dev`.** Reuses the
  existing CORS-friendly pattern already in `app.js:2924`. Debounced; classifies the current word
  as real / invented / (checking). It **never gates** input — the only hard rule is length 4–12.

## Surface (this increment)

A single page reading top-to-bottom as the day itself:

1. **Header** — editable **title** input (`vibeTitle`) rendered as the gradient hero (the
   `.daily-vibe-title` treatment Increment 2 shipped), plus a quiet "Vibe Studio · draft" role line.
2. **Board zone** — a live **word label** above the static themed preview board (reflows to
   `len × rows`; sample coloured row re-lights with the palette).
3. **Tool rail** (floating glass, non-pill) with two tools:
   - **Word & size** — word input (4–12, forced uppercase, `^[A-Z]*$`), a length read-out, a
     **rows 3–10** control, and the **real/invented badge**.
   - **Palette** — three swatch pickers + **🎲 Random harmony**; every change re-lights the page.
4. **Schedule bar** — an **inert** non-pill "Submit my day →" seam (disabled, "coming soon").

## Data model & logic

In-memory working object, persisted to localStorage:

```js
vibe = { vibeTitle, word, len, rows, colorScheme: { a1, a2, a3 } }
```

Pure, testable helpers in a new **`public/vibe-studio-core.js`** (ESM, no DOM), unit-tested under
`test/`:

- `randomHarmony(seedHue?)` → `{ a1, a2, a3 }` three valid distinct hex colours via HSL triad
  rotation (a1 base, a2/a3 rotated ~ ±120° with tuned lightness/sat). Deterministic given a hue
  so it is assertable; the live "🎲" supplies a varied hue (avoid `Math.random` in tests — inject).
- `reflowDims(len, rows)` → clamps `len` to 4–12 and `rows` to 3–10, returns integers.
- `classifyWord(word, lookup)` → `"checking" | "real" | "invented" | "tooShort"` where `lookup`
  is an **injected** async fn (the real one wraps `dictionaryapi.dev`); keeps the classifier pure
  and fetch-free for tests.
- `serializeDraft(vibe)` / `restoreDraft(raw)` → round-trip the draft, tolerant of missing/old
  fields (mirrors `normalizeWorld`'s defaulting spirit).

Colour-var mapping is **not** re-implemented — `public/vibe-studio.js` imports `colorSchemeVars`
from `edition.js` and applies it to the studio document, exactly as the day page does.

## Routing

Static assets already serve from `./public` (`wrangler.jsonc` `assets.directory`), so
`/vibe-studio.html` resolves with **no worker change**. If we want the pretty URL `/vibe-studio`
(no `.html`), add one early route in `src/worker.ts` that serves the asset — to be confirmed
during implementation (prefer no worker change if the bare path resolves acceptably).

## Testing

- **Pure (vitest):** `randomHarmony` returns 3 distinct valid hexes and is deterministic per hue;
  `reflowDims` clamps both bounds; `classifyWord` maps injected lookup results to real/invented and
  short words to `tooShort`; `serializeDraft`/`restoreDraft` round-trip and tolerate partial/legacy
  input.
- **Browser-verified on local dev** (`npm run dev`, open `/vibe-studio`): change word/size → board
  reflows live; roll harmony / pick a swatch → whole page (aurora, title, sample row) re-lights via
  the locked contract; reload → draft restored; schedule seam visibly inert.
- No DO/server tests (no server change beyond a possible static route).

## Build order (hand to writing-plans)

1. Pure core (`vibe-studio-core.js`) + its tests — TDD.
2. Static shell (`vibe-studio.html`) with Glass-Aurora layout, header, board zone, tool rail,
   inert schedule bar; load `style.css` + `edition.js`.
3. `vibe-studio.js`: wire inputs → `vibe` object → re-render (board reflow, label, `applyColorScheme`
   via `colorSchemeVars`), draft save/restore, debounced badge.
4. Confirm `/vibe-studio` routing (bare path vs pretty route).
5. Browser verify on local dev; ship via `dev/ship.sh`.

## References

- Parent spec: `docs/superpowers/specs/2026-06-03-vibe-studio-design.md`
- Increment 2 contract: memory `vibe-studio-build-status.md`; `public/edition.js`
  (`colorSchemeVars`, `applyColorScheme`), `public/style.css` (`.daily-vibe-title`, `--a1/2/3`).
- Stage prototype (reference only; its rejected pills/sparkle-from-title/eyedropper do NOT apply):
  `docs/prototypes/vibe-studio/workshop.html`.
