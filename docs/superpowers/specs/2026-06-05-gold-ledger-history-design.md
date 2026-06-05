# Gold Ledger & History ("granular mode") — design

**Date:** 2026-06-05
**Status:** Approved design, pre-implementation
**Scope:** Read-only earnings history surfaced from the existing gold ledger, with a
per-transaction granular breakdown. No money-path change.

## Problem / opportunity

Gold is becoming a desirable resource, but players have no way to see where it came from —
the ◆ HUD shows a balance with no story behind it. The server already keeps a per-user gold
ledger (`UserProfile.ledger: LedgerTx[]`, append-only, capped 500); we just don't surface it.
Give players a **gold history** they can read, and let them **drill into each earning's parts**
(score / daily bonus / speed).

## Key facts (verified)

- `LedgerTx = { token, delta, reason, ts, ref? }` (`src/economy.ts:7`). Only two reasons are
  ever written, both positive: **`mint:cashout`** (race per-round, `room.ts:1437`) and
  **`mint:daily`** (`room.ts:1630`). Spends are paid in round-score / client localStorage and
  never debit server gold — so the ledger is **earnings-only** (decided: keep it that way).
- The daily mint already computes its components: `goldFromPoints(player.points)` (score) +
  `DAILY_GOLD_BONUS` (100) + `timeBonusGold` (`room.ts:1597-1600`) — but stores only the total.
- **The raw `ledger` already ships publicly.** `PublicProfile = Omit<UserProfile,
  "auth"|"pendingClaim"|"games">` (`account-core.ts:25`) does NOT omit `ledger`/`balances`, and
  `publicProfile()` spreads `...rest` (`account-core.ts:114-118`) — so today's
  `GET /api/user/<name>` already returns the full 500-entry ledger. This spec replaces that
  raw dump with a purpose-built trimmed `goldHistory` (payload hygiene, not a behavior change).
- Client homes: `profile.js` `renderProfile()` already renders **Rooms** + **Recent games**
  sections; `gold.js` `renderGoldHud()` paints the ◆ HUD.

## Decisions (from brainstorm)

1. **Earnings-only, read-only.** No spend debits, no money-path change.
2. **Granular = drill into parts.** Each earning shows a total by default; expandable into its
   `score / daily / speed` components. Requires storing the breakdown going forward.
3. **Placement:** a "Gold history" section on the (public) profile page **+** a tappable ◆ HUD
   that jumps there.
4. **Public visibility.** The gold history is public, consistent with the already-public profile
   and Recent games. (Owner-only gating is a possible future enhancement; not v1.)

## Design

### A. Data — one additive field

Extend `LedgerTx` with an optional breakdown:

```ts
export type LedgerPart = { label: string; delta: number };
export type LedgerTx = {
  token: string; delta: number; reason: string; ts: number;
  ref?: string; parts?: LedgerPart[];   // optional; Σ parts.delta === delta when present
};
```

Backwards-compatible: existing txs and single-component race wins have no `parts` and render
as a flat total. `POST /ledger/append` accepts `parts` and stores it verbatim (it already
stores `reason`/`ref` the same way — `user.ts:73`).

### B. Server writes the breakdown (daily only)

In the daily mint (`room.ts` `scorePlayer`, ~1597-1630), build `parts` from the components
already computed, omitting zero legs:

```ts
const scoreGold = goldFromPoints(player.points);
const parts = [
  { label: "score", delta: scoreGold },
  { label: "daily", delta: DAILY_GOLD_BONUS },
  { label: "speed", delta: timeBonusGold },
].filter((p) => p.delta > 0);
// …ledger/append body gains: parts
```

Race cash-out (`mint:cashout`) stays single-total — no `parts` (one component; the total says
it all). No mint math changes; `Σ parts === delta` for daily by construction.

### C. Expose a trimmed `goldHistory`

In `account-core.ts`: add `goldHistory` to `PublicProfile` and **omit the raw `ledger`** from
the public payload (add `ledger` to the `Omit`, replace with the trimmed projection). Pure
helper (testable):

