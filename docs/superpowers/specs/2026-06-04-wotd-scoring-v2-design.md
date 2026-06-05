# WOTD Scoring v2 — design

**Date:** 2026-06-04
**Status:** Approved design, pre-implementation
**Scope:** Word of the Day (daily) only. Multiplayer race rooms unchanged.

## Problem

A player finished a Word of the Day, watched the on-screen number climb to ~350
during play, then "died" and ended with a gold total of 125. It felt like the game
*gave* points and then *stole* them. Investigation found this is not a single bug but
a tangle of real issues:

1. **The HUD lies about your wallet mid-game.** During play, the persistent ◆ gold
   wallet (`wordul.gold`, a *display cache*) is animated UP by raw point-values
   (green +100, yellow +50, combos) via `playPayoutSequence → addGold`
   (`public/app.js:1754`, `public/gold.js`). At round end `refreshGold()`
   (`public/app.js:1801/1806`) overwrites it with the server-authoritative balance.
   Since the real mint is much smaller, the wallet snaps *down* — reading as theft.

2. **The real mint is on a ~100× smaller scale.** Server mints
   `goldFromPoints(points) + DAILY_GOLD_BONUS` where
   `goldFromPoints(p) = round(p/100)` and `DAILY_GOLD_BONUS = 100`
   (`src/economy.ts:131`, `src/room.ts:67,1470`). So a green you *see* as +100 is
   really +1 gold. The mint **is** additive (ledger append, `src/room.ts:1498`) — your
   goal is preserved + bonus added — but the display never showed that honestly.

3. **Double-pay for the same letter.** `orderedDiscoveriesInLast` (`src/economy.ts`)
   dedups discoveries by *position*, not letter. Carrying a found green in its spot
   correctly doesn't re-pay, but finding the *same letter* yellow at a *new* position
   pays +50 again for a letter already known to be in the word. Verified live: in a
   real game `N` was billed `yellow +50` **and** `green +100`.

4. **No personal speed signal.** The only timing is room-level `startedAt`, set when
   the word *seeds* and shared by everyone for 24h (`src/room.ts:526`) — useless for a
   per-player speed reward. Individual guesses carry no timestamp.

5. **Combo lines look additive but are totals.** The `+ 1.5× COMBO +300` log line is
   the *grand total* for that guess (its two `+100` component lines already included:
   200 base + 100 bonus). Formatted identically to an increment, so `+100 +100 +300`
   reads as 500 when it's 300. The log is not summable by eye.

6. **Stale/scrambled discovery log.** A real screenshot's log showed lines that cannot
   come from the board shown (`CRANE → CRANK`): a phantom `yellow N pos 5` (N is never
   at pos 5), `wasted E −50` (E can't be "wasted" — it only appears once, in guess 1),
   no `green K` (the winning letter), and no solve/speed bonus. The discovery log is
   rendering lines that don't correspond to the actual guesses — a clearing/attribution
   bug to be root-caused with systematic-debugging during implementation.

## Goals

- Gold is **sacred**: in WOTD it never moves involuntarily. It only changes on (a) a
  deliberate power-up purchase and (b) the end-of-game cash-out, which is **only-up**.
- The satisfying climbing number during play is an explicit, ephemeral **round score**,
  visually distinct from the gold wallet.
- Cash-out is one honest, additive moment: `oldGold → oldGold + mint`
  ("keep your goal + the bonus").
- Add a **time-based speed bonus** to round score.
- **No double-paying** a letter already discovered.
- The discovery log is **trustworthy and summable** (fix combo formatting + stale lines).

## Non-goals (captured as later specs)

- **Spec 2 — Gold Ledger & History** ("granular mode"): surface the existing
  `profile.ledger` (`src/types.ts:16`, append-only, capped 500) as a transaction
  history UI with a per-event breakdown. Not in this spec.
- **Spec 3 — De-Wordle rebrand**: rename the green/yellow match concept (290 refs,
  `Color` type at `src/color.ts:1`) + palette. Its own brainstorm. Not in this spec.
- Multiplayer race rooms keep today's live earn/spend gold mechanic (power-ups,
  hard-mode bankruptcy). This spec touches WOTD only.

