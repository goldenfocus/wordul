# Daily finish ritual: supernova settlement, ÷9 mint, in-card leaderboard, replay popups

**Date:** 2026-06-06 · **Status:** approved · **Surface:** daily ("Wordul of the Day") finish screen

## Problem

Finishing the daily feels flat compared to Duel/Arena:

1. No settlement ritual — races get the full-screen supernova (`public/settle.js`); the daily
   gets a quiet coin rain that (per user report on 2026-06-06) sometimes doesn't fire at all,
   because it hangs off a client-side cash-out gate rather than a server push.
2. Gold feels stingy — score gold is `points÷100`, so a 2,300-point combo-heavy game mints
   23 gold next to a flat 100 daily bonus. Combos pump points but barely move gold.
3. The golden "AND THE WORD IS" card shows only the player's own result + shares. The day's
   leaderboard exists (`GET /api/daily/<date>/leaderboard`) but renders only on the home
   recap card, and other-player replays are reachable only from there.

## Decisions (user-confirmed)

- **Payout boost:** daily point→gold conversion changes from ÷100 to **÷9** (score AND speed
  components). Flat `DAILY_GOLD_BONUS = 100` unchanged. Races unchanged.
- **Ritual:** the daily reuses the **race supernova settlement**, driven by a real
  server-built receipt (approach B: server receipt parity, not a client-fabricated receipt).
- **Leaderboard in card:** collapsed view = **top-3 medal rows + your row pinned**;
  "Show all (N) →" expands to the full roster with internal scroll past ~25 rows.
- **Replays:** tapping any leaderboard row opens a **modal popup** that auto-plays that
  player's board replay.

## 1. Server — daily receipt + ÷9 mint

Files: `src/economy.ts`, `src/room.ts`.

- `SettlementInput` gains optional `rate?: number` (default **100**). `settle()` computes
  `minted = max(0, round(points / rate))`. Existing callers unchanged.
- `scorePlayer()` (room.ts ~1780) replaces its ad-hoc `gold = scoreGold + DAILY_GOLD_BONUS +
  timeBonusGold` with a receipt:

  ```ts
  const DAILY_GOLD_RATE = 9;
  const timeBonusGold = elapsedMs == null ? 0 : Math.round(speedBonusPoints(elapsedMs) / DAILY_GOLD_RATE);
  const receipt = settle({
    buyIn: 0, points: player.points, mult: 1, spends: 0,
    bonus: DAILY_GOLD_BONUS + timeBonusGold, rate: DAILY_GOLD_RATE,
  });
  const gold = player.resigned ? 0 : receipt.payout;
  ```

- Ledger `parts` keep the three-way split at the new numbers:
  `score = receipt.minted`, `daily = DAILY_GOLD_BONUS`, `speed = timeBonusGold`
  (zero legs dropped; Σ parts === gold invariant holds by construction).
- **Honest-mint contract preserved:** only after the ledger write returns OK does the server
  set `player.scored`, `player.goldAwarded`, and now also `player.receipt = receipt`, then
  re-broadcasts per-socket snapshots — byte-for-byte the race pattern (room.ts ~1637-1649).
  Receipt stays ephemeral (no `storage.put`); the client's `refreshGold` fallback still
  reconciles the wallet if the DO hibernates first.
- Bots: keep computed `goldAwarded` for ranking, **no receipt** (no ritual for bots).
  Resigners: `goldAwarded = 0`, no receipt.
- Verify `snapshotFor` projects `receipt` for the owning player only (as races already
  require); if races already leak-test this, daily inherits it.

## 2. Client ritual — supernova for the daily

Files: `public/app.js`, `public/settle.js`.

- `maybeRunSettlement(msg)` (app.js ~2554): remove the `game.isDaily` early-return. The
  guard becomes `if (settlementShown) return false`. The daily's receipt-bearing snapshot
  (server-pushed after the confirmed mint) triggers the same flow races use: fetch
  `/api/user/<name>`, pin HUD to `balance − payout`, run `renderSettlement`.