```ts
export function goldHistory(profile: UserProfile, limit = 50): LedgerTx[] {
  return (profile.ledger ?? [])
    .filter((tx) => tx.token === "gold")
    .slice(-limit)            // last N
    .reverse();               // newest-first
}
```

`balances.gold` continues to ship as `gold` (unchanged). Result: the public profile no longer
dumps 500 mixed-token rows; it ships ≤50 newest-first gold entries with their parts.

### D. Client — profile section + tappable HUD

- **`profile-core.js`** (pure, unit-tested): `humanizeReason(reason)` —
  `mint:daily`→"Daily solve", `mint:cashout`→"Race win", fallback to a cleaned label;
  `formatLedgerRow(tx)` → `{ icon, label, date, amount, parts }`; a guard that `parts` sum to
  `delta` (drop a malformed `parts` and show the total).
- **`profile.js`**: a new **"Gold history"** `<section>` below Recent games, rendering
  `p.goldHistory`. Each row: date · 🎁/🏁 label · `+N`. A row with `parts` gets a ▸ affordance
  and is **tappable to expand** into its component lines (`score +28 · daily +100 · speed +5`).
  Empty history → a quiet "No gold earned yet — solve a daily" line.
- **`gold.js`** `renderGoldHud()`: make the ◆ HUD a button (cursor, role, aria-label) that on
  tap navigates to `/@<username>` anchored at the history (`#gold-history`). Uses the existing
  username; no-op if none.
- **i18n** (`public/locales/en.js`, English-only locale): section title, the two reason labels,
  the three part labels, the empty state.

```
Gold history
─────────────────────────────
Today    🎁 Daily solve     +133  ▸
  └ score +28 · daily +100 · speed +5
Today    🏁 Race win         +40
Jun 4    🎁 Daily solve     +112  ▸
```

## What changes

- `src/economy.ts` — `LedgerPart` type + `parts?` on `LedgerTx`.
- `src/user.ts` — `/ledger/append` reads + stores `parts`.
- `src/room.ts` — daily mint builds + sends `parts` (race cash-out unchanged).
- `src/account-core.ts` — `goldHistory()` helper; `PublicProfile` adds `goldHistory`, omits raw
  `ledger`; `publicProfile()` projects it.
- `public/profile-core.js` — `humanizeReason`, `formatLedgerRow`, parts-sum guard.
- `public/profile.js` — render the Gold history section + expand interaction.
- `public/gold.js` — tappable HUD → profile history.
- `public/style.css` — history rows + expand styling (match existing profile sections).
- `public/locales/en.js` — new strings.
- `test/` — `profile-core` + server (`goldHistory` trim/filter/order; `/ledger/append` stores
  parts; `publicProfile` no longer leaks the raw ledger and never leaks `auth`).

## Testing

- `npm test`: pure helpers (`humanizeReason`, `formatLedgerRow`, parts-sum guard,
  `goldHistory` filter/cap/reverse), and a server test asserting `publicProfile` returns
  `goldHistory` (gold-only, newest-first, ≤limit) and no longer includes the raw `ledger` or
  `auth`/`pendingClaim`.
- `npm run typecheck` — `parts?` is additive; the `Omit` change surfaces any raw-`ledger`
  reader as a type error.
- Manual: solve a daily, open `/@<me>` — the history shows the new earning; tap it to reveal
  `score / daily / speed`; tap the ◆ HUD in a room and land on the history.

## Non-goals

- No spend debits / two-sided ledger (earnings-only).
- No owner-only gating (history is public, like the rest of the profile).
- No change to balances, mint math, or the `g/y/x` solve-grid encoding.

## Build order

1. `src/economy.ts` type (`LedgerPart`, `parts?`) — foundation.
2. `src/user.ts` append accepts `parts`; `src/room.ts` daily mint sends `parts` (+ tests).
3. `src/account-core.ts` `goldHistory()` + `PublicProfile` trim (+ tests).
4. `public/profile-core.js` pure helpers (+ tests).
5. `public/profile.js` + `gold.js` + CSS + i18n.
6. Full gauntlet.