## Design

### A. Round score vs. sacred gold (the core split)

Introduce a **round score** as the in-WOTD climbing number. It is ephemeral
(this game only), lives client-side for display and is recomputed server-side as the
authoritative figure (`player.points` already exists for this — `src/types.ts:51`).

- During WOTD play, the ◆ gold HUD is **not** animated from discoveries. The discovery
  payout sequence (glow, floater, combo finale, hacker-log) drives the **round-score**
  display instead of `addGold`. The gold wallet sits still.
- Round score earns/loses freely (discoveries, combos, penalties) — it's ephemeral, so
  going down mid-game is fine and not "theft".
- **Deliberate power-up spends** (reveal −4000, vowel −200) still debit real gold
  immediately — that is the player's choice, shown as honest ledger lines, not theft.
  (Keeping the splurge economy intact; the wallet only ever drops by *your* action.)

**Client-side mechanism:** the WOTD payout path stops calling `addGold`/`goldDrain` on
the gold HUD for discoveries/penalties, and instead ticks a dedicated round-score
element (new `#roundScore` near the board / in the header). The race-room path is
unchanged (it still drives the gold HUD live). Gate on `game.isDaily`.

**Spend accounting (resolve the double-charge):** today
`player.points = pointsEarned − player.pointsSpent` (`src/room.ts:892`) *and* the power-up
debits gold live — under the new model that would charge a WOTD reveal twice (once off
gold, once off the round-score-derived mint). Decision: **in WOTD a power-up costs real
gold only**; it must NOT also reduce round score. So WOTD round score =
`pointsEarned(...)` with `pointsSpent` excluded (or `pointsSpent` forced to 0 in daily).
Race rooms keep `− pointsSpent` (their points→gold path is the live wallet, unchanged).

### B. Cash-out — only-up, additive, honest

At game over (`scorePlayer`, `src/room.ts:1442`), the mint formula gains the time bonus:

```
mint = goldFromPoints(roundScore) + DAILY_GOLD_BONUS + goldFromTime(elapsedMs)
     = round(roundScore / 100) + 100 + goldFromTime(elapsedMs)
```

Resigners still forfeit to 0 (unchanged). The ledger append stays additive (unchanged).

**Client:** on `personallyWon || personallyLost`, instead of a silent `refreshGold()`
that snaps the number, play a single "cash-out" animation: the gold HUD counts
`oldGold → oldGold + mint`, coins fly onto the pile, and the goody line reads the
honest breakdown (e.g. `+125 gold  ·  score 2,800 → +28  ·  daily +100  ·  speed +5`).
The wallet number only ever increases here.

### C. Time-based speed bonus

Add **per-player timing** for WOTD:

- New `PlayerState.startedAt?: number` — stamped on the player's **first accepted
  guess** in a daily room (in `applyGuess`, `src/room.ts:886`, when
  `player.guesses.length === 1` and `state.isDaily`).
- `elapsedMs = finishedAt − player.startedAt` at scoring time.

**Curve (round-score points):** `bonus = max(0, round(CAP × (1 − elapsedMs/WINDOW)))`
with `CAP = 500`, `WINDOW = 180_000` (3 min). Solve in ~30s ≈ +420, ~90s ≈ +250,
0 by 3 min. This is *round score* (≈ ÷100 in gold, so a ~+5 gold edge for speed).
Stacks with the existing `speedPerGuessLeft` (300 × unused guesses). New pure helper
`speedBonusPoints(elapsedMs)` in `src/economy.ts`, unit-tested, mirrored client-side
for the live preview if shown.

Constants live beside the rest in `src/economy.ts` (`POINTS`) and the client mirror in
`public/gold.js` (`GOLD`), kept in sync (existing pattern; a test asserts parity).

### D. No double-paying letters

Change discovery dedup in `orderedDiscoveriesInLast` (`src/economy.ts`):

- **Yellow** counts only if that **letter** has not already been proven present
  (yellow *or* green) at any position in a prior guess — dedup by **letter**.
