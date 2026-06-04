# Living Arena — Design (v2: the arena breathes)

**Date:** 2026-06-04
**Status:** Approved (brainstorm) → ready for implementation plan
**Base:** `origin/main` (worktree `feat/living-arena`). Arena DO migration is **v6** (`Arena`); this
phase adds **no new DO and no migration** — storage-shape evolution only.
**Builds on:** `2026-06-02-arena-liquidity-bots-design.md` (v1, shipped). Read it first; this is its v2.

> **Scope:** v2 "Liveliness" only. Spectating the games and real bot-vs-bot simulation are **Phase 2
> (Spectator)**; the AI commentator + SEO is **Phase 3**. Both are explicitly out of scope here and
> sketched at the end.

---

## The complaint this fixes

> "The arena is too easy to spot bots — always 3 waiting, always 1/2."

That's not a bug; it's v1's pinned constants showing through. v1 deliberately shipped a metronome to
nail one magic moment (join → beat a bot → "You vs Maya 1–0"). It works, but it's *legible*:

- `arena-core.ts:37` `TARGET_OPEN = 3` → the index always tops up to exactly three waiting rooms.
- `arena-core.ts:16` every `SeedRec.seats` is `"1/2"` (one bot waiting).
- `arena-core.ts:15` every `wordLength` is `5`.

Three identical rooms, forever. v2 replaces every one of those constants with a **living, jittered
range**, adds **multi-bot rooms** and **churn**, and keeps the v1 magic intact via a soft floor.

---

## The one thing v2 must nail

> Open Wordul → tap **Arena** → it feels like a *place where games are happening*: a few rooms with
> different sizes (`1/2`, `2/3`, `4/5`) and word lengths trickle in over a few seconds; one you were
> eyeing vanishes (it started or expired); sometimes you land almost alone and watch it fill. You tap
> one and race **two or three** little characters — and still win.

If a change doesn't make the arena read as *alive and unpredictable while staying winnable*, it's not
v2.

---

## Two product decisions (set this brainstorm)

1. **Soft floor, not a hard guarantee.** The arena genuinely breathes — sometimes you land to a
   near-empty room that fills over 3–24s. It is made safe (never a dead-end) by a **"Play now"
   escape hatch** that always mints+joins an instant beatable game, regardless of arena state.
2. **Length variety must stay winnable.** Show the full length range for atmosphere, but **scale the
   noob bot's fallibility by word length** so a room a human actually *joins* is always beatable —
   without ever breaking the solver's blindness.

These honor v1's two invariants (disguise + beatability) rather than relax them.

---

## Goals (v2)

- **Breathing room count** — a drifting target in `[1, ~6]` instead of a constant `3`, on jittered
  timers so rooms appear/disappear over seconds, not in lockstep.
