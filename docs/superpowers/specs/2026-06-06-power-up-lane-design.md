# The Power-Up Lane (Vanilla vs Wild) — re-grounded design

**Date:** 2026-06-06
**Status:** Implemented + green (844 tests); ready to ship
**Supersedes:** `2026-06-05-gold-economy-two-lane-spine-design.md` (Plan 1). That spec was
written against the pre-`two-token-economy` codebase; this is the re-grounded, trimmed
version actually built.

## Why this was re-grounded

While the two-lane spine was being designed, the **secured two-token economy** shipped to
`main` (`2026-06-02-secured-two-token-economy-design.md`):

- **Points** — in-game chips, ROOM-authoritative, reset each game. Power-ups cost Points.
- **Gold** — persistent bankroll on the USER ledger, minted from Points at cash-out. During
  play the real gold wallet is **frozen** (daily even shows an ephemeral round-score and
  cashes out at the end, with daily spends *excluded*).

That invalidated the original Plan 1's **Gate B** ("Vanilla never loses gold"): the real
wallet already isn't drained during play — penalties hit Points/round-score. So Gate B was
fighting a deliberate design. Per the reconciliation decision (2026-06-06), the spine was
**trimmed to a single axis** and re-grounded on the two-token model.

## What this slice is (trimmed)

A per-room **lane** that decides whether power-ups exist:

- **Vanilla** = the fair lane, power-ups OFF.
- **Wild** = power-ups ON.

One field on the room snapshot:

```ts
type Ruleset = { powerUps: boolean };   // VANILLA={powerUps:false}, WILD={powerUps:true}
```

`Ruleset` stays an object (not a bare boolean) so the home-hub economy work can add fields
(e.g. buy-in/freeze-out) later without renaming the room property.

## What it is NOT (deliberately deferred)

- **Stakes / buy-ins / freeze-out** — owned by the home-hub economy work, defined in its own
  terms. NOT modeled here. (This is the "binary now, split later" promise, honored by
  literally shipping only the power-up axis.)
- **No gold-loss / `app.js` changes** — the round-score model already governs in-play loss.
- **Lane badge + creation-toggle UI + i18n** — a later UI plan. The server already accepts a
  dormant `hello.lane` override for when that ships.
- **Worlds coupling** — Worlds remain a future ruleset *seed* source via the existing
  `pendingRoomEdition` channel; not built here.

## Design

1. **Pure core** — `src/lane.ts` (+ browser twin `public/lane.js`, twin pattern like
   `economy.ts ↔ gold.js`): `Ruleset`, `VANILLA`/`WILD`, `laneSig` (`"p0"`/`"p1"`),
   `lanePreset`. A snapshot with no ruleset resolves to WILD (legacy = power-ups everywhere).

2. **Mode defaults** (`src/modes.ts`): each mode has a `defaultRuleset` (race → Wild) and an
   optional `lockRuleset`. Helpers: `defaultRulesetForMode`, `initialRuleset(isDaily, mode)`
   (daily → Vanilla, else mode default), `seededRuleset(mode, lane)` (explicit unlocked
   override wins, else mode default).

3. **Storage** (`src/room.ts`): `ruleset` on the room snapshot — which *is* the persisted DO
   state, so storing it also broadcasts it. Set at init; legacy rooms backfilled to
   `initialRuleset(isDaily, mode)` on restore; daily forced to Vanilla in `seedDailyIfNeeded`.

4. **Gate A** (the only gate): power-ups off in Vanilla.
   - Server: `onRevealLetter` / `onVowelCount` refuse when `!ruleset.powerUps` (after the
     existing points check — defense in depth).
   - Client: `shouldShowMagic` returns false when `!powerUpsOn(snap)` — the ✨ never renders.

5. **Self-labeling boards**: daily board HTTP responses include `lane: laneSig(...)`, with a
   defensive fallback to `initialRuleset(isDaily, mode)` so a state without a ruleset still
   labels correctly (daily → Vanilla).

## The one user-facing behavior change

**Daily loses its power-ups.** Today daily *allows* power-ups with their cost excluded
(`points = isDaily ? earned : earned - pointsSpent`). Making daily Vanilla removes the ✨
from daily entirely — the "fair flagship" thesis. This overlaps the two-token stream's daily
design and should be confirmed before shipping. Race/Arena/Duel keep power-ups (Wild).

## Mapping

| Mode | Lane | Note |
|------|------|------|
| Daily | Vanilla | fair flagship; **removes today's free daily power-ups** |
| Race / Arena / Duel | Wild | unchanged (power-ups on) |
| legacy room (no ruleset) | mode default via backfill | Race → Wild, Daily → Vanilla |

## Tests

`test/lane.test.ts`, `test/lane-client.test.js` (pure core + twin), extended
`test/modes.test.ts` (mode defaults + seed helpers) and `test/powerups.test.js` (Gate A).
Full suite: 844 passing, typecheck clean.
