# Forfeit voice quotes — spec

**Date:** 2026-06-06 · **Status:** approved by Yan (approach A, "good")

## Why

A forfeit (`gave_up` / `bankrupt`) currently ends in voice silence: `announceGameEnd`
skips the spoken reveal because the server hasn't revealed the word yet (the fix in
`5652d18` — keep it). Yan wants the voice back as "another dimension": on forfeit, speak
an **empowering line or a tactical tip** from a new pool, making quitting a round feel
cool instead of dead.

## Design

### Pool — `public/inspire.js`

- New exported `FORFEIT` array of **original strings** (no `{ text, by }` attributions —
  these lines are written to be *spoken*; "— Confucius" sounds robotic aloud).
- Two flavors mixed in one pool (~40 lines to start):
  - **Empowering** — e.g. "Retreat is just strategy wearing a disguise.",
    "You quit the round, not the game. Big difference."
  - **Tips** — prefixed `Tip:` for trivial future pruning, e.g. "Tip: greens lock
    position, yellows demand a shuffle. Move your yellows around."
- One pool serves both forfeit reasons; a few lines written to land for either
  (no separate bankruptcy pool — YAGNI).
- New export `pickForfeit()` → one random string (mirrors `pickInspire()`'s shape,
  minus the quote/attribution formatting).
- Tone: smart, cheeky, spark joy; no cringe. Tips must be evergreen (no references to
  modes/mechanics that could change).

### Selection — `public/app.js`

- `triggerLoseSequence` (app.js ~3721) already runs for forfeits with
  `game.finishReason` set *before* it's called (`forfeit()` sets it at ~3656).
- When `game.finishReason === "gave_up" || === "bankrupt"`:
  `inspire = pickForfeit()`, else `pickInspire()` as today.
- The picked line rides the **existing** `openStats({ inspire })` slot — zero new
  rendering plumbing. Ran-out-of-guesses losses untouched.

### Voice

- At the same moment the end screen opens (the existing +1500ms `setTimeout` in
  `triggerLoseSequence`), speak the picked forfeit line via
  `speakLine(VOICE_EDITION, line, line)` — the plain (non-templated) voice path.
- No `{answer}` in these lines → the dangling-"the word was…" race from `5652d18` is
  structurally impossible. The empty-answer guards in `announceGameEnd` and
  `speakTemplated` stay exactly as they are.
- Mute: `speakLine` already honors the 🔊 mute — no new checks in app.js.
- iOS unlock: a forfeit always starts from a button tap (give-up / bankruptcy
  confirm), so the audio-unlock gesture exists.
- Regular (non-forfeit) losses keep their current voice: spoken word reveal, silent
  inspire quote.

## Files to touch

| File | Change |
|---|---|
| `public/inspire.js` | `FORFEIT` pool + `pickForfeit()` export |
| `public/app.js` | `triggerLoseSequence`: pick by `finishReason`; `speakLine` at end-screen open |
| `test/inspire.test.js` (or nearest home) | `pickForfeit()` draws from pool |
| app-level test if feasible | forfeit reason → forfeit pool; normal loss → INSPIRE |

## Invariants

- The `5652d18` empty-answer voice guards stay (regression test in `test/voice.test.js`
  must remain green).
- No spoken *word reveal* on forfeit — the end card still carries the word visually
  once the reveal snapshot lands (decided 2026-06-06: the quote owns the audio moment).
- i18n: English pool, same precedent as `inspire.js`' attributed quotes.

## Out of scope

- Per-edition / room-sandbox forfeit lines (approach B — rejected: line banks are
  small by design, this pool wants depth).
- Runtime-fetched `.md` pool (approach C — rejected: every pool here is a bundled JS
  module; a fetch adds a failure mode for zero benefit).
- Separate bankruptcy-flavored pool.