- `renderSettlement(receipt, opts)` gains optional `opts.lines` — an array of
  `{ label, delta }` overriding the default `receiptLines(receipt)`. The daily passes
  **Score / Daily bonus / Speed** lines derived the honest way: `score = receipt.minted`,
  `daily = DAILY_GOLD_BONUS` (client mirror constant), `speed = payout − minted − dailyBonus`
  floored at 0 (remainder rule, same as today's `cashOutDaily`).
- `cashOutDaily` (app.js ~2593): the `awardGold` coin-rain + HUD tween is **retired for the
  daily** — the settlement owns the wallet moment. The function keeps rendering the
  `#dailyCashout` breakdown list (mirror constant updates: `round(points/9)`), and keeps the
  reduced-motion silent-snap path. Guard so settlement and cash-out never double-animate the
  HUD: if the settlement ran, cash-out only paints the list.
- `settlementShown` reset behavior already ties to round reset; the daily is one-shot per
  day so a single show per page-load is correct. Revisiting an already-finished daily later
  does NOT replay the supernova (receipt is ephemeral; the card + breakdown still render
  from `goldAwarded`).
- Reduced motion: `renderSettlement` already honors `reducedMotion` — lines + count-up only.

## 3. Leaderboard inside the golden card

Files: `public/index.html`, `public/app.js`, `public/daily-card.js` (shared row renderer),
`src/room.ts` (full-view grids), `public/locales/*.js`.

- New mount `#dailyLeaderboard` inside the `#dailyUnlock` golden card, under the mint
  breakdown (`#dailyCashout`).
- When `renderDailyUnlock` runs for a finished player, fetch
  `GET /api/daily/<date>/leaderboard?username=<me>&t=<wr.dailyToken:<date>>` and render
  **top-3 medal rows + you pinned** (rank · name · ◆gold · guesses; 💀 for resigners).
  Extract the home card's row renderer in `daily-card.js` into a shared helper both
  surfaces call — no fork.
- Footer row **"Show all (N) →"** (N = `view.total`): fetches `?full=1&t=…`, swaps in the
  full roster. List container gets `max-height` (~50vh) + `overflow-y: auto` once row count
  exceeds 25. Expanded state is per-render (collapses on next visit).
- **Server gap closed:** the `full=1` handler (room.ts ~219-253 / `fullDaily` in
  `src/leaderboard-core.ts`) now includes each player's `grid`, and `words` **only with a
  valid finisher token** — identical gate to the top-3 view, so today's answer still can't
  leak to non-finishers. Payload stays small (≤ a few hundred rows × 6 short strings).
- Non-finishers never see this card (the golden card only renders post-finish), but the
  token gate stays server-side regardless.
- New i18n keys: `daily.lbTitle`, `daily.lbShowAll`, `daily.lbYou` (en + existing locales).

## 4. Replay popup

Files: `public/app.js` (or small `public/daily-lb.js` module), `public/stamp-replay.js`,
`public/stamp-replay-core.js` (unchanged), `public/styles` additions.

- Tap / Enter / Space on a leaderboard row opens a **modal overlay**: dim scrim, centered
  card with the player's name + a stamp board built from their `grid` + `words` (letters
  when present, colors-only otherwise).
- Replay **auto-plays on open** via the existing `buildReplaySteps` → `playStampReplay`
  pipeline (fixed cadence, ~7s max; tap mid-replay snaps to final — existing behavior).
- Dismiss: click scrim, Esc, or ✕. One delegated listener on the leaderboard container
  (same pattern as `wireStampReplays`). Focus returns to the row that opened it.
- Losing boards end with the existing `flop()` head-shake.

## 5. Testing

- `economy`: `settle()` honors `rate` (default 100 unchanged); ÷9 receipt math; parts-sum
  invariant at the new rate.
- `room`/integration: daily finish attaches `receipt` only after a confirmed mint; bot and
  resigner get none; snapshot projects receipt only to its owner.
- `leaderboard-core`: full view carries `grid`; `words` present iff token valid.
- `settle-lines`: `opts.lines` override renders Score / Daily bonus / Speed.
- Client mirror: `cashOutDaily` breakdown sums to `goldAwarded` at ÷9.
- Existing replay-core tests unchanged.

## Rollout notes

- **Mixed-day caveat (accepted):** shipping mid-day means today's board ranks 127-era mints
  against ~400-era mints (ranking is gold-desc). Self-heals at the next daily.
- Economy blast radius: daily-only. Races still mint at ÷100. A strong daily now pays
  ~300-450 gold — deliberate, per user decision (\"/9\").
- No new storage, no new endpoints — one endpoint enriched, one snapshot field reused.
