# Clickable Solve-Stamp Replay — Design

**Date:** 2026-06-06 · **Status:** Approved by Yan (approach A)

## What

Every solve stamp (the mini tile-grid + "Solved in 3 · 15s" card rendered by
`renderStamp()` in `public/daily-card.js`) becomes clickable. Clicking plays a
**condensed cinematic replay** in place: the stamp's tiles empty, then each guess
row types in letter-by-letter and flips to its colors, row after row, at a fixed
snappy cadence. Total runtime ≤ ~8s regardless of how long the real solve took.

## Where (all stamp render sites)

| Surface | Render site | Letters available? |
|---|---|---|
| Home — own daily recap | `renderDailyCard()` `daily-card.js:203` | Yes (`wr.dailySolve` local) |
| Home — featured leaderboard card (other players) | `renderFeaturedCard()` `daily-card.js:93` | No for today's live daily (anti-spoiler strip) → colors-only replay; yes after rollover |
| Profile — Recent games | `renderRecentGame()` `public/profile.js:147` | When record has `words` |

## How

### New module: `public/stamp-replay.js`

```js
playStampReplay(stampEl, grid, words?) -> { finish() }   // snap to final state
```

- Pure DOM animation on the existing `.stamp-row` / `.stamp-cell` markup — no
  dependency on the ghost-tape engine (its exact-timing value is unused under a
  fixed cadence; it is welded to the live board's `snapshot.players`/`render()`).
- Sequence per guess row: type letters one-by-one (~90ms/cell; phase skipped
  entirely when no `words`), then staggered flip to color classes (~70ms/cell
  stagger), ~450ms beat, next row. Empty pad rows untouched.
- **Scheduling logic is a pure function** (grid + words → ordered step list with
  offsets) so it is unit-testable without DOM/timers; a thin driver applies
  steps via `setTimeout`.

### Wiring

- `renderStamp()` callers attach one click handler on `.daily-stamp`
  (`cursor:pointer`, `role="button"`, `aria-label="Play replay"`).
- Per-stamp state machine: **idle → playing → done.**
  - Click while *playing* → `finish()` (snap to final board, no janky restart).
  - Click while *done/idle* → (re)play.
- Featured-card swaps (leaderboard row taps re-render the stamp) naturally reset
  state because the DOM is rebuilt.

### Data

**No storage or server changes.** Fixed cadence means `guessAts` is not needed;
every render site already holds `grid` (color rows) and optionally `words`.

### Accessibility / motion

- `prefers-reduced-motion: reduce` → clicking does an instant reveal (no animation).
- No text inputs touched → iOS input-zoom guard unaffected.

## Testing

- Vitest on the pure step-scheduler: given a 3-row grid + words, asserts step
  order (type→flip per row), per-step offsets, colors-only path (no type steps),
  and total duration cap.
- Manual: home recap, featured card (other player, colors-only), profile recent
  game; click-during-play snaps to final; replay on second click.

## Out of scope

- Real-time / hybrid pacing (rejected in brainstorm — condensed chosen).
- Full-screen replay overlay.
- Share-card (canvas PNG) animation.
