# Ghost disguise + exact-time replay — spec

**Date:** 2026-06-05 · **Status:** approved by Yan, ready to implement (context was cleared;
this spec is the handoff). Implement in a fresh worktree: `bash dev/start.sh ghost-disguise`
(one was created and removed; recreate).

## What Yan actually wants (final, after two rounds of iteration)

A `?vs=<sender>` challenge should feel like **racing the real person live**:

1. **SHOW the ghost replay during play** (revert the "untold/stealth" behavior shipped in
   commit `5652d18` — that round misread the feedback).
2. **Exact real timing.** The ghost's rows land at the *actual* moments the original player
   committed them — "if it took 10 minutes so be it." No synthetic cadence, no gap clamping,
   no fake pacing — that was Yan's complaint #1 about the first ship.
3. **Disguise the ghost as a live opponent.** Remove the ghost chip — both the *word*
   ("ghost"/"👑 ghost") and the *icon* (👻) — from the opponent board. Status badges that a
   real opponent would get (WON/OUT, appearing at their recorded finish moment) stay.
4. **Standard start gate.** Kill the floating "I'm ready — GO" overlay
   (`showGhostReadyOverlay`). Use the regular game-start affordance (the normal lobby
   start / "I'm ready" button) — same placement as a regular game. The button's click is
   still a user gesture, so the iOS audio-unlock that the overlay performed must move onto
   that button.
5. **Keep** the end-screen duel verdict (`duelVerdict` in `public/race-copy.js`, shipped in
   `5652d18`) — "You out-worded @yang — 2/6 vs 6/6 👑". It complements the live race.
6. **Keep** the forfeit voice guard (no dangling "the word was…", also in `5652d18`).

## Current state (what's live on main as of `5652d18`)

- `?vs=` link → client does NOT fetch ghosts with vs (stealth — **revert this**:
  `public/app.js` showChallenge, the ghosts fetch around line 811 must again append
  `?vs=${encodeURIComponent(vs)}`). `game.challengeVs` stash + end verdict — keep.
- Ghost chip renders at `public/app.js:2939-2940`:
  `b.textContent = p.ghostHost ? "👑 ghost" : "👻"` — **delete the chip entirely** (the
  whole `ghost-badge` branch); check `public/style.css` for orphaned `.ghost-badge` rules.
- Floating overlay: `showGhostReadyOverlay()` (`public/app.js:3060`), torn down in
  `leaveRoom` (`#ghostReady`, ~line 4443). **Remove**; ghost challenges get
  `game.autoStart = false` and start via the standard lobby start button. Verify the
  audio/voice unlock the overlay's tap performed (iOS `speechSynthesis` + AudioContext —
  see commit eb7c642) fires on the standard start instead.
- Server `?vs=` synthesis: `worker.ts` ghosts route → `game-for-word` (User DO) →
  `tapeFromSolveGrid` (`src/ghost-core.ts`) with **synthetic cadence** (4.5s first row,
  7s gaps) because `GameRecord` stores no timestamps. This is the part exact-timing replaces.

## Exact timing — the data problem and the plan

No stored run today has real per-guess times. Two layers:

### A. Start recording real times (server, the durable fix)

- `GameRecord` (`src/records.ts`) gains optional `guessAts: number[]` — **ms offsets from
  round GO** (`this.state.startedAt`), one per guess row, parallel to `solveGrid`.
- Room DO: stamp the offset on every accepted guess for every player (`applyGuess`,
  `src/room.ts` ~line 1007). Store on `this.state` players (hibernation rule: per-round
  data lives on `this.state`, never class fields — see memory `do-hibernation-state`).
  Seeded arena rooms already compute exactly this for `tapePush` (`tapeT()`); reuse.
- Record building at finish (`src/room.ts` ~1485-1500, where `solveGrid`/`words` are
  stamped) also copies `guessAts`.
- `toPublicGame` (`src/records.ts`): decide exposure — times are not spoilers; keeping
  them in the public projection is fine and simplest (colors+times, no letters).
- `tapeFromSolveGrid` accepts optional `guessAts`; when present and `length ===
  solveGrid.length`, events land at those exact offsets — **no clamping whatsoever**.
  When absent (every legacy record), fall back to the current cadence (only honest option;
  note: yang/papa's existing runs replay on cadence until they play new games).

### B. Client mint path (`public/owner-tape.js`)

- Currently clamps gaps (MIN 1.2s / MAX 12s / DEFAULT 7s). **Remove MIN/MAX clamping** —
  use exact recorded gaps from `game.myGuessTimes`.
- First-row offset: record the round-start moment client-side (`game.myRoundStartAt`,
  set on the lobby→playing transition in the snapshot handler, ~line 1880) so the first
  guess offset is real too (today it's a fixed 4.5s).
- Keep the cadence fallback when times are missing/incomplete (mid-game reload).
- Update `test/owner-tape.test.js` (clamping tests become exact-gap tests).

## UX during a long quiet stretch

Accepted by Yan explicitly ("so be it"). No countdown, no compression. Optional phase-2
nicety only if asked: subtle "…" typing shimmer on the ghost board during long gaps —
the live-typing ghost pulses (`game.typing`) could sell the realism; the recorded tapes
carry real `typing` events only for arena tapes, so don't fake them for synth tapes.

## Files to touch

| File | Change |
|---|---|
| `public/app.js` | restore `?vs` on play-path ghosts fetch; delete ghost-badge chip branch (~2939); remove `showGhostReadyOverlay` + its `leaveRoom` teardown + call site (~856); standard-start wiring + audio unlock; `game.myRoundStartAt` |
| `public/owner-tape.js` | exact gaps (drop MIN/MAX), real first-row offset, keep fallback |
| `src/records.ts` | `guessAts?: number[]` on GameRecord + through `toPublicGame` |
| `src/room.ts` | stamp per-guess offsets on `this.state`, copy into records at finish |
| `src/ghost-core.ts` | `tapeFromSolveGrid` honors `guessAts` exactly; cadence fallback |
| `src/user.ts` | `game-for-word` returns `guessAts` |
| `src/worker.ts` | pass `guessAts` into `tapeFromSolveGrid` |
| `public/style.css` | drop orphaned `.ghost-badge` styles if unused |
| tests | `owner-tape` (exact gaps), `word-challenge` (tape with real times), `records` (guessAts), ghost-badge render if covered |

## Invariants (unchanged, non-negotiable)

- The answer word/letters NEVER ship through meta/ghosts/game-for-word — masks only.
- One-shot scoring stands (first attempt per username).
- Real arena filed tapes keep their live replay (they already have exact timing).
- `verify-bot-*` naming + identity restore + `browser_close` for any prod browser check.

## What's already shipped & stays (do not re-litigate)

- Link-first share, Save card button, `shareTargetUrl` (commit `cd36678`).
- Wiki word challenge: canonical per-word leaderboard, opaque hash ids, one-shot
  attempts, `?vs=` server synthesis, wiki CTA (commit `f741d46`).
- Duel verdict line + forfeit voice guard (commit `5652d18`).
