# Race Replay — letter reveal + compressed full-field replay at game end

**Date:** 2026-06-06 · **Status:** approved by Yan (this session) · **Surfaces:** arena / duel / KOTH rooms (NOT daily)

## What

When a race finishes, two things happen on the finished screen:

1. **Letters reveal instantly** on every player's board (today only your own tiles show
   letters; opponents are color-only).
2. A **"▶ Watch replay" button** replays the whole field in place on the existing boards —
   the director's cut: typing fills and row wipes, rejected words slamming in with their
   −50 sting, each guess flipping at its (compressed) real moment, WON/OUT badges landing
   when they actually landed — ending with a per-board closing chip showing **total time +
   gold won**.

Pacing is **compressed rhythm**: clamp every inter-event gap to 2s, then scale uniformly so
the total runs ≈ 12s (`speed = max(1, clampedTotal / 12000)` — never speed up a game already
under 12s). Preserves who-was-faster and the drama beats without the dead air.

## Why this shape (decisions made)

- **Auto-playing replay at finish: rejected.** Game end is already the busiest moment
  (endcard, payout coins, voice line). Replay is opt-in via one clear button.
- **Reveal gated on `phase === "finished"`, not "I'm out".** An out player could chat-relay
  a still-racing player's guesses. Letters wait until everyone's done.
- **Rejected words ARE recorded with letters — leak-safe by definition.** A rejected word is
  not in the word list, so it cannot be the answer. The ghost-tape contract ("guess letters
  never exist in a tape") is preserved: guess events stay mask-only.
- **No `guessAts` dependency.** The i-th `guess` tape event of user *u* pairs with
  `players[u].guesses[i]` from the snapshot → letters + mask + timestamp by merge.
- **Bots replay for free.** Bot guesses route through `applyGuess` (src/room.ts:1255) so
  they're already taped; the tape never carried `isBot`, so the disguise holds.

## Data flow

```
tape (rhythm + rejects + finish stamps)  ⋈  snapshot players (words + masks)
        └── ships over room socket ONLY at phase === "finished" (gated like `word`)
                     └── replay-core.js merges + compresses → field state at playback t
                                  └── app.js owns clock + DOM (ghost-replay pattern)
```

## Changes

### Server (src/room.ts)

0. **Tape every multiplayer round.** Today the tape only exists for SEEDED Arena rounds
   (`runStart` creates it inside the `this.state.seed` branch, ~line 777, and all four
   `tapePush` guards require `this.state.seed`). Ordinary rooms record nothing. Move tape
   creation out of the seed branch (`newTape` for every non-daily round) and drop the
   `seed` condition from the tapePush guards. Safe: the tape→Challenge-DO filing at
   ~line 1577 stays gated on `seed && shareChallengeId`, so unseeded tapes never leave the
   room state; they're capped at 5000 events and overwritten each round.
1. **Tape rejects.** In `handleGuess`'s "not in word list" branch (~line 938):
   `tapePush(this.state.tape, { t: this.tapeT(Date.now()), u: username, k: "reject", word })`.
   The wrong-length branch is NOT taped (client prevents it; only anomalies hit it).
   `ghostPlayersAt` (public/ghost-replay.js) skips unknown event kinds, so ghost races are
   unaffected — verify with a test, don't assume.
2. **Ship tape at finish.** In `snapshotFor` (~line 1940), replace the unconditional
   `tape: undefined` with `tape: this.state.phase === "finished" ? this.state.tape : undefined`.

### Replay core (public/replay-core.js — NEW, pure, no DOM)

Follows the `ghost-replay.js` pattern exactly (unit-tested pure math; app.js owns clock+DOM).

- `buildReplay(tape, players, opts)` → merged, compressed event timeline.
  - Merge: count guess events per user; i-th guess event ↔ `players[u].guesses[i]`.
  - Compression: clamp inter-event gaps to `opts.gapCapMs` (default 2000), scale so total
    ≈ `opts.targetMs` (default 12000), `speed = max(1, clampedTotal / targetMs)`.
- `replayPlayersAt(replay, t)` → player objects shaped like snapshot players (the
  `ghostPlayersAt` convention) so `renderBoards` draws them unchanged — but WITH letters,
  plus transient reject-row state (`{ rejectWord, rejectAt }`) for the active row.
- `nextEventAfter(replay, t)`, `replayDuration(replay)`, and per-player closing stats
  (`finishT`, status, guesses used).

### Client (public/app.js)

1. **Letter reveal** (~lines 2986/2990): `if (isMe || snap.phase === "finished")
   tile.textContent = guess.word[c]`. Daily untouched (only your board renders there).
2. **▶ Watch replay button** on the finished screen near the endcard. Hidden when no tape
   arrived (old rooms, daily).
3. **Playback**: `game.replaying` flag — snapshot renders yield while replaying (same
   pattern as `game.ghost`, app.js:1873). Clock drives `replayPlayersAt` → `renderBoards`.
   Reject rows render letters flash-red + shake + "−50" floater. Thin progress bar;
   tap = skip to end.
4. **Closing chips**: replay end restores final revealed boards; each board gets a small
   chip with total time (`finishedAt − firstGuessAt`, the src/room.ts:209 math — needs
   those stamps client-side, they're already on PlayerState) + gold won.
5. **Replayable** until rematch/next round wipes round state (button stays).

### Tests

- `test/replay-core.test.js` (vitest, mirrors `test/ghost-replay.test.js`): merge
  correctness (multi-player, interleaved), gap-clamp + scale math (incl. sub-12s game →
  speed 1), reject events carry letters, wipe detection (typing len → 0), badge/finish
  timing, closing stats.
- Room/server test: tape absent from snapshot while `playing`, present at `finished`;
  reject event lands on tape with the word.
- Ghost regression: `ghostPlayersAt` over a tape containing `reject` events is unchanged
  output (skips them).

## Out of scope

- Daily replay / share-your-replay (later, separate idea).
- Hardening the pre-existing wire leak (opponents' guess words ship during play; client
  just doesn't render them). Noted 2026-06-06, separate task.
- Spectator/late-joiner replay via Challenge DO.
