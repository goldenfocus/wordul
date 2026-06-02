# Secured two-token economy — foundation (Spec 1)

**Date:** 2026-06-02
**Status:** Design — awaiting review
**Sequence:** Spec 1 of a phased economy. Spec 2 (home hub + buy-ins/freeze-out) builds on this. Real-money top-up, interest/fees, borrowing, crypto, leaderboards are deferred but ledger-ready.

## Problem

Gold is stored in browser `localStorage` (`wordul.gold`), computed entirely client-side, with no tie to the account. Two consequences:

1. **Hackable.** Anyone can open devtools and set their balance to any number. The "universal score" has zero integrity.
2. **Not per-account.** Switching username in the same browser keeps the old balance — a brand-new account "Pops" showed 1,738 gold inherited from earlier play. (`DEFAULT_GOLD = 0`, so a truly fresh browser is 0; the leak is the browser-global store.)

Separately, the single-currency model is confusing: in some games you can spend gold, in others you can't, with no consistent rule.

## Goals

- Gold becomes **server-authoritative and per-account** — tamper-proof, the real balance lives on the server.
- Introduce a coherent **two-currency model**: **Points** (in-game) and **Gold** (persistent bankroll).
- Architect storage as an **extensible token ledger** so future tokens, credit/fees/interest, real-money top-ups, and crypto are new transaction *reasons*, not rewrites.
- Fix the 1,738 bug by resetting persistent balances to a clean server baseline.

## Non-goals (this spec)

- Buy-ins / freeze-out stakes / game selection → **Spec 2 (home hub)**.
- Real-money top-up, interest/fees on debt, borrowing, 3rd token, crypto, leaderboards → deferred (the ledger supports them; no UI/logic here).
- Identity hardening. Identity stays passwordless ("kindness model"); this spec stops `localStorage` minting, not username impersonation.

## The two currencies

| | **Points** | **Gold** |
|---|---|---|
| Role | In-game chips | Persistent bankroll |
| Earned | Guessing well (current payout rules) | Minted from Points at game end |
| Spent | Power-ups **within that game** | (Spec 2: buy-ins) |
| Lifetime | Reset when the game ends | Persists on the account ledger |
| Authority | `ROOM` Durable Object | `USER` Durable Object ledger |

Naming is not final (Points/Gold vs chips/diamonds/tokens) — easy to change, no architectural impact.

## Architecture

### 1. The ledger (`USER` Durable Object)

The `USER` DO already persists a per-username `UserProfile` (stats, games, ownedRooms). Add an append-only token ledger:

```ts
type LedgerTx = {
  token: string;      // "gold" today; future: "credit", "premium", ...
  delta: number;      // signed; negative deltas allowed (day-one "credit card")
  reason: string;     // "mint:cashout" | "spend:buyin" | "fee:interest" | "grant:topup" | ...
  ts: number;
  ref?: string;       // optional: room path / game id for audit
};
// On UserProfile:
ledger: LedgerTx[];   // append-only, capped (e.g. last 500)
```

- **Balance of a token = sum of its deltas.** A helper `balance(profile, token)` computes it.
- **Negative balances are allowed** — this is the day-one credit card. No interest/fees yet (a future cron appends `fee:interest` rows).
- Append-only = the audit trail + anti-cheat record. Every change has a server-known reason.

New `USER` DO routes (server-internal; reached via the existing `env.USER` stub pattern):
- `POST /ledger/append` `{ token, delta, reason, ref }` → appends, returns new balance.
- Balance is also included in the `GET` profile response (`gold` convenience field = `balance(profile,"gold")`).

### 2. Points (in-game, server-authoritative)

The **current payout rules become Points**, owned by the `ROOM` DO. A new shared pure module (e.g. `src/economy.ts`) ports the existing math so server and client agree:

- Per accepted guess: `base = newGreens*100 + newYellows*50`, then `total = round(base * comboMultiplier(discoveries))` where `comboMultiplier` is the existing curve (2→1.5×…5→3×). "New" = first-time discoveries, derived from the guess sequence + answer (port `orderedDiscoveriesInLast`).
- Solve bonus: `500 + 300 * guessesLeft`.
- Wasted-letter penalty: reusing a known-dead letter drains per letter (base 50, escalating per repeat, capped 200/guess) — port `wastedDeadLettersInLast` + `escalatedPenalty`.
- Constants come from the shared module (today's `GOLD` table, renamed to `POINTS`).

The `ROOM` already has each player's accepted guesses + the answer, so it computes Points authoritatively. **Points live in room/game state** (per player, per round) — they reset each game and are not persisted to the ledger.

Add per-player `points: number` to the room's `PlayerState`, included in the snapshot so the HUD reads the server value.

### 3. Power-up spends (server-enforced)

Today `onRevealLetter` / `onVowelCount` grant the power-up without any cost check (cost is a client-side `localStorage` drain). That makes the "ceiling" meaningless. Change:

- The `ROOM` deducts the cost from the player's in-game `points` **before** granting, and **rejects** (error message) if points can't cover it.
- Costs come from the shared module (`POINTS.revealCost`, `POINTS.vowelCost`).
- Snapshot reflects the reduced points so all clients see it.

### 4. Gold minting (at cash-out)

On game `finished`, the `ROOM` converts the player's final Points to Gold via a milestone curve (`goldFromPoints(points)` in the shared module) and appends `mint:cashout` to that player's `USER` ledger (`ROOM` → `USER` stub). The chosen model is **end-of-game conversion** (clean, matches freeze-out "cash out at the end"). *Alternative considered:* mid-game milestone minting (gold feels live) — rejected for day one as more complex; revisit if desired.

### 5. Client = display only

- HUD reads the server values: **Points** from the room snapshot (per-player), **Gold** from the `USER` profile (fetched on join / refreshed at cash-out).
- The existing coin-rain / hacklog / count-up animations stay — they now animate **Points** earning during a game (driven by the snapshot delta) and a **Gold** cash-out flourish at game end.
- `localStorage` gold is **removed as a source of truth**. It may remain only as a transient display cache; the server value always wins on the next snapshot/profile read.

### 6. Migration / the 1,738 fix

- **Reset everyone to 0 Gold server-side.** `localStorage` balances are not imported (they were never trustworthy). First server read of any account = empty ledger = 0 gold.
- The client clears/ignores the old `wordul.gold` authority.

## Data flow

```
Guess  ──► ROOM validates + scores ──► computes Points (economy.ts) ──► snapshot.players[].points
Power-up ► ROOM checks points ≥ cost ─► deduct points (or reject) ──► grant + snapshot
Finish ──► ROOM goldFromPoints(points) ─► USER /ledger/append {gold, mint:cashout} ─► new balance
Client ──► renders Points (snapshot) + Gold (profile); animations are pure presentation
```

## Message / type changes

- `PlayerState += points: number` (room snapshot).
- `ServerMessage`: power-up rejection reuses the existing `error` message ("not enough points").
- `UserProfile += ledger: LedgerTx[]`; `GET` profile response includes computed `gold`.
- New internal `USER` route `POST /ledger/append`.
- Client `gold.js`/`edition.js`: gold getters/setters read the server value; payout/animation functions operate on Points; remove `localStorage` gold as authority.

## Testing

**Unit (shared `economy.ts`, pure):**
- `pointsForGuess` / discovery ordering: greens, yellows, combo multipliers, duplicate-letter safety.
- Solve bonus + speed bonus.
- Wasted-letter penalty: base, escalation, per-guess cap.
- `goldFromPoints` milestone curve.
- `balance()` over a ledger including negative deltas (debt) and append integrity.

**Integration (WS, against `wrangler dev`):**
- Earning: play a game, confirm Points accrue in snapshots and Gold is appended to the `USER` ledger at finish.
- Anti-cheat: a client that lies about its balance cannot change the `USER` ledger; the banked Gold equals the server recomputation.
- Spend enforcement: a power-up is rejected when in-game Points can't afford it; accepted (and deducted) when they can.
- Per-account: a fresh username starts at 0 Gold regardless of browser `localStorage`.

## Open tuning (not blockers)

- `goldFromPoints` curve / conversion rate.
- Points constants (currently green 100 / yellow 50 / solve 500 / speed 300/guess; reveal 4000 / vowel 200) — may rescale now that Points are per-game and reset.
- Ledger cap size.

## Future hooks (ledger-ready, no work here)

- `spend:buyin` (Spec 2 buy-ins/freeze-out), `fee:interest` (debt cron), `grant:topup` (real-money IAP, one-way only — no cash-out), additional `token` values (premium currency, crypto-as-utility). **Cash-out stays closed** to avoid gambling/regulatory exposure; debt stays 100% virtual (no real money clears it).