- **Seat variety** — multi-bot rooms so the index reads `1/2`, `2/3`, `1/3`, `4/5`, `3/4`…
- **Length variety** — a weighted spread (4–6 common, 7–9 rarer), every joinable room winnable.
- **Multi-bot races** — joining an N-seat room races several noob bots, "first to guess wins" intact.
- **Churn** — rooms expire on jittered lifetimes; some waiting rooms **self-start** ("its bots started
  without you") and leave the joinable list.
- **Soft floor + Play-now** — never a dead arena.
- **Beatability by length** — `noob.ts` fumbles harder at longer words, staying structurally blind.
- **Disguise integrity preserved** across the N-bot and in-progress cases.

## Non-goals (v2) — deferred, do not build

- **Spectating** any game (read-only viewer, all-boards live, guess-replay timeline) → **Phase 2**.
- **Real bot-vs-bot simulation** (two noob loops actually playing a watchable game) → **Phase 2**.
  v2's self-start is a *lightweight phase flip*, not a simulated match (see §4).
- **AI commentator / live game-log / SEO content** → **Phase 3**.
- A tuning-config surface for the ranges — v2 uses code constants (a v3 knob).
- Human-hosted public rooms entering the index (v1's deferred item, still deferred).

---

## Architecture — what moves, what stays

Nothing new in the topology. Same three actors as v1; the change is **where randomness lives** and a
richer `SeedRec`.

```
ARENA DO (src/arena.ts)            ← all randomness + scheduling lives HERE
  • drifting desiredOpen ∈ [MIN,MAX]   (Math.random / Date.now, never in -core)
  • jittered spawn timers, randomized lifetimes, self-start rolls
  • picks N distinct personas for multi-bot rooms
        │  seeds rooms (POST /seed, now k bots + capacity)
        ▼
ROOM DO (src/room.ts)              ← k waiting bots; N-player fill-and-countdown start
        │  GET /api/arena/open (+ phase, seat info)
        ▼
Arena tab (public/hub.js + arena-panel.js)
  • varied rows + in-progress strip + "Play now" hatch + light poll

arena-core.ts  ← stays PURE: reducer + projections + new injected-roll helpers
                 (rollSpawn, driftTarget, …) — same pattern as noobGuess(view, profile, roll)
```

**Determinism discipline (load-bearing):** `arena-core.ts` must stay free of `Math.random` /
`Date.now` so it runs under plain Vitest. Every new decision (how many rooms to want, what capacity /
length to roll, when to self-start) is a **pure function taking an injected roll**; `arena.ts` is the
only place that supplies `Math.random()`/`Date.now()`. This mirrors `noobGuess(view, profile, roll)`
and `pickPersona(seedCount, openIds)` exactly.

---

## Components (purpose · interface · depends on)

### 1. `arena-core.ts` — richer record + pure roll helpers (extend)

- **Purpose:** carry seat/length/lifetime/phase per seed and decide spawn shape deterministically.
- **`SeedRec` gains:**
  ```ts
  capacity: number;     // total seats, 2..5
  botCount: number;     // bots currently seeded (≤ capacity-1, always ≥1 open seat while waiting)
  lifetimeMs: number;   // jittered expiry budget FROM mint (replaces the fixed MAX_OPEN_MS for seeds)
  phase: "waiting" | "playing";  // "playing" = self-started, off the joinable list
  // seats becomes DERIVED: `${botCount}/${capacity}` while waiting
  // wordLength: now varies (see rollSpawn) instead of pinned 5
  ```
- **`OpenGame` projection gains** `capacity`, `botCount`, `phase` (still zero internal fields — no
  `mintedAt`, `status`, `personaId`, `lifetimeMs`). `openGames()` returns `phase: "waiting"` rows;
  in-progress rows surface via a separate `inProgressGames()` projection (count + minimal display).
- **New pure helpers (all take injected rolls — unit-tested with fixed values):**
  - `driftTarget(current: number, roll: number): number` — random-walk `desiredOpen` ±1 within
    `[ARENA_MIN_OPEN, ARENA_MAX_OPEN]`. Tide, not sawtooth.
  - `rollSpawn(rolls): { capacity, botCount, wordLength, lifetimeMs }` — capacity ∈ {2,3,4,5}
    (weighted toward small), `botCount` ∈ `[1, capacity-1]`, `wordLength` from the weighted length
    table, `lifetimeMs` jittered in `[LIFETIME_MIN, LIFETIME_MAX]`.
  - `shouldSelfStart(rec, roll): boolean` — only multi-bot (`botCount ≥ 2`) waiting rooms are
    eligible; small per-tick probability flips `waiting → playing`.
- **Reducer (`apply`) extends** with the new `phase` (a `selfstart` event flips an existing
  `registered` rec to `phase:"playing"`; a `playing` rec is closed/pruned on its own timer). `prune`
  uses per-rec `lifetimeMs` instead of the global `MAX_OPEN_MS` for seeds.
- **Constants:** add `ARENA_MIN_OPEN=1`, `ARENA_MAX_OPEN=6`, `LIFETIME_MIN≈30_000`,
  `LIFETIME_MAX≈120_000`, a `CAPACITY_WEIGHTS` table, a `LENGTH_WEIGHTS` table, `SELFSTART_P`.
  Keep `MAX_SEEDED` as the hard runaway cap. `TARGET_OPEN` stays until `driftTarget` is wired into
  the DO (build step 3), then retire it — removing it earlier would break the still-old DO seed loop.
- **Depends on:** nothing new (pure).

### 2. `arena.ts` DO — drift, jitter, multi-persona, self-start (extend)

- **Purpose:** supply the randomness and scheduling `-core` deliberately doesn't have.
- **Seeding tick (`alarm`)** now:
  - read/persist `desiredOpen`, advance it via `driftTarget(desiredOpen, Math.random())`;
  - while `liveCount < desiredOpen` and `< MAX_SEEDED`: `rollSpawn` a shape, `pickPersonas(n)` for
    `botCount` **distinct** personas (extends `pickPersona`; uniqueness across the whole arena),
    mint a unique-path room, `POST /seed` it with `{ personas[], profile, edition, wordLength,
    capacity }`;
  - roll `shouldSelfStart` for each eligible multi-bot waiting rec → flip to `playing`;
  - prune via per-rec `lifetimeMs`; reschedule the **next tick on a jittered delay** (not a fixed
    interval) so spawns feel staggered rather than batched.
- **Lazy bootstrap** (v1 behavior) stays: `GET /open` ensures a pending alarm + kicks a best-effort
  seed so a cold/just-deployed DO never serves empty.
- **Depends on:** `arena-core` helpers, `bots.pickPersonas`, `ROOM` namespace.

### 3. `bots.ts` — multi-persona pick (extend)

- **Purpose:** draw `n` distinct personas for a multi-bot room without collisions.
- **`pickPersonas(seedCount, n, openPersonaIds): BotPersona[]`** — walks the roster from `seedCount`,
  skipping any already-open persona, returning up to `n` distinct ones (fewer if the roster's
  exhausted → caps that room's `botCount`). Deterministic; `pickPersona` becomes the `n=1` case.
- **Roster note:** v1's 7 personas may be thin for `4/5` rooms across many concurrent games. Flag for
  the owner: either accept smaller max capacities when the roster is tight, or grow the roster. The
  picker degrades gracefully (returns fewer) either way — no crash, just smaller rooms.
- **`projectPlayerForClient` unchanged** — the single disguise chokepoint; it already strips `isBot`
  for any number of bots.

### 4. `room.ts` — k-bot seed + N-player start + light self-start (extend)

- **Purpose:** hold `k` waiting bots and start an N-player race when a human joins.
- **`POST /seed`** accepts `personas[]` + `capacity`; generalized `ensureBot` seeds **each** persona
  as a waiting player (human name+avatar, no `🤖 powered on` line). Lobby shows `k/capacity`.
- **Auto-start on human join (generalize v1's 2/2):** when a human's `hello` brings the room to
  `≥2` players, run a short **fill-and-countdown** (~2s): top any remaining empty seats with fresh
  distinct bots (`pickPersonas`) up to `capacity`, then run the startable core
  (word-pick → `lobby→playing` → `scheduleBotTick` for each bot). Result: human races `capacity-1`
  noob bots.
- **Self-start (light, Phase-1 scope):** when ARENA flips a seed to `phase:"playing"`, the room is
  **not** required to run a real bot-vs-bot match in v2. It simply reports itself off the joinable
  list (`POST /close` or a `playing` status) and is pruned on its lifetime. **Phase 2 replaces this
  flip with a real, watchable bot-vs-bot simulation** — same trigger, richer body. No throwaway work:
  v2 builds the *state and churn*, Phase 2 fills in the *match*.
- **Per-bot scheduling:** `scheduleBotTick` already runs one bot via alarm; N bots share the alarm
  loop (each computes its own `noobGuess` on its own jittered cadence). Cap concurrent ticking bots by
  `capacity ≤ 5` and `MAX_SEEDED`.
- **`robots` room unchanged** (clanker stays labeled + sharp via `computeNextGuess`).

### 5. `noob.ts` — fallibility scales with length (extend)

- **Purpose:** keep longer-word joinable rooms winnable.
- **`mistakeRateFor(length: number): number`** — ramps `mistakeRate` up with length (e.g. 4–5 near
  today's 0.4; 7–9 higher) so the bot wastes more guesses on hard words. `NOOB` becomes a base; the
  room passes `mistakeRateFor(wordLength)` into `noobGuess`.
- **Blindness preserved:** still wraps `computeNextGuess`, still honors greens, still imports nothing
  that exposes the answer. `test/noob.test.ts`'s src-reading guard stays green.

### 6. Arena tab UI — `public/hub.js` + `public/arena-panel.js` + `style.css` (extend)

- **Purpose:** render the living arena.
- Render `OpenGame` rows with **varied** `botCount/capacity` and `wordLength` (glass rows, no pills,
  per the existing Glass Aurora language). Show a subtle **in-progress strip** (count or muted rows)
  from `inProgressGames()` — **non-tappable in v2** ("in progress"; becomes "Watch" in Phase 2).
- **"Play now" escape hatch:** an always-present control that mints+joins an instant beatable game
  (reuse the seed+join path; friendly 5-letter, single noob bot). This is what makes the soft floor
  safe.
- Keep v1's **light poll** while the tab is open so rooms trickle in, fill, vanish, and start **live**.
  Empty/loading/error states already handled — never a blank panel; the soft floor may briefly show
  "warming up…" with Play-now beneath it.

---

## Disguise integrity (unchanged invariant, wider surface)

The opponent reads as a person across every channel — now for **N** bots per room and for in-progress
rooms. The single chokepoint is still `projectPlayerForClient` (strips `isBot`); v2 adds a test that a
**multi-bot** snapshot leaks no `isBot` for *any* player, and that an in-progress seed exposes no seed
metadata. Accepted soft tell from v1 (H2H presence implies a bot) is unchanged.

## Fairness invariant (unchanged, load-bearing)

The bot never sees the answer. Length-scaling makes it play *worse* at long words, never makes it
*peek*. `solver.ts` and `noob.ts` both take only `BotView`; the src-reading test guards it.

---

## Data flow (end to end)

1. **Tick:** `ARENA.alarm()` drifts `desiredOpen`; while under it, `rollSpawn` a shape, `pickPersonas`
   the bots, mint a unique-path room, `POST /seed` (k bots, capacity, varied length). Room
   `POST /open` (registered). Some eligible multi-bot rooms roll `shouldSelfStart` → `phase:"playing"`
   → drop from joinable. Prune by per-rec lifetime. Reschedule on a jittered delay.
2. **Browse:** human opens Arena → `GET /api/arena/open` → varied waiting rows + in-progress strip.
   Soft floor may show a near-empty arena that fills over the next polls. **Play now** always offered.
3. **Join:** tap a `2/4` row → normal WS `hello` → room 3/4 → fill-and-countdown tops to 4/4 with
   bots → auto-start. Room `POST /close`.
4. **Play:** human races `capacity-1` noob bots, each via `noobGuess(view, mistakeRateFor(len), roll)`.
5. **Finish:** existing finish flow; game record `→ USER /append`, H2H `→ USER /h2h` per persona
   beaten.
6. **Restock:** the closed/expired/self-started rec drops `liveCount`; next tick re-mints toward the
   (drifted) target at a fresh unique path.

---

## Error handling & silent-failure guards

- **Index never lies:** unchanged — room owns create→register→close; ARENA prunes per-rec lifetime
  each tick; a row that 404s on join → UI removes + refreshes. Self-started/`playing` rows are
  non-tappable, so they can't dead-end a join in v2.
- **Soft floor is never a dead end:** Play-now guarantees an instant game even at `liveCount=0`.
- **Seeding capped:** `MAX_SEEDED` hard cap survives the dynamic target; `driftTarget` is clamped to
  `[MIN, MAX]` so a runaway roll can't push past it.
- **Roster exhaustion:** `pickPersonas` returns fewer than requested → that room just has a smaller
  `botCount`; never crashes, never duplicates a persona.
- **Disguise leak = test failure:** multi-bot snapshot projection asserted clean.

---

## Testing (pure units first — repo Vitest style)

- `arena-core`: `driftTarget` stays in `[MIN,MAX]` and steps ±1; `rollSpawn` honors capacity/botCount
  bounds (`1 ≤ botCount ≤ capacity-1`), the length table, and lifetime bounds, all under injected
  rolls; reducer covers the new `selfstart` transition and `playing` prune-by-lifetime; `openGames`
  returns only `waiting`, `inProgressGames` only `playing`; projections still omit internal fields.
- `bots`: `pickPersonas` returns `n` distinct, skips open personas, degrades to fewer when exhausted,
  never duplicates; `pickPersona` still the `n=1` case.
- `noob`: `mistakeRateFor` is monotonic-ish in length and bounded `[0,1)`; `noobGuess` still never
  returns an illegal-length word and never references the answer (src-reading guard).
- Disguise: a **multi-bot** client-facing snapshot contains no `isBot` for any player; in-progress
  seed exposes no seed metadata.
- Smoke (manual): open Arena repeatedly → counts/seats/lengths visibly vary, rooms appear/expire/start
  live; join a multi-seat room → race several bots → still winnable; Play-now works at empty arena;
  kill a waiting room mid-wait → its row drops within its lifetime (no ghost).

---

## Deploy / migration

- **No new DO, no new migration.** ARENA already exists at **v6** (`new_sqlite_classes: ["Arena"]`,
  confirmed in `wrangler.jsonc`). v2 only evolves the `SeedRec`/`ArenaState` shape — use the existing
  self-healing default pattern (`load()` backfills missing fields) so old persisted seeds upgrade
  cleanly. Confirm the max tag at implement time; do **not** add a tag.
- **Prod-is-dev / colony protocol:** the Arena tab is already publicly live. Every green step must keep
  disguise + beatability intact. Ship the invisible pieces first; the only user-visible flips are
  variety (safe) and Play-now (safe). Follow `COLONY.md`: `git fetch && rebase origin/main` →
  `typecheck && test` → push `HEAD:main` → `deploy` from the freshly-rebased tree → log the lane.

---

## Suggested build sequence (for the plan)

1. **`noob.ts` length-scaling** + tests. Invisible; locks the beatability floor before any length
   variety ships.
2. **`arena-core.ts`** — extend `SeedRec`/`OpenGame`, add `driftTarget`/`rollSpawn`/`shouldSelfStart`
   + `pickPersonas` contract + reducer `selfstart`/lifetime-prune + constants + tests. Pure, no
   behavior change yet (DO still seeds the old way).
3. **`arena.ts` DO** — drifting target, jittered spawns, multi-persona seeding, randomized lifetimes,
   self-start flips. Verify via `/api/arena/open` that counts/seats/lengths vary and rooms
   appear/expire/start. (Length variety + multi-bot now reach prod — beatability already handled by
   step 1.)
4. **`room.ts`** — k-bot `/seed`, N-player fill-and-countdown start, light self-start reporting.
   Verify a multi-seat join is a winnable N-bot race.
5. **Arena UI** (`hub.js`/`arena-panel.js`) — varied rows, in-progress strip (non-tappable),
   **Play now** hatch, keep light poll. Verify the full living-arena feel end-to-end.
6. **Tune** ranges/jitter/weights/`mistakeRateFor` against the live arena.

---

## Deferred (the shape of later phases)

- **Phase 2 — Spectator:** turn the self-start flip into a **real bot-vs-bot simulation** (two+ noob
  loops on the shared alarm), and add a **read-only viewer**: drop into any `playing` room, see every
  player's board live + a **replay timeline of each guess** they entered, so one observer truly
  understands the game. In-progress rows become **"Watch"**.
- **Phase 3 — AI commentator:** narrate games (live + finished) into game-logs and **SEO content**,
  feeding the word-wiki / discoverability push. Hangs off the existing room `history` + per-game
  records.
- **v3 knobs:** a real frequency/range tuning surface; skill **levels** (more `noob` profiles biased
  toward a target human win-rate); backfill (drop a bot into a human who's waited alone too long).
