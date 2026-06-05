# Gold Settlement Engine — Phase 1 design

**Date:** 2026-06-05 · **Status:** approved direction, pre-implementation
**Visual direction:** [Supernova](https://wordul.com/designs/settlement-supernova) (winner of the
settlement design ritual; [jackpot](https://wordul.com/designs/settlement-jackpot),
[ledger](https://wordul.com/designs/settlement-ledger), [melt](https://wordul.com/designs/settlement-melt)
remain as future theme skins).

## Problem

Two collided economies live in race rooms today:

- **Client (legacy one-token):** discoveries pay point-scale values (hot +100, warm +50,
  solve +500, speed +300/guess-left) **directly into the persistent ◆ gold HUD**
  (`app.js` race wallet adapter → `edition.js` localStorage cache).
- **Server (two-token):** the USER ledger mints only `goldFromPoints(points) = points/100`
  at cash-out (`room.ts` scorePlayer / race cashout).

At race end `refreshGold()` snaps the HUD from the inflated fake number to the real
balance. Incident (2026-06-05): a player watched "their" ~2,100 ◆ crash to 155 after an
almost-perfect game — the better you play, the bigger the perceived theft. Daily mode
already solved this with the §A round-score adapter; races were never migrated.

This spec fixes the bug by finishing the two-token economy, and lays the rail for the
bigger gold vision (buy-ins, golden power-ups, arcade) without building it yet.

## The Law (invariants — everything else is tunable)

1. **Two monies.** POINTS: per-game, ephemeral, skill expression. GOLD ◆: persistent,
   server-authoritative ledger, the thing you come back for.
2. **The wallet moves only at game edges.** −buy-in at the door, +payout at settlement.
   Never mid-game. The top-right ◆ is sacred and always true.
3. **Mid-game, everything flows through the STAKE** (table money): point earnings,
   penalties, and (Phase 2) golden power-up spends. The stake may go negative.
4. **Settlement contract** (pure function, shared client/server):

   ```
   minted  = round(points / 100)
   earned  = round(minted × mult)          // the multiplication moment
   payout  = max(0, buyIn + earned − spends + bonus)
   ```

   Default: **buy-in = max loss** (negative stake clamps to 0 — "house floor").
   A per-room/hard-mode preset flag `signedSettlement` removes the clamp (losses are
   real) — opt-in, clearly labeled, tunable.
5. **Ledger: exactly two transactions per game.** `reason:"buyin"` (skipped while
   buyIn=0) and `reason:"settle"` with `parts` [minted, mult bonus, spends, bonus];
   Σparts === delta by construction (existing LedgerPart invariant).
6. **Multiplier is data, not lore.** `mult` arrives via room/game config (win streak,
   hard mode, room stakes — Phase 1 default: 1). The settlement screen celebrates
   whatever it's given.

## Components (Phase 1)

| Unit | Change |
|---|---|
| `src/economy.ts` | `settle(input): SettlementReceipt` pure fn + types. Receipt: `{buyIn, points, minted, mult, earned, spends, bonus, payout, net, signed}`. Unit-tested. |
| `src/room.ts` | Race cash-out + daily scorePlayer build the receipt server-side, mint via existing ledger append **with parts**, and broadcast the receipt in the finished snapshot (daily keeps its flat goody as `bonus`). |
| `public/app.js` | Races switch to the **round-score adapter** mid-game (exactly like daily §A): discoveries/penalties pump the score counter, never the wallet. `refreshGold()` snap stays as reconcile-of-truth. |
| `public/settle.js` (new) | Settlement renderer registry + **Supernova** default (canvas, ported from the prototype). Consumes a receipt, ends with the ONLY-UP wallet count-up. |
| Renderer architecture | Fixed receipt contract in, animation out. Editions/theme packs may pin a different registered renderer (`edition.settleRenderer`), same as tiles/sounds today. Prototypes (jackpot/ledger/melt) become future skins. |

### Data flow

```
guesses → points (client mirrors server math, display only)
race ends → server: settle() → ledger append (settle + parts) → finished snapshot {receipt}
client: receipt → settle.js renderer (Supernova) → wallet count-up → refreshGold() reconcile
```

## What players see (Phase 1)

- During a race: a **score counter** climbs with the same coin-rain/combo choreography
  (numbers no longer pretend to be wallet gold). Wallet top-right never lies.
- Race ends: the Supernova settlement — mint (`pts → ◆`), multiplication beat (×N coin
  split) when mult > 1, spends/bonus beats when nonzero, payout figure, swarm flies to
  the wallet, count-up. Bust ends quiet: "buy-in was your max loss."
- Daily: unchanged flow, same receipt under the hood (its cash-out can adopt the
  renderer in a later pass).

## Error handling

- Mint fails server-side → existing behavior stands (no `goldAwarded`, retry on
  reconnect; never celebrate an unconfirmed mint — the ◆0 lesson).
- Receipt missing in snapshot (old client/server skew) → fall back to today's plain
  `refreshGold()` snap. No settlement animation is ever worth a wrong balance.
- Reduced motion → skip the show, render the receipt as static lines + silent snap.

## Testing

- `settle()` unit tests: clamp vs signed mode, mult rounding, parts sum === payout
  delta, zero/negative edges (vitest).
- Ledger invariant: a finished race writes exactly one `settle` tx (+ one `buyin` when
  enabled), with Σparts === delta.
- Client guard: race mode never calls `setGold`/`addGold` between game start and
  settlement (the regression that caused the incident).
- Existing gauntlet: `safe-build`, `check-input-zoom` ratchet, i18n pass for new
  settlement copy.

## Out of scope (recorded for Phases 2–3)

- **Phase 2 — the casino:** buy-ins for premium modes; golden vs point-powered power-up
  split (golden spends drain the stake, prepaid at the door); keyboard-letter reveal as
  the first golden power-up.
- **Phase 3 — the comeback:** free daily gold drops (random, multiple), gold challenge
  (invite a friend), arcade/casino surfaces built on the same receipt rail.

## Open tuning (constants, not architecture)

`points/100` rate · buy-in amounts · mult sources & caps · bonus values ·
`signedSettlement` preset membership · settlement pacing.
