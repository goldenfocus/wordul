# Race drama audio — opponents you can hear

**Date:** 2026-06-05 · **Status:** approved · **Surface:** new `public/drama.js` + call sites in `public/app.js` (Tier C, client-only)

## Problem / goal

Race rooms are visually alive (ghost typing, mini-boards) but silent about the *threat*.
Add reactive audio driven by **opponents'** play so a race feels like a race: dread when
they close in, a time-bomb tick when they're deep in their guesses, joy when they bust.

Decisions made in brainstorming: **persistent danger layer** (not one-shots only) ·
**arcade/chiptune palette** (pure Web Audio synth, zero asset files) · **rides the global
🔊 mute** (`wordul.muted`), on by default, no new settings UI.

## Cue map

Opponent = any player who isn't me. Active only in live multiplayer race rooms (never
the daily, never solo, never after my own round ends — see Lifecycle).

| Trigger | Sound (all synth, chiptune) |
|---|---|
| Opponent's newly committed row reveals **new hot letters** (mask `"hot"` cells beyond their previous best count) | Dissonant minor-2nd sting, 2 quick notes; +1 semitone per extra new hot. |
| Newly committed row adds only **warm** progress | Single soft low blip (a "they're sniffing around" tick). |
| Any still-`playing` opponent reaches **row `maxGuesses − 2`** | Danger layer L1: quiet square-wave tick every ~1.1s. |
| Any still-`playing` opponent reaches **row `maxGuesses − 1` (final row)** | Danger layer L2: tick every ~0.55s + sub-square "heartbeat" thump. |
| A row-4+ opponent **busts** (`playing → lost`) while I'm still `playing` | Layer cuts instantly → ascending 4-note chiptune fanfare. A bust by a shallow opponent (no layer running) still gets the fanfare, slightly quieter. |
| Opponent **solves first** (I lose) | Layer cuts to silence. No new sound — the existing loss flow owns that moment. |
| Round ends for any reason / I mute / I go to `finished` | Layer cuts instantly; pending stings dropped. |

**Multi-opponent rules (bots now type concurrently — collisions are common):**
- The danger layer's level = the **max** row depth across still-playing opponents; it
  never stacks (one tick loop total).
- One-shot stings share a **1.5s cooldown**: within the window, keep only the highest-
  priority cue (bust > hot sting > warm blip). No machine-gunning when 3 bots commit at once.

## Architecture

### `public/drama.js` (new, ~150 lines, two halves)

**Pure half — `detectCues(prev, next, ctx)`** — exported, unit-tested, no DOM/audio.
- Inputs: previous and next snapshot `players` arrays (the client already receives full
  guesses-with-masks per player via `projectPlayerForClient`), and
  `ctx = { me, maxGuesses, phase }`.
- Output: `{ cues: [...], dangerLevel: 0|1|2 }` where cues are
  `{ kind: "hot", count }`, `{ kind: "warm" }`, `{ kind: "bust", deep: boolean }`.
- "New hot letters" = increase in an opponent's per-row hot count vs their previous
  rows' max **per column**: count columns newly hot in the latest row that were never
  hot for that opponent before (a re-confirmed hot column is not news).
- `dangerLevel` derives from max row depth among still-playing opponents:
  `0` below `maxGuesses−2`, `1` at `maxGuesses−2`, `2` at `maxGuesses−1`.

**Impure half — `dramaApply(result)` + the layer manager.**
- One module-level tick loop: `setInterval` whose handler schedules a short Web Audio
  blip (square osc, ~40ms, gain ≈ 0.06 L1 / 0.10 L2 + low thump at L2). Interval is
  recreated on level change; cleared on level 0. `setInterval` cadence (not Web Audio
  lookahead scheduling) is fine — a ±50ms human-scale wobble suits a bomb tick.
- One-shots reuse the page's audio pattern: same lazy `AudioContext`, same
  `wordul.muted` check, same try/catch "audio is a nice-to-have" stance.
- Cooldown state (last sting timestamp) lives in the module.

### AudioContext sharing

`drama.js` creates/uses its own lazily-created context with the same
suspended-until-gesture handling pattern as `app.js:3159` (the existing `unlockAudio`
listeners fire `once: true`, so drama adds its own equivalent unlock; both contexts
resume on first touch). No refactor of `playChime`/`playNoise` — surgical change.

### Call sites in `public/app.js`

1. Snapshot handler: keep the previous `players` array, call
   `detectCues(prev, next, ctx)` then `dramaApply(...)`, after render.
2. Round end / `rematch_accepted` / my status flip away from `playing`: call
   `dramaStop()` (also called internally when `phase !== "playing"`).
3. Mute toggle already gates every scheduled sound at play time (checked per tick),
   so muting mid-tick silences the next blip — no extra wiring.

## Error handling

Identical stance to existing audio: every Web Audio call wrapped in try/catch and
no-ops on failure; a broken AudioContext can never affect gameplay. `detectCues` is
total — missing/short fields produce zero cues, never throws.

## Testing

- `test/drama.test.js` (vitest, matches the repo's public-module test pattern):
  new-hot detection (first hot, repeat hot not news, multi-hot count), warm-only blip,
  danger level derivation incl. multi-opponent max, bust cue with `deep` flag, my own
  rows never produce cues, finished/daily contexts produce nothing. The cooldown +
  priority pick lives in the impure half (time-dependent) — covered by smoke, not unit tests.
- Audio output is unautomatable; smoke live: race 2 bots, hear sting on their hot rows,
  tick at their row 4, faster tick row 5, fanfare on bust; mute kills everything.

## Out of scope (v1)

Per-edition drama palettes (vibe-studio "horror mode" later), opponent-typing-synced
tick acceleration, haptics, a dedicated settings toggle, sounds for my own play
(already covered by chimes/mistake FX), opponent-solves "defeat" sting.