- **Green** continues to dedup by **position** — placing a known letter in its exact
  spot is genuinely new info and pays once per position. (Confirmed design choice:
  a yellow→green letter pays once as yellow "it's in there" + once as green "it goes
  HERE"; never twice for the same achievement.)

This is a pure-function change; `pointsEarned` inherits it. Add unit tests for the
"moving yellow letter" case (must pay yellow once, not per position) and the
yellow→green upgrade (green still pays).

### E. F5 — Combo line is visually a total, not an increment

In `playPayoutSequence` (`public/gold.js`) and any server/replay log text, render the
combo finale so it can't be mistaken for an additive line — e.g.
`↳ ×1.5 combo  (=300)` or show only the `+bonus` delta (`+100`) rather than `+total`.
The summable invariant: the visible `+N` numbers add up to the guess's real delta.
Preserve the existing GOLD-SUM contract (Σbeats + bonus === total).

### F. F6 — Trustworthy discovery log

Root-cause the stale/scrambled lines (log not cleared between guesses/rounds, or
discovery attribution mislabeling position/letter) using systematic-debugging. The log
must show exactly the discoveries of the guesses on the board, in order, and nothing
from prior rounds. Add a regression test reproducing the `CRANE → CRANK` case: the log
for guess 2 must contain `green K pos 5` + solve + speed, and must NOT contain any
`yellow N`, `wasted E`, or carried-green re-pay.

## Data model changes

- `src/types.ts`: add `PlayerState.startedAt?: number` (per-player first-guess time,
  WOTD).
- `src/economy.ts`: add `POINTS` time-bonus constants + `speedBonusPoints(elapsedMs)`;
  modify `orderedDiscoveriesInLast` dedup (yellow-by-letter).
- No migration (Durable Object state, additive optional field).

## Files affected

- `src/economy.ts` — dedup fix, time-bonus helper + constants.
- `src/room.ts` — stamp `player.startedAt`; add time bonus to the mint in `scorePlayer`.
- `src/types.ts` — `startedAt` field.
- `public/app.js` — WOTD: route discovery payout to round-score (not gold) when
  `game.isDaily`; cash-out animation; goody breakdown copy.
- `public/gold.js` — round-score render path; combo line formatting (F5).
- `public/edition.js` — only if a round-score store/helper belongs beside gold.
- i18n locale files — new goody/cash-out/round-score strings, all locales in one pass.
- `test/` — economy unit tests (dedup, time bonus, sum invariant) + the CRANE→CRANK
  regression (F6).

## Testing

- `npm test` (vitest): pure-function tests for `orderedDiscoveriesInLast` (no
  double-pay), `speedBonusPoints` (curve endpoints), `pointsEarned` (totals incl. time
  bonus), GOLD-SUM parity, and the CRANE→CRANK log regression.
- `npm run typecheck`.
- Manual on a real iPhone (CLAUDE.md iOS-zoom rule) + desktop: play a daily, confirm the
  gold wallet does NOT move during play, the round score climbs, and cash-out animates
  `old → old+mint` upward once with an honest breakdown; confirm no double-pay and a
  clean, summable log.

## Tuning constants (all in one place, `src/economy.ts` + mirrored `public/gold.js`)

| Constant | Value | Meaning |
|---|---|---|
| `POINTS.green` | 100 | placed-letter (per position, once) |
| `POINTS.yellow` | 50 | present-letter (per letter, once) |
| `POINTS.solve` | 500 | flat solve |
| `POINTS.speedPerGuessLeft` | 300 | × unused guesses |
| `SPEED_CAP` | 500 | time-bonus max (round score) |
| `SPEED_WINDOW_MS` | 180000 | time-bonus taper to 0 |
| `DAILY_GOLD_BONUS` | 100 | flat daily mint (gold) |
| `goldFromPoints` | `round(p/100)` | score → gold conversion |

## Build order

1. `src/economy.ts` pure changes (dedup + time bonus) with tests — foundation.
2. `src/types.ts` + `src/room.ts` server (stamp `startedAt`, mint formula).
3. `public/gold.js` + `public/app.js` client (round-score split, cash-out, F5).
4. F6 stale-log root cause + regression test.
5. i18n strings, full gauntlet, ship via `dev/ship.sh`.
