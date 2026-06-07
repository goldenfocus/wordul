# Swipe time-travel — hidden swipe-left to previous dailies

**Date:** 2026-06-07 · **Status:** approved design · **Ships:** second (after the real-solve replay recorder, so past days have tapes accruing by the time browsing them gets easy)

Companion spec: [2026-06-07-real-solve-replay-design.md](2026-06-07-real-solve-replay-design.md)

## Goal

Swipe left on the home daily card and yesterday's daily slides in — leaderboard, replays,
and a prompt to play it if you haven't. Keep swiping back to day one. Completely
unadvertised on touch (finding it is the delight); desktop gets a subtle hover affordance.
The gesture ships as a reusable primitive so other surfaces can adopt the same UX later.

## Decisions (locked with Yan)

| Question | Decision |
|---|---|
| Depth | All the way back to the first daily, lazy-loaded day by day |
| Discoverability | Truly hidden on touch (no hint); desktop shows subtle chevron arrows on hover + ←/→ keys; mouse drag mirrors the swipe |
| Economy | Past days mint **score gold only** — no flat daily bonus, no speed bonus (today stays the main event; archive can't be farmed at full rate) |
| Architecture | Custom reusable `swipe-pager.js` primitive (approach A), not CSS scroll-snap, not page navigation |

## Existing infrastructure this rides on (verified)

- `/daily/<date>` permalinks already serve any date ≤ today (`src/worker.ts:537`).
- Rooms seed on demand for any non-future date (`seedDailyIfNeeded`, `src/room.ts:662`).
- Per-date leaderboards: `GET /api/daily/<date>/leaderboard` (`src/worker.ts:263`).
- All dates: `GET /api/daily/dates` (`src/worker.ts:544`).
- Join flow: `/ws?room=daily/<date>` (`public/app.js:376`) — same path permalinks use.

The feature is a navigation layer plus one scoring change; no new storage.

## Components

### 1. `public/swipe-pager.js` (new, reusable primitive)
```js
createSwipePager(el, {
  render(offset) {},      // build/refresh the card for page `offset` (0 = current)
  canGo(offset) {},       // false = rubber-band (e.g. offset > 0, or past the first daily)
  onSettle(offset) {},    // page committed — fetch data, preload neighbor
})
```
- Pointer events only (works for touch + mouse). Claims the gesture solely on horizontal
  intent: |dx| > |dy| and dx > 10px — otherwise vertical page scroll wins untouched.
- Card follows the pointer via `transform`; release commits on **30% width threshold OR a
  velocity flick**, else snaps back. Rubber-band resistance at edges (`canGo` false).
- Desktop affordance: subtle chevron arrows fade in on `:hover` (pointer-fine media query
  — never rendered on touch). `←`/`→` keys work when the pager has focus.
- No dots, no scrollbars, no hints on touch. The module is generic — daily card is its
  first consumer; any card can adopt it later.

### 2. Daily card integration (`public/daily-card.js`)
- The home daily card mounts inside a pager. Offset 0 renders exactly today's card
  (zero visual change until you swipe).
- Offset −n maps to real archive dates: `GET /api/daily/dates` fetched once and cached
  for the session; each settle lazy-fetches that day's leaderboard and **preloads one
  neighbor** so the next swipe lands instantly.
- A past-day card shows: date header ("Friday, June 5"), your stamp if you played that
  day (profile lookup by `roomPath === "daily/<date>"`, same as `dailyResultFor`),
  the leaderboard (colors-only unless you hold that day's finisher token), and —
  when unplayed — a **"Play this Wordle"** CTA into the existing
  `/ws?room=daily/<date>` join flow.
- Replay rows work exactly as on today's card, including "▶ watch the real solve" when
  a tape exists (companion spec).

### 3. Reduced past-day mint (`src/room.ts`, `scorePlayer()`)
- If the room's date ≠ the Daily DO's active date at scoring time: mint **score-based
  gold only** — skip the flat daily bonus and the speed bonus.
- Server-side only; the client settle receipt already drives the supernova display, so
  the smaller receipt renders correctly with no client change.

## Error handling

- Dates list fetch fails → swipe rubber-bands as if today were the first day (silent).
- A past day's leaderboard fetch fails → card shows the date + "Play this Wordle" CTA
  (playable even when the leaderboard is unavailable).
- Gesture must never hijack vertical scrolling: intent detection errs vertical.
- Mid-animation swipes queue at most one step (no skipping days with a mega-flick in v1).

## Testing (vitest)

- Pager core math extracted pure (like `stamp-replay-core`): intent detection,
  threshold/velocity commit decision, rubber-band clamping, queued-step logic.
- Date-walk logic: offset → date mapping, edge at first daily, neighbor preload choice.
- `scorePlayer`: past-date scoring mints score gold only (no flat daily, no speed bonus);
  active-date scoring unchanged.

## Out of scope (deliberate)

- Adopting the pager on other surfaces (Worlds, Arena cards) — the primitive is built
  for it, but v1 wires only the daily card.
- Any onboarding/tutorial for the gesture — hidden is the point.
- Catch-up streak mechanics or badges for filling in missed days.
- Multi-day jump gestures (mega-flick) — one day per swipe in v1.
