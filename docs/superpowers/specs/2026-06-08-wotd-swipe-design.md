# Swipe to previous WOTD — design

**Date:** 2026-06-08
**Branch:** `wotd-swipe`
**Status:** approved design, pre-implementation

## Problem

There is no discoverable way from the home hub to browse past words of the day. A
`/daily/archive` list page exists (a bare list of date links), but it is reachable only via a
text link buried in the post-play daily-result panel. Yan expected to **left-swipe the home
daily card** to flip back through previous dailies. That gesture was never built.

## Goal

Turn the home daily card into a **horizontal carousel of days**: swipe / arrow back through
every past daily to today's day-one, each past day showing the answer, that day's global
stats, and — if you played it — your solve stamp and a "watch replay".

## Scope (locked decisions)

- **Past-day card shows:** date + theme, the revealed answer, that day's global stats
  (players · win% · guess distribution), and — only if you played that day — your solve
  stamp + result line + a **Watch replay** button.
- **Didn't play that day:** answer + global stats still shown, plus a **Play it →** link to
  `/daily/<date>`.
- **Replay = watch my replay** of how I actually solved it (reuses the existing finished-game
  replay path), not a fresh playable board.
- **Navigation:** left-swipe (touch) **and** `‹ ›` arrows (pointer), one day per step, snap-back
  carousel feel. Forward clamps at today (no future); back goes **all the way to day one**.
- **History depth:** no cap — lazy per-day fetch keeps home-load cost at zero.

### Out of scope (YAGNI)

- Re-playing a past word for score/practice (a separate, larger feature: scoring rules,
  anti-cheat, gold/streak guardrails).
- Changing the existing `/daily/archive` list page (it stays as the deep-history fallback).
- Any new text input (so the iOS <16px input-zoom trap is not in play).

## Architecture

### Data sources (reuse first)

| Need | Source | New? |
|------|--------|------|
| How far back the carousel goes | `GET /api/daily/dates` → `{ dates: string[] }` | existing |
| My result + my replay for a day | `profile.games` filtered by `roomPath === "daily/<date>"` (already in memory after login; `GameRecord` keeps `solveGrid`, `words`, `guessAts` for past games via `toPublicGame`) | existing |
| That day's global stats (players, win%, distribution) | `GET /api/science/daily/<date>` (the same source the `/daily/<date>/stats` page already renders) | existing |
| **The answer word + theme for a past day** | **`GET /api/daily/word?date=<d>` → `{ date, word, themeId }`** | **NEW** |

The only new server surface is the past-word route. "Word + global stats" on the card is
achieved by the new word route **plus** the existing science-stats route — not one fat new
endpoint — so the card's numbers match the stats page exactly.

### New endpoint: `GET /api/daily/word?date=<YYYY-MM-DD>`

- Returns `{ date, word, themeId }` for the given day.
- **Past-only guard:** if `date >= todayUTC()`, respond `404`/`{}` — today's and future
  answers must never leak (same rule as `/resolve`, which is server-only).
- Implementation: routed in `src/worker.ts` to the Daily DO; the DO resolves the curated/seeded
  word for that date (reusing the existing `/resolve` logic, which already folds `DAILY_SALT`)
  and returns it plus the day's `themeId` (from `dayTheme`/rotation).
