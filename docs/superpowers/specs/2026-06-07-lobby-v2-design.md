# Lobby v2 — seats, spectators, chat-first mobile, golden ritual brief

*Spec date: 2026-06-07. One spec, two implementation plans:*
- **Plan A — mechanics** (`docs/superpowers/plans/2026-06-07-lobby-v2-mechanics.md`): capacity,
  spectators, chat-first mobile order, tables pill, structural tokens.
- **Plan B — design ritual**: run the golden-design-ritual against the brief in §4, then write a
  fresh implementation plan for the winning skin. The mechanics in Plan A do **not** wait for it.

---

## 1. Capacity model (server, `src/room.ts`)

- New **persisted** `state.capacity`, default **2** for duel rooms, range 2–6. Seeded arena rooms
  keep their own `seed.capacity`; daily/challenge unaffected. Snapshot:
  `seed?.capacity ?? state.capacity` (replaces today's `seed?.capacity ?? MAX_PLAYERS` at
  `src/room.ts:2168`).
- **Legacy migration**: rooms persisted before this change stored the ctor placeholder
  (`capacity: 8`). A *settable* capacity is always ≤ 6, so any stored value ≥ `MAX_PLAYERS` is
  legacy by construction — on restore, recompute `max(2, seated players)`. Never evicts.
- **Seats vs spectators**: *seats* = the rotation roster (2 duelists + queued — exactly today's
  KOTH model, but capped at `capacity`). A joiner beyond capacity gets a new role
  `"spectator"`: fully live — sees boards, chats — but never enters the rotation
  (never pushed to `state.queue`, so `applyKothRotation` can never seat them) and has no Ready
  (`onReady`'s `role !== "duelist"` gate already covers it). The global `MAX_PLAYERS = 8` stays
  as the **total room cap** (seats + watchers); joiner #9 still gets "room full".
- **`set_capacity` message**: **host-only, server-enforced** (`hostId` check — deliberately
  *unlike* the size settings, which stay shared-control; this is the first server-enforced
  setting gate). Lobby-phase only. Clamped to `[max(2, seated players), 6]` — **no evictions**
  (lowering only removes empty seats). Raising auto-promotes the longest-waiting spectators
  into the rotation in **join order** (`players[]` order); a promoted spectator becomes
  `queued` (or `duelist` if a duel seat is somehow open) and joins `state.queue`.
- **Open-games feed honesty**: `publishArena` stops hardcoding `seats: "1/2"` and publishes
  `${seated}/${capacity}` — which also makes the rail's `isHot` "last seat" glow real for
  bigger tables.

## 2. Seat strip becomes the capacity control (`public/lobby-view.js`, `public/app.js`)

- The strip renders **exactly `capacity` slots** (a fresh duel shows **1/2**, not 1/8 — falls
  out of the server default). Spectators are excluded from seats; they appear as a quiet
  **"+N watching"** chip after the count, not as seats.
- Host sees small **− / +** steppers beside the count (host-only, lobby-only — same `canEdit`
  pattern as the 5×6 dim control, but strictly host: the server enforces it, so no un-hosted
  fallback). Steppers send `{type:"set_capacity"}` and disable at the clamp bounds.
- **Spectator's own view**: no "you" seat in the strip, no Ready button (existing role gate),
  and a **"watching — table full"** hint where Ready was.

## 3. Mobile order (≤880px, the existing `body.lobby` single-column breakpoint)

Board → 5×6 → seats → READY → Setup·Invite → **CHAT** → **"▸ N tables open" pill**
(collapsed `#lobbyRail`; tap expands to the current list, still polling `/api/arena/open`).

Implementation: `arrangeLobbyLayout` appends **chat before rail** (mobile-first DOM order) +
a pill header on the rail. Desktop two-zone stays as-is — rail above chat in the right column
via `@media (min-width:881px) { body.lobby .lobby-rail { order: -1 } }` (flex order, one rule).
The pill count rides the existing `mountArenaList` poll via a new `onCount` callback.

## 4. Golden design ritual brief (this spec defines it; the ritual executes it)

- **Tokens first** (lands in Plan A — it's structural code, and the variants must consume it):
  a 4pt spacing scale `--space-1…6` (4/8/12/16/24/32) and one radius family
  `--r-sm/md/lg` (6/8/14) in `:root`; lobby components convert to them. This is the structural
  fix for "not harmonious" — today's lobby radii (5/6/8/14px) and gaps (6/8/10/12/14/18px) are
  ad-hoc per card. Role assignment: cards (rail, chat, dimpop, seats) = `--r-md`; small
  controls (buttons, steppers) = `--r-sm`; large surfaces = `--r-lg`.
- **Brief constraints** for the 3–4 live variants (published to `wordul.com/designs/<slug>` via
  the existing golden-design-ritual skill):
  - single primary action (**READY**);
  - one shared card surface treatment (the translucent `color-mix` + blur language);
  - consistent vertical rhythm (the token scale);
  - the floating lone ⚙ gear (`#lobbySetup`) gets **merged into the Setup button** —
    two settings entries today (`#lobbySetup` and `#lobbySetupBtn` both open `showSettings()`);
  - mobile-first at 390px with the §3 order.
- Winner becomes its own implementation plan; the mechanics above don't wait for it.

## Testing (covered task-by-task in Plan A)

- DO tests for `set_capacity` (host-gate, clamps, promote-on-raise, no-evict, lobby-only).
- Spectator role assignment + never-rotated invariant (never in `state.queue`).
- Seat-strip pure-model tests (`seatModel` with capacity + watching count + spectator viewer).
- Wiring tests for the mobile order (chat-before-rail append, desktop order rule, pill).
