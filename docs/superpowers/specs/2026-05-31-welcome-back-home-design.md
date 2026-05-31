# Welcome-back Home — Design Spec

**Date:** 2026-05-31
**Status:** Approved, ready for planning
**Scope:** Frontend only — `public/index.html`, `public/app.js`, `public/style.css`. No Durable Object or worker changes.

## Problem

A returning player who opens the app (e.g. a fresh browser, or just revisiting `wordul.com`) is met with a create-first home that defaults to spinning up a brand-new room. Their existing rooms and game history are reachable only via the profile page or saved URLs. The home should recognize them, surface their rooms, and make "jump back in" or "start fast" the obvious paths.

## Goals

- Recognize a returning user and greet them ("Welcome back, yan").
- Two clear, intentful primary actions: **Start playing** (instant solo) and **Invite friend** (multiplayer room with share link).
- A tappable list of the user's rooms, with a filter between *all rooms touched* and *rooms they created*.
- Ship without backend changes — reuse existing data.

## Non-goals (noted for later)

- Play vs AI / pre-trained bot.
- Live "game in progress" status badges on room rows.
- Tracking rooms a user joined but never finished a game in (accepted v1 gap — see Edge cases).

## Data sources (all existing)

`GET /api/user/:username` already returns the full `UserProfile`:

- `ownedRooms: { slug, name, lastPlayedAt }[]` — rooms the user created (most-recent-first, capped 100).
- `games: GameRecord[]` — finished games, most-recent-first, each with `{ roomPath, finishedAt, word, wordLength, result, guesses }`.

The rooms list is assembled **client-side** by merging these two sources. No new write paths, no DO/worker edits.

## Architecture

### One adaptive home screen

The existing `#tpl-home` template gains two states, chosen on render by whether a username is saved in `localStorage`:

- **Returning** (saved username): greeting "👋 Welcome back, `@username`" with a `not you? switch user` reset (reuses existing `switchUser` logic); the two CTAs; the rooms list below.
- **New** (no saved username): current tagline + username field + the two CTAs. CTAs validate/prompt for a username (≥3 chars, same rule as today) before acting. No rooms list (none exist yet).

A compact word-length selector sits with the CTAs, defaulting to `getPreferredLength()` (last-used, default 5), so solo games start at the right size. (Keeps the existing length-picker behavior, repositioned/condensed.)

### The two CTAs

- **▶ Start playing** — instant solo:
  1. Resolve username (validate if new user).
  2. `generateRoomCode()` → `slug`; `history.pushState('/@username/slug')`; `showRoom(username, slug)`.
  3. Set a `game.autoStart = true` flag before connecting.
  4. On the first `lobby`-phase snapshot, if `game.autoStart`, send `{ type: "start" }` once and clear the flag.
  5. Solo (1 player) → server starts the game immediately; board is ready, no lobby wait.
- **＋ Invite friend** — multiplayer:
  - Same create→navigate→`showRoom` flow as today's `createBtn`, with `autoStart` left off, landing in the lobby with the share/copy-link prominent (current lobby behavior).

Both actions create rooms under the user's namespace (`/@username/<slug>`), owned by them, which the server already registers into `ownedRooms` on owner join.

### Rooms list + filter

A segmented control toggles two views; each row is tappable to rejoin via `navigate('/@owner/slug')` (lands in whatever state the room is in — lobby, mid-game, or finished):

- **Recent** (default): all rooms the user has touched = `ownedRooms` ∪ rooms derived from `games[].roomPath`, deduped by full path, sorted by most-recent timestamp (`lastPlayedAt` for owned, `finishedAt` for history rows). This is "see all my games."
- **Yours**: only `ownedRooms`.

Row contents:
- **Name** — owned room's `name`, or for a history-only room, slug → Title Case ("crunchy-zebra" → "Crunchy Zebra").
- **Relative time** — "2m ago" / "1h ago" / "3d ago" from the row's timestamp.
- **Owner marker** — a subtle indicator when the room belongs to someone else (owner segment of the path ≠ current username).

All interpolated fields (room name, slug, owner, path) pass through `escapeHtml`, matching the existing XSS-safety convention in `profile.js`.

## Data flow

1. Home renders → if saved username, `fetch('/api/user/:username')`.
2. Build a unified room array: map `ownedRooms` to rows `{ path: '@user/slug', name, ts: lastPlayedAt, owned: true, mine: true }`; map `games` to rows `{ path: roomPath, name: titleCase(slug), ts: finishedAt, owned: false, mine: owner === username }`; dedupe by `path` (prefer the owned entry's name); sort by `ts` desc.
3. Apply the active filter (Recent = all; Yours = `owned === true`) and render rows.
4. Tap a row → `navigate(path)`.

## Error handling / edge cases

- **Empty list** (new user, or no owned rooms + no history): hide the list + filter; the CTAs carry the screen.
- **Profile fetch fails**: degrade silently to just greeting + CTAs (no error wall). Log to console only.
- **Joined-but-unfinished rooms**: not present in `games` history, so they won't list. Accepted v1 gap.
- **Username < 3 chars** on a CTA: same inline validation/toast as today's `createBtn`.
- **Duplicate room across sources**: deduped by path; owned name wins.

## Testing

- Manual (Playwright, source of truth) across: new user (no list), returning user with owned + history rooms, filter toggle Recent/Yours, Start playing → solo board with no lobby, Invite friend → lobby with share link, tapping a row rejoins the correct room, empty/failed-fetch degradation.
- No new pure-logic units that warrant vitest beyond a possible `titleCase`/`relativeTime`/room-merge helper — if extracted as pure functions, add small unit tests.
