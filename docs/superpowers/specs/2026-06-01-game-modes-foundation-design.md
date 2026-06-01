# Game Modes — Foundation

**Date:** 2026-06-01
**Status:** Approved design, pre-implementation
**Scope:** Foundation only. Introduce the *concept* of a room "mode" into the data model, control flow, and UI — with exactly one mode (`race`) wired up. No new gameplay.

## Why

Today a room implicitly assumes one format: a live synchronous race. Yan wants the room to become a configurable container that can host different formats (live race, turn-based "long game", always-open challenge) and eventually become a moddable, leveled, multilingual sandbox.

This is a **dependency ladder**: a sandbox (Layer 3) needs configurable room identity (Layer 2), which needs more than one mode to exist (Layer 1). The trap is building higher layers before the model stops assuming "live race."

This spec delivers the bottom rung: the room model gains a `mode`, and the second-mode work later only has to add an `if`. It ships nothing players can *play* differently yet, but it lands the plumbing and — via a visible "coming soon" roadmap in the picker — teases the vision.

## Non-Goals

- No turn-based, challenge, or any second mode gameplay.
- No room levels, custom word sets, per-room language/voice (Layer 2).
- No UGC / AI companion (Layer 3).
- No data migration script — backfill is inline on DO restore.

## Design

### 1. Data model

New string-union type, seeded with one value, designed to extend:

```ts
export type RoomMode = "race"; // future: "longgame" | "challenge" | ...
```

`RoomSnapshot` gains `mode: RoomMode`, default `"race"`.

On Durable Object restore, backfill any room persisted before this field existed — mirroring the existing `wordLength` backfill at `src/room.ts:63`:

```ts
if (!restored.mode) restored.mode = "race";
```

Every existing room silently becomes a race room. No migration step.

### 2. Mode registry — `src/modes.ts` (one new file)

Single source of truth describing each mode. Only `available: true` modes can be chosen; the rest exist deliberately as the visible roadmap.

```ts
export const MODES = {
  race:      { id: "race",      label: "Live Race",      blurb: "Everyone sprints the same word at once.",          available: true  },
  longgame:  { id: "longgame",  label: "Long Game",      blurb: "Turn-based. 3-day clock. Play a row, then wait.",   available: false },
  challenge: { id: "challenge", label: "Open Challenge", blurb: "One word, always open. Beat the standing record.",  available: false },
} as const;
```

Labels/blurbs in code here are English fallbacks; the rendered strings come from `i18n` (see §4).

### 3. Control flow — mirror `wordLength` exactly

`wordLength` is the proven template: owner-configurable, lobby-only, frozen once playing, migration-safe. `mode` rides the same rails.

- **`hello` message** gains optional `mode?: RoomMode`. When the owner connects to a fresh room (`phase === "lobby"`, `round === 0`), the supplied mode is applied — template at `src/room.ts:199–206`.
- **New `set_mode` client message:** `{ type: "set_mode"; mode: RoomMode }` — mirrors `set_length`. Handler is owner-only and lobby-only; it rejects (silently bails) when:
  - the room is not in `lobby` phase, or
  - the requested mode is unknown or `available: false`.
- **`mode`** is included in every `RoomSnapshot` broadcast, so all clients see the current mode.

No gameplay branches are added. Since only `"race"` is available, behavior is byte-for-byte identical to today; the value is merely threaded through.

### 4. UI — stacked mode rows (not pills)

A "Choose a mode" control in the room lobby, beside the existing word-length control, owner-only and lobby-only.

**Pattern:** full-width stacked selectable rows (a game-mode menu), NOT pills. Rationale: rows hold the blurb, support a locked/"coming soon" state, and scale vertically to an open-ended number of modes. (Pills are also discouraged by the `check-pill-buttons` gauntlet.)

Each row: a glyph, the mode label, its one-line blurb.
- **Selected** (Live Race, default): green left-accent bar, faint fill, check mark.
- **Unavailable** (Long Game, Open Challenge): dimmed, lock + "soon" tag, blurb still visible, not tappable.

```
  CHOOSE A MODE
 ┌────────────────────────────────────────────┐
 ┃ ⚡  Live Race                          ✓    ┃   selected: green left bar + faint fill
 ┃     Everyone sprints the same word at once. ┃
 └────────────────────────────────────────────┘
 ┌────────────────────────────────────────────┐
 │ ♟  Long Game                        soon 🔒 │   dimmed, not tappable
 │     Turn-based. 3-day clock. Play a row,    │
 │     then wait.                              │
 └────────────────────────────────────────────┘
 ┌────────────────────────────────────────────┐
 │ ∞  Open Challenge                   soon 🔒 │
 │     One word, always open. Beat the record. │
 └────────────────────────────────────────────┘
```

- Picking an available row fires `set_mode`; the echoed snapshot drives the selected state (server is source of truth).
- **Non-owners and late-joiners** (anyone arriving after `playing`) see the mode as a read-only chip near the room name (e.g. "Live Race"), not a control.
- Big tap targets, mobile-native (respects `check-input-zoom`).

### 5. i18n — zero hardcoded text

New keys added to **every** locale in one pass:
- `mode.heading` ("Choose a mode")
- `mode.race.label`, `mode.race.blurb`
- `mode.longgame.label`, `mode.longgame.blurb`
- `mode.challenge.label`, `mode.challenge.blurb`
- `mode.comingSoon` ("soon")

The registry in `src/modes.ts` keeps English fallbacks; the UI prefers `t()` values.

## Files Touched

- `src/types.ts` — add `RoomMode`, add `mode` to `RoomSnapshot`, add `mode?` to `hello`, add `set_mode` to `ClientMessage`.
- `src/modes.ts` — **new** registry.
- `src/room.ts` — default `mode` in initial state; backfill on restore; apply `mode` in `onHello`; new `onSetMode` handler + dispatch; ensure `mode` is in broadcast snapshot.
- `public/app.js` — render the mode-row picker (owner/lobby), read-only chip otherwise, send `set_mode` / `hello.mode`.
- `public/style.css` — mode-row styles (selected / dimmed-locked).
- `public/locales/*` — new i18n keys across all locales.

## Verification

- New room: owner sees the picker, Live Race selected; locked rows visible, not tappable.
- Old/existing room (no `mode` in storage): restores as `race`, picker shows Live Race selected — no errors.
- `set_mode` to an unavailable/unknown mode, or after play starts: silently rejected, snapshot unchanged.
- Non-owner / late-joiner: sees read-only chip, no control.
- Gameplay unchanged from today (race still works end-to-end).
- Gauntlet green: `safe-build`, `check-i18n`, `check-pill-buttons`, `check-input-zoom`, `code-reviewer`, `silent-failure-hunter`.
