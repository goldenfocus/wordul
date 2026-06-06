# Valid-word bonus — design

**Date:** 2026-06-06 · **Status:** approved (Yan picked "flat +25 every valid guess")

## Problem

A valid-but-wrong guess with zero new discoveries earns nothing today — or goes
*negative* via dead-letter penalties. Submitting a real word that the dictionary
accepts lands as dead air. Gameplay ask: every accepted valid word should earn
some points.

## Decision

Flat **+25 points per accepted non-winning guess** (`POINTS.validWord` /
`GOLD.validWord` — ¼ of a yellow). Stacks with green/yellow discovery points,
sits **outside** the combo multiplier. The winning all-green row is excluded —
`POINTS.solve` (500) owns that moment.

Rejected alternatives: zero-discovery-only consolation (less predictable),
rarity-scaled payout (needs a rarity signal we don't have; YAGNI).

No spam risk: guesses are capped per game and the speed bonus
(`speedPerGuessLeft` = 300/guess left) dwarfs 25.

## Implementation

- **Server (authoritative):** `src/economy.ts` — `POINTS.validWord = 25`;
  `pointsEarned` adds it per row whose mask isn't all-hot. Single choke point
  covers race, daily, arena, and bots (bots never mint, unchanged).
- **Client (presentation twin):** `public/gold.js` — `GOLD.validWord = 25`.
  `public/app.js` accepted-guess handler runs `runValidWordBonus()` after the
  discovery payout sequence (or at flip time when there are no discoveries):
  a quiet HUD tick on the round-score wallet (no coin-rain) + a
  `valid word +25` hacklog line. Drain spacing widened 350→700ms so the bonus
  tween (650ms) and the penalty tween never race the same element.
- **Known seam:** the final *losing* row never enters the client's
  `status === "playing"` branch, so it shows no live tick — its +25 still
  lands server-side in the settlement mint, which is the authority anyway.
- **Replay:** `balanceAfter` already excludes penalties; it now also excludes
  the bonus — same accepted drift pattern.

## Tests

`test/economy.test.ts` — new `valid-word bonus` describe (zero-discovery,
flat-outside-combo, solve-row-excluded, multi-row) + updated totals.
`test/gold.test.js` — new GOLD ↔ POINTS twin-contract parity test.
