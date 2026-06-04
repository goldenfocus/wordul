# Arena end-screen actions — design

**Date:** 2026-06-03
**Status:** approved (brainstorm) → implementation

## Problem

After an Arena game, the end-game stats modal offers only **Challenge a friend** and
**Play again**. "Play again" is really the same-opponent **rematch** handshake: it proposes
to that specific opponent and morphs into "Waiting for {opponent}… ✕". Against a random or
absent human, the player gets **stuck waiting** with no one-tap way to move on to another
game — unlike chess.com, where "New game" drops you into the next available opponent.

## Goal

For **Arena games only**, replace the two-button end screen with a focused set of "keep
playing the Arena" actions so the player is never stranded, while keeping rematch available
for those who want it.

## Scope / trigger

- Applies **only to Arena games** — games the player reached *through the Arena*: by tapping
  an open-games row (`showArena` → `onJoin`) or by hosting a public game
  (`enterNewRoom({ publicArena: true })`).
- Friend / daily / private rooms keep today's end screen unchanged.
- The server strips `seed` from outbound snapshots, so the client cannot detect a seeded bot
  room from the wire. Arena-origin is therefore recorded **at entry**, client-side:
  - A module-level pending flag is set right before navigating into the room (row tap) or in
    the public-host path, consumed by `showRoom` into `game.fromArena`.
  - Also stashed in `sessionStorage` under `arena:<roomPath>` so a **mid-game refresh**
    (which reloads the page and loses the in-memory flag) still resolves to the Arena end
    screen. Cleared when leaving to the hub.

## The end screen (when `game.fromArena`)

Five actions, replacing the default Challenge/Play-again pair:

```
[ Join next game → ]      ← primary
[ Rematch ]
[ Create your own game ]
[ Main menu ]
[ Challenge a friend ]
```

- **Join next game →** — `GET /api/arena/open`, pick the first waiting game that is **not the
  room just played**, and `navigate(routePath)`. If none are waiting, fall back to the Arena
  list view (`showArena()`) so the player can host or wait.
- **Rematch** — the existing propose→accept/decline handshake, unchanged. It may still show
  "Waiting for {opponent}… ✕", **but** the other four actions remain tappable throughout, so
  the player can bail to a fresh game or home in one tap. This is the core fix for "stuck".
- **Create your own game** — leave the current room and host a new public Arena room
  (`enterNewRoom({ publicArena: true })`), listed in the open-games index for others to join.
- **Main menu** — close the modal, leave the room, return to the home hub.
- **Challenge a friend** — the existing challenge-link action, retained.

The non-Arena end screen (friend/daily) is untouched: Challenge a friend + Play again/rematch.

## Components

- **`public/arena-panel.js`** — add a pure helper `pickNextGame(games, currentRoutePath)`:
  returns the first game whose `routePath !== currentRoutePath`, else `null`. Unit-tested.
- **`public/app.js`**
  - arena-origin tracking: pending flag + `sessionStorage`, consumed by `showRoom` into
    `game.fromArena`; set on arena row-join and public-host.
  - `joinNextArena()` — fetch open games, `pickNextGame`, navigate or fall back to `showArena()`.
  - `hostPublicArena()` — leave current room, `enterNewRoom({ publicArena: true })`.
  - `backToMenu()` — `closeStats(); leaveRoom(); showHub()`.
  - end-screen renderer: when `game.fromArena` and just finished, render the 5 Arena actions
    (reusing the existing rematch handshake renderers for the Rematch button); else current behavior.
- **`public/index.html`** — an Arena-actions container in `#statsModal` (or reuse the actions
  row), shown/hidden based on `game.fromArena`.
- **`public/locales/en.js`** — new keys: `endscreen.joinNext`, `endscreen.rematch`,
  `endscreen.createGame`, `endscreen.mainMenu` (Challenge-a-friend key already exists).
- **`public/style.css`** — minor: stack/spacing for the Arena action list if needed.

## Data flow

1. Player taps an open-games row in `showArena` → set pending arena-origin → `navigate(routePath)`.
2. `route()` → `showRoom` resets game state, then sets `game.fromArena` from the pending
   flag / `sessionStorage`.
3. Game finishes → stats modal opens; renderer sees `game.fromArena` → renders 5 Arena actions.
4. **Join next** → `/api/arena/open` → `pickNextGame(games, currentRoutePath)` → navigate, or
   `showArena()` if none.
5. **Rematch** unchanged; sibling actions stay live so the player is never stuck.

## Testing

- `test/arena-panel.test.js`: `pickNextGame` — excludes the current room, returns first
  remaining, returns `null` when the only/empty options leave nothing joinable.
- Existing suite stays green; typecheck clean.

## Out of scope

- No server changes (the open-games index + `/publish` already exist).
- No matchmaking/skill logic — "next" is simply the first waiting game that isn't the current one.
- No new persistence beyond the `sessionStorage` arena-origin marker.
