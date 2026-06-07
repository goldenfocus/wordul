# Daily recap convergence — one constant "after the word" experience

**Date:** 2026-06-07 · **Branch:** `daily-recap-rows` · **Status:** approved by Yan

## Problem

Two surfaces show the same day with different vocabularies:

- The **post-finish golden card** (`public/daily-lb.js`) — the good one: ✗ cross for
  ran-out, 💀 skull for gave-up, no inline time, tap a row → auto-playing replay modal.
- The **day Stats page** (`showDailyStats` / `renderDailyRoster` in `public/app.js`) —
  the stale one: literal "missed" for both fail modes, `you (@name)` prefix, inline
  duration that breaks the row on narrow screens, rows not tappable, no share.

The data for replays is **already in the Stats page payload** (`grid` for everyone;
`words`/`word` only with the finisher token) — `computeRosterView` just drops it.

## Goal

After the word, the player should always land in the same elegant recap: who else
played, how they ranked, where I stand, every board replayable, the word's wiki —
and a frictionless way to share / pull a friend in.

## Design

1. **Shared row renderer.** Move `rosterRow` from `daily-lb.js` into `daily-card.js`
   (already the shared module). Row = medal/`#N` · `@name` · gold🪙 · result
   (`in 5` / ✗ / 💀). The `you (@name)` prefix dies everywhere: your row keeps the
   `is-you` outline and the name gets bold + accent via CSS. **No inline time** —
   the row can never wrap again.
2. **Tap-to-replay on the Stats page.** Export the replay wiring from `daily-lb.js`
   (`openReplayModal` + a `wireReplayRows(root, entries)` helper) and use it for the
   Stats roster. Colors-only replay for non-finishers; real letters stay
   server-gated behind the finisher token (existing contract, untouched).
3. **Time moves into the replay modal head**: `@remy · 325🪙 · in 5 · 1m 20s`
   (or 💀/✗ + duration for fails). `durationMs` is already on every entry.
4. **`computeRosterView` keeps** `resigned`, `grid`, `words`, `durationMs`.
5. **Footer actions on the Stats page**: `Share` · `Home` (lab link stays).
   Share = native sheet / clipboard fallback (existing `shareDailyResult` pattern):
   rank-aware spoiler-free line for finishers ("#2 on today's Wordul — 281 gold in
   5. Your turn:"), generic invite line otherwise. Links to the play URL, never the
   stats (no spoiler leak).
6. **Close the loop**: golden card gains a "Full day recap →" link to the Stats
   page, making post-finish → recap one continuous surface.

Out of scope: changing the leaderboard API, the wiki reveal (shipped 2:21am,
finisher-gated), any lobby-v2 work (active in another tab).

## Testing

- Vitest: row renderer (fail glyphs, no-prefix self row), `computeRosterView`
  passthrough, share-line builder. Existing daily-lb/daily-card suites updated.
- Manual: dev server screenshot of the Stats page, replay modal open, narrow width.
