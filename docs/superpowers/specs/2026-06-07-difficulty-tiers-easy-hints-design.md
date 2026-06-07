# Difficulty tiers + Easy-mode live typing hints — design

**Date:** 2026-06-07 · **Status:** approved by Yan (tier table + visual language locked via Q&A)

## Why

The dead-letter gold drain + mistake sound felt punishing for casual play and was just
made Hard Mode only (commit `07e66f0`). Yan wants to go further: a three-tier difficulty
(Easy / Medium / Hard), **default Easy**, where Easy actively *helps* — live typing
hints that show what your previous guesses already proved, the moment you type a letter.
All of it becomes per-world configurable later (a world builder can force Hard or
fine-tune each knob); this slice ships the client setting only.

## Tier table (locked)

|                          | EASY | MEDIUM | HARD |
|--------------------------|:----:|:------:|:----:|
| Live typing hints        | ✓    | —      | —    |
| Dead-letter gold drain   | —    | —      | ✓    |
| Must-use-hints rule      | —    | —      | ✓    |
| Bankruptcy (−300)        | —    | —      | ✓    |

Medium is **exactly today's prod default** — no hints, no penalties. Hard is exactly
today's Hard Mode. Easy is Medium plus the hint lens. Nothing about scoring changes in
this slice; the server protocol is untouched.

## 1. Difficulty model

- `DEFAULT_SETTINGS` (`public/settings.js`): replace `hardMode: false` with
  `difficulty: "easy"`. Unknown stored values fall back to `"easy"`.
- **Migration on settings load:** stored `hardMode: true` → `difficulty: "hard"`;
  `hardMode: false` / absent → `"easy"`. Runs once inside the settings loader (when no
  `difficulty` key is stored yet); the old `hardMode` key is left in storage but ignored
  (cheap rollback).
- One resolver, `activeDifficulty()` (app.js): today a thin wrapper over
  `getSettings().difficulty`; the future world-override layer interposes here (§5).
  Every difficulty read in app code goes through it — never `getSettings()` directly.
- Every current `s.hardMode` read becomes `activeDifficulty() === "hard"`:
  - `checkHardMode` constraint gate (`app.js` submit path)
  - dead-letter penalty gate (`app.js` payout block)
  - bankruptcy (`isBankrupt` caller wiring)
  - the `hard: !!…` flag on the outgoing `guess` ws message (server sees the same
    boolean as today — **no protocol change**)

## 2. Knowledge derivation — `public/hints.js` (new, pure)

```js
typingHints(pending, guesses) -> Array<"dead"|"confirmed"|"present"|null>  // per column
```

Truth table, per typed column `i` with letter `L` (all claims must be *proven* by prior
guesses — dup-letter safe):

- `dead` — `L ∈ deadLettersFrom(guesses)` (reuse the existing helper from
  `celebrate.js`; do **not** duplicate the two-pass logic)
- `confirmed` — some prior guess has `L` green at column `i`
- `present` — `L` proven in-word (green or yellow anywhere) and not `confirmed` here.
  Deliberately claims only "this letter is in the word" — placing it on a column where
  it already flashed yellow still shows the dot (the fancier wrong-column warning is a
  future per-world fine-tune, out of scope)
- `null` — nothing proven

No DOM, no imports from app.js. Mirrors the purity discipline of `celebrate.js` /
`roomConfig.js`.

## 3. Rendering

In `renderBoards`' pending-tile branch (`app.js` ~3740, the
`isMe && isCurrentRow && pending[c]` case): when `activeDifficulty() === "easy"`,
compute `typingHints(pending, me.guesses)` once per render and add `hint-dead` /
`hint-confirmed` / `hint-present` to the tile.

CSS (tile family, `public/styles.css`):

- `hint-dead` — dimmed letter, red tint, **one-shot shake/blink keyframe** as the letter
  lands. **Silent** — no sound ever (sound-as-punishment is what was just removed).
- `hint-confirmed` — green outline ring.
- `hint-present` — soft yellow underline dot.
- Solid `hot`/`warm`/`cold` fills remain exclusive to settled rows — knowledge and
  result stay visually distinct, the flip reveal keeps its drama.
- `reducedMotion` skips the blink animation; the static tint stays.

Applies everywhere the player types — daily, races, duels. It only surfaces the
player's own already-revealed knowledge (the on-screen keyboard shows the same facts in
`renderKeyboard`'s color map), so there is no fairness leak.

## 4. Settings UI

The Hard Mode toggle row (`index.html` Gameplay section, `#setHardMode`) becomes a
three-chip segmented pick — Easy / Medium / Hard — using the existing
`edition-chip` pattern (same as the keyboard-layout picker). Per-tier description line
under the chips:

- **Easy** — "Typing shows what you already know: proven letters glow, dead letters blink"
- **Medium** — "No hints, no penalties — the classic game"
- **Hard** — "Revealed hints must be used, reusing eliminated letters drains gold, and
  bankruptcy past −300 ends the game"

`how-to-play.html` gains a short "Difficulty" note (3 lines, one per tier) and the Lose
card's Hard Mode line stays as shipped.

## 5. Per-world forcing — designed for, NOT built

`difficulty` is the first key the world/roomConfig override layer will pin. The
override shape is already supported by `mergeConfig` section semantics:
`{ gameplay: { difficulty: "hard" } }` — a world or room override replaces the
player's local setting (and may later fine-tune individual knobs: hints on/off,
penalty on/off, bankruptcy threshold). Nothing ships server-side in this slice; this
section exists so the client reads difficulty through one resolver function
(`activeDifficulty()`) that the override layer can interpose on later.

## 6. Testing

- `test/hints.test.js` — `typingHints` truth table: dup letters (EERIE-style), a
  yellow→green upgraded letter, dead+present in the same word, empty board, pending
  shorter than row, confirmed-only-at-matching-column.
- Settings migration: `hardMode:true` → `"hard"`, absent → `"easy"`, garbage value →
  `"easy"`.
- Submit-path gates: constraint check and penalty only at `difficulty === "hard"`
  (existing economy/penalty tests untouched).
- `npm run check-graph` covers the new `hints.js` import edge.

## Out of scope

- Per-world/room difficulty overrides (next slice; see §5)
- Wrong-column warm warning
- Any scoring/economy change, any server change
- Keyboard-key blink on dead-key tap (keyboard already colors keys)
