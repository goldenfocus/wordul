# Hacklog Floating Line — Design Spec

**Date:** 2026-06-06
**Status:** approved direction (variant A "Phosphor Ghost", theme-toned), pre-implementation
**Live prototype:** https://wordul.com/designs/hacklog-floating
**Branch:** `gameplay-improve`

## Problem

The hacker-log ticker (`#hacklog`) is pinned ABOVE the board and never goes away.
During play it sits in the player's sightline and pulls focus off the tiles —
"the logs on top of the game are disturbing." It also reads as chrome (a
persistent UI strip) rather than a transient event.

## Summary of the change

Move the log to a **floating terminal line BELOW the board frames**:

- Each event appears as one bare monospace line — no box, no border, no chip.
- The line **holds ~3.5 s, then vanishes** (blur + opacity fade). The previous
  line ghosts faintly above the new one for a beat, then dissolves.
- The zone never pushes layout (the board↔keyboard column stays unbroken on
  mobile — the original reason the log was put on top).
- A subtle tap affordance remains after lines vanish; **tapping expands the full
  scrollback** as an overlay (CRT scanline texture) rising over the board.
  Tapping again (or the ticker) collapses it.

## Tone → theme color mapping (subtle)

Lines are colored by the **game's own tile palette**, so editions re-theme them
for free. All colors are softened toward `--fg` via `color-mix` with a faint
same-hue text glow — subtle, not shouty.

| event | tone | color |
|---|---|---|
| `hot N pos 4 +100` (right letter, right spot) | `hot` | `color-mix(var(--hot) ~72%, var(--fg))` |
| `warm E pos 3 +50` (half bonus) | `warm` | `color-mix(var(--warm) ~72%, var(--fg))` |
| `rejected WENDY −50`, penalties | `loss` | `color-mix(var(--error) ~78%, var(--fg))` |
| `↳ ×1.5 combo +75` | `combo` | bold, `color-mix(var(--hot) ~85%, var(--fg))` |
| solve / speed / system lines | `gain` (neutral) | muted `--fg` mix |

## Implementation

### `public/hacklog.js`

- New line lifecycle in collapsed mode: render the line into the float zone,
  hold `HOLD_MS` (~3500), then fade out (`vanishing` class → remove). Keep the
  typewriter type-in (collapsed mode types too now — it IS the visible surface);
  `reducedMotion` → instant show, timed hide, no blur animation.
- Previous line becomes a `.ghost` (low opacity, raised) while the new line
  lands; ghost is removed when its fade ends.
- `tone` accepts `hot | warm | loss | combo | gain` and lands as a class on the
  line and the expanded scrollback entries (today: `gain | loss | combo`).
- The tap target (ticker zone) persists while entries exist; shows a dim `▸`
  at rest instead of the last line. Tap/Enter/Space toggles expand — unchanged.
- Public API unchanged: `logLine`, `addInstant`, `collapse`, `expand`,
  `getEntries`, `clear`. Replay/end-screen contracts intact.

### `public/index.html`

- Move the `#hacklog` mount from above `.magic-bar` to directly after `#boards`
  (inside the same panel), so the float zone sits visually below the frames.

### `public/style.css`

- `.hacklog` becomes a **zero-height anchor** below the boards
  (`height: 0; overflow: visible;` with the line absolutely positioned), so it
  never pushes the board↔keyboard column.
- Line styles: bare mono, tone-class colors per the table above, fade/ghost
  keyframes, `@media (prefers-reduced-motion)` honored via the JS flag as today.
- Expanded scrollback: overlay anchored to the zone, drops UPWARD over the board
  (since the keyboard owns the space below), dark translucent veil + scanline
  `repeating-linear-gradient`, tone-colored entries, `z-index` above tiles.

### Call sites — thread the real tone

- `public/gold.js` `playPayoutSequence`: discovery lines pass
  `tone: d.kind` (`"hot"`/`"warm"`) instead of `"gain"` (both paths: reduced
  + sequenced). Combo lines stay `"combo"`.
- `public/app.js` win log (~L4099): `tone: ev.kind === "hot" ? "hot" : "gain"`
  (solve/speed stay neutral).
- Penalty/rejected call sites already pass `"loss"` — unchanged.

## Error handling

- No mount → existing no-op API (unchanged).
- Round end / `clear()` cancels pending hold/fade timers (no orphaned
  timeouts firing into a torn-down DOM — same class of bug as the
  `autoReplay` guard fixed in `96ca85c`).
- Rapid bursts (combo sequences): each new line preempts the hold of the
  previous one — previous immediately ghosts; at most 1 line + 1 ghost visible.

## Testing (vitest, fake timers)

- Line appears on `logLine`, carries its tone class, vanishes after hold+fade.
- New line during hold preempts: old line ghosts, only one active line.
- `reducedMotion`: instant render, still auto-hides, no typewriter timers.
- `clear()` cancels timers; no DOM mutations after teardown.
- `getEntries()` returns all entries with tones regardless of vanish state.
- Expand/collapse toggle still works from the persistent tap target.

## Non-goals

- No change to scoring/economy or replay format.
- No change to the end-screen line-by-line renderer.
- Other variants (Subtitle, Toast Ledger, Glitch Console) stay as reference in
  the published prototype only.
