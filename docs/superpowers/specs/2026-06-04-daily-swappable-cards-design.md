# Daily home: swappable player cards + solve duration

**Date:** 2026-06-04
**Status:** Design approved, pending spec review
**Surface:** Home page post-play daily card (`public/daily-card.js`) +
Today's stats page (`/daily/<date>/stats`, `public/app.js`)

## Problem

The post-play daily card shows a single hero — your own solved board — above the
"Today's Top" leaderboard. Asks:

**v1 (home card):**
1. **Add "time completed"** to a player's card (how long the solve took).
2. **Tap another player's leaderboard row to swap the featured card to theirs** —
   *except* tapping the `@username`, which still opens their profile.

**v2 (Today's stats page):**
3. **Show the full list of all players with their scores** on the Today's stats page —
   the page currently shows only anonymized aggregates and a literal
   `"Top-10 leaderboard coming soon"` placeholder (`app.js:910`). This delivers that.

## Decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Meaning of "time completed" | **Solve duration** — first guess → solving guess |
| What a swapped card shows | **Stat card + letterless color grid** |
| Return from a swapped card | **Tap your own row** (no × button, no auto-revert) |
| Missing duration | **Omit the chip**; a genuine 1-guess solve shows `<1s` |
| Stats-page full list rows (v2) | **Lean ranked list** — `rank · @name · gold · in N · duration`, tap name → profile, your row highlighted. No grids, no swap (scales to hundreds). |

## Shape

The post-play card gains a **featured card** region (today it is hard-wired to your
own board). It can render *any* player present in the leaderboard payload. Default =
you, rendered with your real letters. The "Today's Top" list stays below it.

```
┌─ daily-card (post-play) ──────────────┐
│  ┌─ FEATURED CARD ─────────────────┐  │   ← swappable
│  │  [color grid]                   │  │
│  │  caption / stat line            │  │
│  └─────────────────────────────────┘  │
│  TODAY'S TOP            34 played      │
│  ① @yup     128 🪙  in 4   2m 02s  ◄┐  │   ← tap row = swap featured
│  ② @bingo   127 🪙  in 4   3m 41s   │  │     (selected row gets is-selected)
│  ③ @zang    126 🪙  in 3   1m 58s   │  │
│  ─────────────────────────────────  │  │
│  #5 you (@meta) 122 🪙 in 4  2m 14s ◄┘  │   ← tapping this returns to your card
│  Next Wordul in 2h 5m                 │
│  Today's stats ›                      │
└───────────────────────────────────────┘
```

## Interaction

- Tap any leaderboard **row** → featured card swaps to that player; that row gets an
  `is-selected` state so the list and featured card read as linked.
- Tap the **`@username`** link inside a row → still calls `onProfile(name)`
  (navigates to `/@name`). The anchor `stopPropagation`s so it never triggers a swap.
- Tap your **own** row → featured card returns to you (your letters). This is the only
  "back" affordance — no × button, no auto-revert.
- On first render the featured card defaults to **you** and is `is-selected`.

## What each card shows

- **Your card (default):** color grid **with letters** (today's behavior) + caption
  `Solved in 4 · 2m 14s` (or `Missed today` when lost). Letters come from this
  browser's localStorage (`result.solveWords`), exactly as today.
- **Another player's card:** color grid **with NO letters** + a stat line
  `@name · #rank · 128 🪙 · in 4 · 2m 14s` and a won/lost treatment. Letters are never
  sent for anyone but the viewer.

Duration chip is **omitted** when `durationMs` is unknown; a sub-second solve renders
`<1s`.

## Data flow

### Duration capture (server)

`applyGuess` already computes `now = Date.now()` per guess (`room.ts:676`). Add two
per-player timestamps:

- `firstGuessAt` — stamped when the player's first guess lands (guesses 0 → 1).
- `finishedAt` — stamped `= now` when the player's status leaves `"playing"`
  (won or lost), inside the existing `priorStatus === "playing" && status !== "playing"`
  transition.

`durationMs = finishedAt − firstGuessAt`. This is the only honest per-player interval:
the daily is async with no per-player "start", so we measure guess-to-guess. (Measuring
from board-open was rejected — not tracked server-side, needs new client wiring.)

### Color grid (server)

`encodeSolveGrid(player.guesses)` already returns the `["gyxxg", …]` shape that
`renderStamp()` consumes, and is already stamped onto daily records (`room.ts:1147`).
Reuse it for the leaderboard payload. It is **letters-free by construction** (g/y/x only).

### Payload (`leaderboard-core.ts`)

Extend the decoupled shapes:

```ts
type RankablePlayer = { …existing…; grid?: string[]; durationMs?: number };
type LeaderEntry    = { username; gold; guesses; won; grid?: string[]; durationMs?: number };
```

`topDaily` carries `grid` and `durationMs` through into each `LeaderEntry` (top rows and
the `you` row). Every visible/swappable row therefore arrives with its grid + duration —
no extra fetches.

### Leaderboard handler (`room.ts` GET `/leaderboard`)

Map the new fields when building `RankablePlayer[]`:

```ts
grid: encodeSolveGrid(p.guesses),
durationMs: p.firstGuessAt != null && p.finishedAt != null
  ? Math.max(0, p.finishedAt - p.firstGuessAt)
  : undefined,
```

### Render (`public/daily-card.js`)

- New `renderFeaturedCard(entry, { isYou, yourWords })`:
  `renderStamp(entry.grid, isYou ? yourWords : undefined)` + caption/stat line + duration.
- `fmtDuration(ms)` helper: `<1s`, `47s`, `2m 14s`, `1h 3m`.
- Leaderboard rows become swap targets: the `<li>` gets a click handler that re-renders
  the featured card from the clicked entry; the inner `<a data-profile>` keeps its
  existing `preventDefault → onProfile` and adds `stopPropagation`.
- Your own duration fills in when the leaderboard resolves (the hero still renders
  instantly — same progressive-fill the gold value and "N played" count already use).

## v2 — Today's stats: full player roster

The stats page (`/daily/<date>/stats`) renders anonymized aggregates from the SCIENCE
DO (`/api/science/daily/<date>`) and ends with a `"Top-10 leaderboard coming soon"`
placeholder (`app.js:910`). v2 replaces that placeholder with the **full ranked roster**.

**Source split (important).** The roster comes from the **Room DO** leaderboard path —
*not* SCIENCE. SCIENCE stays strictly anonymized (`noUsernames: true`); named per-player
data already lives in the Room DO, which is the correct, already-public source for a
named leaderboard. The two never mix.

**New full-list query.** `topDaily` clamps `n` to 1–10, so it can't return everyone. Add
a sibling pure function:

```ts
// leaderboard-core.ts
export type RosterEntry = LeaderEntry & { rank: number };           // 1-based, lean (no grid)
export type FullLeaderboardView = { players: RosterEntry[]; youRank: number | null; total: number };
export function fullDaily(players: RankablePlayer[], username: string): FullLeaderboardView;
```

`fullDaily` runs the **same filter + sort** as `topDaily` (non-bot, confirmed mint;
gold desc → fewer guesses → username), then returns *every* ranked player with a rank,
plus the viewer's rank for highlighting. `durationMs` is included (cheap); **`grid` is
omitted** to keep a hundreds-of-players payload lean.

**Endpoint.** Extend the Room DO `GET /leaderboard` handler: when `?full=1`, return
`fullDaily(...)` instead of `topDaily(...)`. Map `durationMs` exactly as v1; skip `grid`.
Extend the worker route `/api/daily/<date>/leaderboard` (`worker.ts:73`) to forward a
`full=1` param (today it hardcodes `n=3`).

**Render (`public/app.js` `showDailyStats`).** After the aggregates render, fetch
`/api/daily/<date>/leaderboard?full=1&username=<me>` and render the roster where the
placeholder is. Each row: `rank · @name · gold · in N · duration`; `@name` → `onProfile`;
the viewer's row gets `is-you`. A pure `computeRosterView`/render helper lives alongside
`daily-stats.js`; `fmtDuration` is shared with the home card (exported from `daily-card.js`
or a tiny shared util — extracted once, used in both places).

**Empty / loading.** Mirror the aggregates' own loading + empty states: while the roster
fetch is in flight show nothing extra; if it returns `total: 0`, show a quiet
"No finishers yet today." line instead of an empty list.

## Files

| File | Change | Ver |
|---|---|---|
| `src/types.ts` | `PlayerState` += `firstGuessAt?: number`, `finishedAt?: number` | v1 |
| `src/room.ts` | `applyGuess`: stamp the two timestamps; `/leaderboard` handler: map `grid` + `durationMs`; `?full=1` → `fullDaily` (lean) | v1+v2 |
| `src/leaderboard-core.ts` | `RankablePlayer` + `LeaderEntry` += `grid?`, `durationMs?`; `topDaily` threads them; add `fullDaily` + `FullLeaderboardView`/`RosterEntry` | v1+v2 |
| `src/worker.ts` | `/api/daily/<date>/leaderboard` route: forward `full=1` param | v2 |
| `public/daily-card.js` | featured-card region + swap logic + `fmtDuration` (exported) + letterless render | v1 |
| `public/app.js` | `showDailyStats`: fetch full roster, render list in place of the "coming soon" placeholder | v2 |
| `public/daily-stats.js` | `computeRosterView` (pure) + lean row render helper | v2 |
| `public/style.css` | featured-card, `is-selected` row, swapped-card styles (v1); roster list rows (v2) | v1+v2 |
| `test/leaderboard-core.test.ts` | cover `grid` + `durationMs` passthrough; `fullDaily` ordering/rank/`youRank`/filtering | v1+v2 |

## Safety: no answer leak

- Other players' cards carry only `g/y/x` positions — **never letters**. This matches
  the existing record `solveGrid` and public Wordle-grid sharing culture.
- The viewer's own letters stay in their localStorage (`result.solveWords`); the
  leaderboard API never sends letters for anyone.
- The `/leaderboard` endpoint is already public and already filters out bots
  (`topDaily`). Adding letterless grids does not change the leak surface.
- **v2 roster:** exposes `username · gold · guesses · duration` for every ranked player —
  the same fields already public for the top rows, and usernames are already public
  (profiles at `/@name`, sitemap). `fullDaily` carries **no grid and no letters**, so the
  full roster adds zero answer-leak surface. The SCIENCE aggregates remain anonymized and
  untouched — the roster is a separate Room-DO read.

## Back-compat

- Players persisted before this change lack `firstGuessAt`/`finishedAt` → `durationMs`
  undefined → duration chip omitted. No migration needed.
- A player who solved in one guess has `firstGuessAt === finishedAt` → `durationMs ≈ 0`
  → rendered as `<1s`.

## Out of scope

- Per-player "board open" timing / true stopwatch from first paint.
- Showing cards for players outside the top N who aren't you (they aren't in the home-card payload).
- Any change to the play (pre-result) state of the card.
- **v2:** swap-to-card / letterless grids on the stats-page roster (it's a lean ranked
  list); pagination/infinite-scroll of the roster (render the full list; revisit only if a
  day's count makes the payload genuinely heavy).
