# Challenge lobby — compact layout, host model, ready check

**Date:** 2026-06-06 · **Status:** approved by Yan (design conversation) · **Branch:** `lobby-host`

## Problem

The invite/challenge lobby (single-row board teaser, 5×6 dimension control, 1/8 seat
strip) has two issues:

1. **Big dead gap** — `renderBoards()` draws only one row in the lobby, but the grid
   still reserves all `--rows` tracks (so the start-of-game "bloom" expands to the right
   height). Five empty full-height rows render as dead space between the teaser row and
   the 5×6 control (`public/style.css` `.grid` `grid-template-rows: repeat(var(--rows), 1fr)`).
2. **Shared settings confuse guests** — anyone in the room can change letters/rows
   (`set_length`/`set_rows` in `src/room.ts` have no privilege check) and anyone can
   start the game. Guests shouldn't be presented with the host's controls.

## Decisions (locked with Yan)

- Lobby keeps the **single-row teaser**; the phantom rows are collapsed (no full board).
- **Host = room owner, with succession**: if the host disconnects, hostship passes to the
  longest-present connected human. The original host does **not** reclaim on return.
- **Guests can still change settings, but buried**: the in-lobby 5×6 control is read-only
  for guests; Settings → Room keeps letters/rows steppers for everyone. The server stays
  permissive for `set_length`/`set_rows`.
- **Start is host-only and server-enforced**, gated on a new **ready check**: all
  connected human guests must be ready.

## 1. Compact lobby layout (client)

- In lobby (`phase === "lobby"`), `renderBoards()` sets `--rows: 1` on the grid/board
  instead of the real row count. The 5×6 control, seat strip, and Setup·Invite pair rise
  into a tight stack under the teaser row.
- At game start, `--rows` flips to the real count and the existing `.blooming` animation
  expands the board — same effect, starting from a compact lobby instead of a
  pre-reserved hole. Verify the bloom still measures correctly now that the lobby grid
  is 1 track tall (it may need to set `--rows` before the bloom class, in the same frame).

## 2. Host model (server, `src/room.ts`)

- New `hostId: string | null` in persisted room state; included in every snapshot
  (clients derive `isHost = snap.hostId === myId`).
- **Assignment**: owner becomes host when they first join. If the owner never connects,
  the first human to join becomes host. Bots are never host. Daily rooms unaffected
  (no lobby settings there).
- **Succession**: when the host's last socket closes (`webSocketClose`), host passes to
  the longest-present *connected* human (roster join order). Push a system line
  ("<name> is now the host"). If no humans remain connected, `hostId` clears; the next
  human to connect becomes host.
- **No reclaim**: a returning original owner joins as guest; current host keeps it.

## 3. Settings gating (client-only)

- **Host**: current tappable 5×6 popover with letters/rows steppers, unchanged.
- **Guest**: 5×6 renders as a read-only label (existing `.locked` styling; no popover).
- **Buried path**: Settings → Room section (already room-gated in `public/settings.js`)
  keeps the letters control and gains a rows stepper — available to everyone.
- Server keeps accepting `set_length`/`set_rows` from anyone (no enforcement; older
  clients keep working). Rename/rematch stay shared as today.

## 4. Ready check + host-only start (server-enforced)

- New `ready: boolean` per player, new `set_ready` WS message (lobby-phase only).
- **Guests** see a **Ready** toggle where the Start button used to be. Ready state shows
  on the seat strip (e.g. filled vs hollow seat). Ready persists across settings changes
  (changing letters/rows does *not* un-ready anyone).
- **Host** sees Start, enabled only when all *connected* human guests are ready.
  Host is implicitly ready; bots count as ready; disconnected roster players are ignored.
  Solo lobby: host starts immediately.
- **Server enforces `start`**: rejected unless sender is host AND the ready condition
  holds. This is the one privileged action (unlike settings).
- Ready flags reset when a game ends back into a lobby (rematch returns everyone to
  not-ready).

## Data-flow summary

Client sends intents (`set_ready`, `start`, `set_length`, `set_rows`) → Room DO mutates →
`persistAndBroadcast()` → per-viewer `snapshotFor()` now carries `hostId` and each
player's `ready` → `render()` repaints (host vs guest controls, seat-strip ready marks,
Start enablement).

## Testing

- **Room DO (vitest)**: host assignment (owner joins / owner never joins / bots skipped);
  succession on disconnect (join-order, skips bots and disconnected); no reclaim;
  `start` rejection (non-host sender; unready guest present); ready reset after game end.
- **Client (vitest/jsdom)**: dim-control gating respects `isHost`; lobby grid uses
  `--rows: 1`; seat model surfaces ready marks (pure functions in `public/lobby-view.js`).

## Out of scope

- Max-players (capacity) as a host setting — stays hardcoded at 8.
- Host-only rename/rematch/edition changes.
- Kick/transfer-host UI.
