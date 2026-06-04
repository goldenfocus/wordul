# WOTD quit: skull-mark + forfeit — design

**Date:** 2026-06-04
**Status:** Approved (brainstorming → ready for plan)

## Problem

On the daily word-of-the-day (WOTD) leaderboard, a player who **rage-quits** is
visually and economically indistinguishable from a player who **solved fast**.

- The leaderboard row always renders `in ${entry.guesses}` (`public/daily-card.js:74`).
  `in 2` is meant to read as "solved in 2", but a quitter who made 2 guesses renders
  identically to a genius who solved in 2.
- A quit only sets `player.status = "lost"` (`src/room.ts:851`) and **keeps every point
  already earned** — `pointsEarned` is recomputed on each guess (`src/room.ts:681`) and is
  never zeroed on resign. Gold is then minted as `goldFromPoints(player.points) + DAILY_GOLD_BONUS`
  (`src/room.ts:1148`). So a quitter still earns gold and can **out-rank honest players** who
  scored less.

There are exactly two ways to land a non-win row on the leaderboard: **resign** (explicit
give-up, outcome `"resigned"`, `src/room.ts:853`) or **run out of guesses** (used all
`maxGuesses` and missed, `src/room.ts:690`). Closing the tab leaves you `"playing"` —
never scored, never ranked — so it is not a leaderboard concern.

## Decisions (locked)

1. **Marker = quit only.** Skull marks rage-quit; running out of guesses is softer.
   - won → `in N`
   - resigned → 💀
   - lost + ran out → `X/{maxGuesses}`
2. **Quit forfeits everything.** A resign zeroes **points and gold** (no `goldFromPoints`,
   no `DAILY_GOLD_BONUS`). Ran-out players are **untouched** — they keep points + gold and
   rank normally; they just render `X/N` instead of `in N`.
3. **Quitter stays visible.** Forfeit to 0, but still ranked (`goldAwarded = 0`) so the
   player sees their own `#347 💀 +0` shame-row. They sit below every honest player
   (gold 0), so they rarely clutter anyone else's top-N.
4. **Skull = 💀 emoji**, not a custom SVG — it rhymes with the give-up button (the skull you
   tapped to quit is the skull on the board) and is one character. Medal/coin SVGs unchanged.
   Swappable to an SVG glyph later if it clashes.

## Architecture

A quit is currently lossy: `status: "lost"` collapses resign and exhaust into one state.
The fix is **one new field** — `resigned` — threaded from the resign chokepoint to the
render layer. Everything else reads from it. No other schema change.

### Data model — `resigned` flag

- `PlayerState.resigned?: boolean` (`src/types.ts`, near `points`/`scored`/`goldAwarded`).
  Set `true` only in `onResign`.
- `RankablePlayer.resigned?: boolean` and `LeaderEntry.resigned?: boolean`
  (`src/leaderboard-core.ts:8,16`), carried alongside the existing `won`.

### Economy — forfeit on quit *(money path — handle with care)*

- **`onResign`** (`src/room.ts:846`): in addition to `player.status = "lost"`, set
  `player.points = 0` and `player.resigned = true`. (Honest live snapshot: the quitter's
  points read 0 immediately, not their last pre-quit total.)
- **`scorePlayer`** (`src/room.ts:1129`): if `player.resigned`, compute `gold = 0` —
  skip both `goldFromPoints(...)` and `DAILY_GOLD_BONUS`. Do **not** write the gold ledger
  for a zero mint; instead set `player.scored = true` and `player.goldAwarded = 0` directly
  so the player remains ranked (the leaderboard filter is `typeof goldAwarded === "number"`,
  `src/leaderboard-core.ts:31`). All other (won / ran-out) players keep the existing mint path
  unchanged.

### Leaderboard API mapping

- `src/room.ts:163` (the `/leaderboard` GET mapping): add `resigned: p.resigned` to the
  object passed into `topDaily`, alongside the existing `won`.
- `topDaily` (`src/leaderboard-core.ts:29`): include `resigned` in the mapped `LeaderEntry`.
  No sort change needed — a 0-gold forfeit already sorts last by `b.gold - a.gold`.

### Client render — guesses column

- `public/daily-card.js` `row()` template (line ~74), replacing the unconditional
  `in ${entry.guesses}`:
  - `entry.won` → `in ${entry.guesses}`
  - `entry.resigned` → `💀` (with an `aria-label`/`title` like "gave up" for a11y)
  - else (ran out) → `X/${maxGuesses}`
- `maxGuesses` source: the leaderboard payload does not currently carry it. Confirm during
  planning whether to add `maxGuesses` to the API response or derive it client-side from the
  word length already known to the daily card. (Variable per word length.)

## Edge cases

- **Tab-close abandon**: stays `"playing"`, never scored/ranked. Unchanged — correct.
- **Old daily records** (pre-change) have no `resigned` → fall through to `won? in N : X/N`.
  No backfill.
- **Bots**: never mint/rank (`isBot` filter). Unchanged.
- **Variable word length**: `X/{max}` uses the per-word `maxGuesses` (`guessesFor(wordLength)`).

## Testing

- `test/leaderboard-core.*`: a `resigned` entry carries the flag through `topDaily` and
  sorts dead-last when its gold is 0; a ran-out (`won:false, resigned:false`) entry with
  gold ranks normally.
- room/economy: resign zeroes `points` and yields `goldAwarded === 0` (still ranked, no
  ledger write); a ran-out loss keeps its earned points + gold.
- Render: if a unit harness exists for `daily-card.js`, assert the three-way column
  (`in N` / `💀` / `X/N`). Otherwise verify via the browse/QA pass on the live board.

## Out of scope

- Profile recent-games icons (`public/profile.js`) — still show won/lost ✅/❌; a quit reads
  as ❌, which is acceptable.
- Any SVG skull glyph in `hub-glyphs.js` (deferred; emoji ships first).
