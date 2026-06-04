# Home Hub — Phase A: shell + nav + The Daily (design)

**Date:** 2026-06-02
**Status:** Design — awaiting review
**Visual north star:** the live prototype at https://wordul.com/designs/hub-the-daily (and the sibling concepts hub-the-arena / hub-the-floor / hub-the-feed for the later phases).

## Problem

The current home is a plain form (username · Start playing · Invite friend · word length · a recent-rooms list). It has no sense of place — making a new account effectively drops you toward a game with nothing to explore, no reason to return, and no surface for the theme/economy/social ideas we now have. We want the home to be **the best place to be in the whole app**: a vibrant hub you land in, not a form you pass through.

## Vision (all four souls, phased)

A **persistent shell + four destinations**, each owning exactly one job so nothing clogs:

- 🗞️ **The Daily** — home base / landing. Theme-of-the-day, your streak + gold, a clear Play CTA. The warm daily front door.
- ⚡ **The Arena** — live/joinable games + leaderboard energy. *(later phase)*
- 🃏 **The Floor** — buy-in stake tables / freeze-out; the home for the gold economy. *(later phase)*
- 👥 **The Feed** — friends' activity + challenges. *(later phase)*

You land on **The Daily**; the other three are one smooth tap away via a persistent nav. **This spec is Phase A only:** the shell, the nav, and a fully-built **The Daily**. Arena/Floor/Feed ship as real, navigable tabs with honest "coming soon" panels, filled in by later specs.

## Goals (Phase A)

- Replace the plain-form home with a **hub shell**: a persistent identity bar (avatar/settings hub · ◆ Gold · 🔥 streak) + a bottom nav (Daily / Arena / Floor / Feed) + a content area that swaps **client-side, no reload**.
- Build **The Daily** landing in full, using only data we already have.
- **End "dropped into a game":** after username entry you land on The Daily; Play is a deliberate tap, not an auto-start.
- Keep it **buttery smooth**: the shell never re-renders; tab switches are instant; reduced-motion safe.

## Non-goals (Phase A)

- Arena/Floor/Feed *content* (live-games feed, buy-in tables, friend activity). They are navigable stubs only.
- Any new server endpoint, friend graph, or buy-in logic.
- A second persisted "streak" notion — reuse `stats.currentStreak`.

## Architecture

### The shell (`public/hub.js`, new)

`app.js` is already large; the hub gets its own module to keep responsibilities clean.

- `renderHub(activeTab)` mounts the shell: identity bar + content area + bottom nav, and renders the active tab's panel. Default `activeTab = "daily"`.
- The shell (identity bar + nav) renders once; switching tabs only swaps the **content area** (`#hubContent.innerHTML`), so the bar/nav never flicker. Tab state lives in a module variable; no URL change required for Phase A (optional `#daily` hash is a nice-to-have, not required).
- Identity bar: reuse the existing avatar-as-settings-hub (`showHub`/openHub) on the left; ◆ Gold and 🔥 streak chips on the right. Gold/streak come from the profile (below).

### Data (all existing — no new endpoints)

Fetched once on hub mount via `GET /api/user/<username>` (already returns `gold`, `stats`):
- **Gold:** `profile.gold` (server-authoritative ledger balance, shipped).
- **Streak:** `profile.stats.currentStreak`; also have `bestStreak`, `wins`, `gamesPlayed` for secondary stats.
- **Recent rooms:** the existing room-list data the current home already renders.
- **Editions:** `EDITIONS` from `/editions/index.js` (for theme-of-the-day + the active theme).

A new user (no username yet) sees the username field first (existing `homeIntro`); on submit, they land on the hub.

### The Daily panel (`renderDaily()` in `hub.js`)

Built to mirror the prototype, using real data:

1. **Theme-of-the-day hero.** A deterministic featured edition chosen by calendar day (see `dayTheme` below). Shows the edition name + a one-line flavor + a **primary "Play today's word"** CTA. Tapping the hero (or the CTA) applies that edition (`applyEdition`) and starts a solo game via the existing play flow.
2. **Identity row.** Avatar/initial · `@username` · ◆ Gold (gentle count-up on first mount) · 🔥 `currentStreak`. (Mirrors the bar; the hero area gives it presence.)
3. **Recent rooms strip.** Reuse the existing room-list render (Recent), tappable to rejoin.
4. **Challenges teaser.** Static, honest cards hinting at later modes ("Speed Round", "6-Letter Friday") — visually present, marked "soon", not yet wired (those are Arena/Floor territory).
5. **Companion quip.** A line from the active edition's `companion.lines.idle` for personality.
6. **(Optional) mini playable board.** A 5-tile row you can type into as a teaser, exactly like the prototype. Marked optional — include if cheap; the Play CTA is the required path.