- Cheap and cacheable (a past day's word never changes).

### Client: the daily-card carousel

State lives in the hub/daily-card controller:

- `dayOffset: number` — `0` = today, negative = days back.
- `dates: string[]` — fetched once from `/api/daily/dates`; bounds how far back `dayOffset` can go.
- Per-day caches (keyed by date): `wordCache`, `statsCache` — lazy-filled on landing, never refetched.

**Render dispatch:**

- `dayOffset === 0` → existing today card (play / result / countdown). **Unchanged.**
- `dayOffset < 0` → `renderPastDailyCard(date, word, themeId, myRecord, stats)` (new pure render).

**Navigation controls:**

- `‹` / `›` arrow buttons flanking the date header; `‹` decrements offset (older), `›` increments
  (newer), `›` disabled/hidden at offset 0.
- Touch swipe on the card region: horizontal drag → step one day. Implemented with the same
  scroll-snap idiom already used by the Worlds strip, **scoped to the card** so it does not fight
  the Worlds-strip carousel below it.
- Clamp: offset ∈ `[-(dates.length-1), 0]`.

**Lazy load on landing:** when `dayOffset` changes to a past day, fire (if not cached) the
`/api/daily/word?date=` and `/api/science/daily/<date>` fetches, show a light skeleton, then
render. `myRecord` needs no fetch (already in `profile.games`).

### New render: `renderPastDailyCard(date, word, themeId, myRecord, stats)`

Pure function, mirrors the existing solve-stamp render (`app.js:330–340`,
`captureDailySolve`). Produces:

```
   ‹   <shortDate> · <themeName>   ›
   ┌──────────────────────────────┐
   │  <solve stamp: colors + letters>   │   ← only if myRecord present
   │                         <N>/6 │
   └──────────────────────────────┘
   Answer:  <WORD>
   <players> played · <winRate>% solved          ← from stats
   [ ▶ Watch replay ]                              ← only if myRecord present
   ▸ stats   ▸ word wiki
```

- **Played (`myRecord` present):** solve stamp from `myRecord.solveGrid`/`words`, result line,
  **Watch replay** button.
- **Not played:** omit stamp + result + replay; show **Play it →** (`navigate("/daily/<date>")`).
- **Answer** always shown.
- Tap-throughs: `▸ stats` → `/daily/<date>/stats`; `▸ word wiki` → `/word/<word>`.

### Watch replay

Reuses the existing finished-game replay machinery (`ghost-replay.js` + the solve-stamp /
replay path shipped for finished games). The static solve stamp is already a solved-for render;
the **animated** on-demand replay viewer is the one piece to confirm is callable from a past
`GameRecord` (`solveGrid` + `words` + `guessAts`) during planning. If a clean on-demand launch
hook does not already exist, the fallback for v1 is the static solve stamp (still shows the full
solved board) with the animated replay wired in as a fast follow — **to be decided in the plan
after reading the replay launch path**, not silently dropped.

## Files touched

- `src/worker.ts` — add `/api/daily/word` route → Daily DO.
- `src/daily.ts` — add `/word` handler on the Daily DO (past-only guard; reuse resolve + theme).
- `public/hub.js` — wrap the daily card in the carousel controller (offset state, arrows, swipe).
- `public/daily-card.js` — `renderPastDailyCard` + dispatch by offset; wire arrows/swipe/replay.
- `public/style.css` — past-card + arrow + swipe-snap styles (scoped above the Worlds strip).
- i18n: any new user-facing strings (`daily.answer`, `daily.played`, `daily.didntPlay`,
  `daily.watchReplay`, `daily.playIt`, arrow aria-labels) added to **all** locales in one pass.

## Testing

- **Unit (vitest):** `/api/daily/word` returns word+theme for a past date; **refuses** today and
  future dates (the leak guard). Offset clamping logic (`[-(n-1), 0]`). `renderPastDailyCard`
  played vs not-played branches.
- **Guard:** existing `test/ios-input-zoom.test.ts` stays green (no new inputs).
- **Manual on prod (bot-named, per CLAUDE.md browser rule):** swipe + arrows step days; answer +
  stats render; a day I played shows my stamp + replay; a day I didn't shows Play it; forward
  clamps at today; can't reach a future word.

## Risks / guardrails

- **Answer leak:** the new endpoint MUST hard-refuse `date >= today`. Covered by a unit test.
- **Gesture conflict:** swipe scoped to the card so the Worlds-strip carousel still scrolls.
- **Stats consistency:** card reuses `/api/science/daily/<date>`, so numbers match the stats page.
- **Deploy:** ship via `dev/ship.sh` / `/push` only; CI deploys `origin/main`. No `wrangler deploy` by hand.
