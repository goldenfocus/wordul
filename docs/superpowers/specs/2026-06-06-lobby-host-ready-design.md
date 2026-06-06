# Challenge lobby — compact layout, host model, truthful controls

**Date:** 2026-06-06 · **Status:** approved by Yan (re-aimed after code dive) · **Branch:** `lobby-host`

## Problem

The invite/challenge lobby (single-row board teaser, 5×6 dimension control, 1/8 seat
strip) has two issues:

1. **Big dead gap** — `renderBoards()` draws only one row in the lobby but still sets
   `--rows` to the full count, so `.grid` (`grid-template-rows: repeat(var(--rows), 1fr)`,
   style.css:899) reserves 5 empty full-height tracks between the teaser row and the 5×6
   control.
2. **Guests see host controls** — settings and start look shared/confusing.

## Reality discovered in code (re-aims the original design)

- The screenshot's "Challenge" lobby is **single-player**: `/c/<id>` routes each player to
  their own DO (`c:<id>:<player>`, src/worker.ts:71). Invitees race the **ghost tape** of
  the field — nobody else ever joins that room. The 1/8 seat strip is fiction (default
  `MAX_PLAYERS = 8`), and the 5×6 control is a lie (the pinned challenge word overwrites
  length at start, room.ts:790-804).
- **Real multiplayer rooms** (`/@owner/slug` — duel rooms, KOTH) already have a
  **ready-gated start**: all connected duelists ready → 3-2-1 countdown (`onReady`,
  room.ts:885-896). What they lack is a host concept for settings.

## Decisions (locked with Yan)

Split the work by room type:

### A. Challenge lobby (solo + ghosts)
- Compact layout: lobby grid uses 1 row track (gap collapses). Bloom is a per-row
  opacity stagger on re-render (style.css:3493) — unaffected.
- 5×6 renders **read-only** (the word is pinned). Server also rejects
  `set_length`/`set_rows` when `challengeId` is set (hardening; the values were
  meaningless anyway).
- Seat strip becomes **truthful**: you + the ghost field ("vs N ghosts"), not 1/8.
  No ghost tape → strip hidden (plain challenges auto-start past the lobby anyway).
- Start stays as-is: your personal "go".

### B. Multiplayer rooms (`/@owner/slug`)
- Compact layout (same renderBoards change).
- **Host = first connected human** (in practice the owner, who opens the room first),
  persisted as new `hostId` in room state, sent in snapshots. Bots never host. Daily
  rooms unaffected.
- **Succession**: when the host disconnects, hostship passes to the next connected
  human in join order. System line "<name> is now the host" (announced on *change*
  only, not initial assignment). Room empties → `hostId` clears; next human to connect
  becomes host. **No reclaim** — a returning ex-host is a guest.
- **Settings gating (client-only)**: the in-lobby 5×6 popover is editable only for the
  host (existing `.locked` rendering for guests). Guests keep a buried path:
  **Settings → Room**, which gains a **Rows** select next to the existing Word-length
  select. Server stays permissive for `set_length`/`set_rows` in non-challenge rooms.
- **Ready-gated start already exists** (duelists ready → countdown) — no server change.
  The seat strip gains **ready marks** so the lobby shows who's ready.

## Data flow

`hostId` lives on `RoomSnapshot` (the DO's `state` type), so it persists and rides
`snapshotFor`'s `...this.state` spread to every client automatically (it is not in the
outbound strip list). Per-player `ready` already reaches the client
(`projectPlayerForClient` strips only `isBot`/`nextGuessAt`).

## Testing

- **Room DO (vitest, `new Room()` harness from test/room-duel.test.ts)**: host
  assignment on first hello; succession in join order on disconnect; clear-on-empty +
  next-joiner-becomes-host; no reclaim; `set_length`/`set_rows` rejected in challenge
  rooms.
- **Pure client models (test/lobby-view.test.js)**: ghost seat model; ready marks in
  `seatModel`.
- **Source-wiring assertions** (pattern from room-core.test.ts:184-198) for the
  renderBoards `--rows` collapse and `canEditLength` host gate (no jsdom harness for
  app.js internals).

## Out of scope

- Shared multi-player challenge rooms (would replace async ghost racing).
- Host-only rename/edition/mode; kick/transfer-host UI; capacity as a setting.
- Spectator (queued) readiness in duel rooms — gate stays duelists-only.