### `dayTheme` — deterministic theme-of-the-day (pure, testable)

In `hub.js` (or a tiny `public/daily.js`):

```js
// Deterministic featured edition for a given date: rotates through the non-default
// editions so every day has a "theme of the day" without any server. Same date ->
// same theme for everyone.
export function dayTheme(date, editionIds) {
  const pool = editionIds.filter((id) => id !== "default"); // default is the everyday baseline
  if (pool.length === 0) return "default";
  const dayNumber = Math.floor(date.getTime() / 86400000); // days since epoch (UTC)
  return pool[dayNumber % pool.length];
}
```

(Pass `EDITIONS.map(e => e.id)` and `new Date()`. Excluding `default` keeps the feature special; tunable.)

### The other three tabs (Phase A = honest stubs)

Each renders a small, on-brand "coming soon" panel with a one-line teaser of its soul (so the nav is real and the hub feels whole, never half-built):
- **Arena:** "Live games to join — coming soon." (Phase B: reuse the room directory for a live list.)
- **Floor:** show the ◆ Gold bankroll + "Stake tables & buy-ins — coming soon." (Phase C: the economy sink.)
- **Feed:** "Your friends' games — coming soon. + Invite friends." (Invite reuses the existing invite/share path; activity is Phase D.)

### Navigation

A bottom nav bar (mobile-first; a segmented control on wide screens via CSS) with the four destinations + icons. Active tab highlighted. Tapping swaps `#hubContent` only. Keyboard/focus accessible. Reduced-motion safe (no transition when the user opts out).

## Flow changes

- `showHome()` becomes `showHub()` (or `showHome` renders the hub): mount the shell, default to The Daily.
- New user: username field first → on submit, render the hub.
- "Play today's word" / a Quick-Play action calls the existing room-create+start flow. The key change is that **landing ≠ auto-started game**; play is an explicit tap from the hub.
- Existing entry points (deep link to a room, invite link) are unchanged — they still go straight to the room.

## Files

- **Create** `public/hub.js` — the shell, nav, tab switching, `renderDaily`, stub panels, `dayTheme`. One responsibility: the hub UI.
- **Create** `test/daily.test.js` — unit tests for `dayTheme` (determinism + rotation + default-excluded + empty-pool).
- **Modify** `public/index.html` — replace/extend `tpl-home` with the hub shell markup (identity bar, `#hubContent`, bottom nav). Keep the username field for new users.
- **Modify** `public/app.js` — route home → `renderHub`; wire Play CTA to the existing create+start; hand the recent-rooms render + invite into the Daily/Feed panels; remove the old plain-form home wiring it replaces.
- **Modify** `public/style.css` — hub shell, identity bar, bottom nav, Daily hero/cards, coming-soon panels. Mobile-first; reduced-motion safe.

## Testing

- **Unit (`test/daily.test.js`):** `dayTheme` is deterministic for a fixed date, rotates across days, never returns `default` when other editions exist, returns `"default"` for an empty pool.
- **Manual (browser, against `wrangler dev`):** new username → lands on The Daily (not a game); ◆ Gold + 🔥 streak show real profile values; theme-of-the-day matches `dayTheme(today)`; tapping Play starts a game in that theme; bottom nav switches Daily/Arena/Floor/Feed instantly with the bar fixed; recent rooms rejoin; reduced-motion disables transitions. Compare against the prototype at /designs/hub-the-daily.

## Open tuning (not blockers)

- Whether theme-of-the-day excludes `default` (recommended) or includes it.
- Whether to ship the optional mini playable board in Phase A.
- Icon set + exact nav labels.

## Future phases (separate specs)

- **Phase B — The Arena:** live/joinable games from the room directory + leaderboard.
- **Phase C — The Floor:** buy-in stake tables / freeze-out on the economy ledger (the gold sink).
- **Phase D — The Feed:** friends' activity + challenges (needs a friend graph + activity feed).
