# Arena Liquidity Bots — Design (v1: Living Arena + Characters)

**Date:** 2026-06-02
**Status:** Approved (brainstorm) → ready for implementation plan
**Scope:** v1 only. v2/v3 sketched at the end, explicitly out of scope here.

---

## The one magic moment v1 must nail

> Open Wordul → tap **Arena** → see a game waiting (`1/2`) → join → race a beatable
> little character → win → see **"You vs Maya: 1–0."**

Every component below exists only to produce that moment. If a piece doesn't serve it, it's v2.

---

## Why (the bet)

A live word-race is dead on arrival if you join and nobody's there — the cold-start /
liquidity problem. v1 solves it the lean way: the Arena is **silently seeded with bots** so a
human always has someone to play *instantly*.

Two product decisions set by Yan that the design must honor:

1. **Disguised as humans.** Players are not told the opponent is a bot. The disguise is a hard
   requirement, not a nicety — and it's only ever as good as the bot's *play* and the *absence
   of tells* in the UI.
2. **Soul + memory from day 1, skill from v0.** Each bot is a persistent **character** (name,
   face, personality) that **remembers you** (head-to-head record). The *only* thing that starts
   crude is the **skill**: slow, fumbling, beatable. Skill levels come later (v3).

---

## Goals (v1)

- An **Open-Games index**: the authoritative, never-stale list of rooms waiting for a player.
- An **Arena tab** that renders that list and lets you join with one tap.
- **Bot seeding** that keeps ~N waiting bot-rooms alive so the Arena is never empty.
- A small **bot roster** of hand-authored characters (name · face · voice = soul).
- A **noob skill profile** — one degraded, beatable way of playing, built *without* breaking the
  solver's blindness.
- **H2H memory** — per-`(human, bot)` win/loss, stored on the human's USER record, shown in UI.
- **Disguise integrity** — no channel (snapshot, chat, name, avatar) leaks that the opponent is a bot.

## Non-goals (v1) — deferred, do not build

- Bot-vs-bot ambient matches (v2).
- Backfill: dropping a bot into a human who's waited alone too long (v2).
- A frequency/tuning config dial as a real surface (v2 — v1 uses a code constant).
- Skill **levels** / a difficulty ladder (v3). v1 ships exactly one noob profile.
- Online-**players** presence list (v3). v1 lists open *games* only.
- Rivalry arcs, leaderboard presence for bots (v3).

---

## Architecture overview

```
                 ┌──────────────────────────────────────────────┐
                 │  ARENA  (new coordinator Durable Object)       │
                 │  • owns the Open-Games index (authoritative)   │
                 │  • seeding alarm: keep ~N waiting bot-rooms     │
                 │  • picks personas from the roster              │
                 └───────────────┬───────────────▲───────────────┘
       seeds rooms (idFromName)  │               │  room reports open/closed
                                 ▼               │
                 ┌──────────────────────────────────────────────┐
                 │  ROOM DO (existing)                            │
                 │  • seeded room: 1 bot waiting in lobby (1/2)   │
                 │  • auto-starts when a human joins (2/2)        │
                 │  • bot plays via alarm heartbeat (noob profile)│
                 │  • on game end → writes H2H to human USER DO   │
                 └───────────────┬───────────────▲───────────────┘
            GET /api/arena/open  │               │  tap a row → join room path
                                 ▼               │
                 ┌──────────────────────────────────────────────┐
                 │  Arena tab (public/hub.js + worker route)      │
                 │  • renders waiting games, tap to join          │
                 └──────────────────────────────────────────────┘
```

**Why a coordinator DO and not KV + Cron:** the index must never lie (a "ghost" waiting game a
human taps and finds empty is the core failure mode). A single `ARENA` DO is the one authoritative
owner of the full lifecycle of every bot-room it mints (create → register → sweep), so the list
can't drift from reality. KV is eventually-consistent and would invite exactly that drift. The
`ARENA` DO also reuses the **alarm heartbeat** the bot already runs (`room.ts:488–512`) for its
seeding tick — no new concurrency primitive.

---

## Components (each an isolated unit: purpose · interface · depends on)

### 1. `ARENA` coordinator Durable Object — **new** (`src/arena.ts`)

- **Purpose:** own the Open-Games index and keep the Arena stocked.
- **Interface (HTTP, DO-internal + one public-facing via worker):**
  - `GET /open` → `OpenGame[]` (the list the Arena UI renders).
  - `POST /open` `{ path, name, edition, wordLength, seats }` → register/refresh a waiting room.
  - `POST /close` `{ path }` → remove a room from the index (room filled, started, or swept).
  - `alarm()` → seeding tick: count open bot-rooms; if `< TARGET_OPEN`, mint more; prune stale.
- **State (single KV-style blob, matching the codebase convention):**
  `{ open: Record<path, OpenGame>, seededPaths: string[] }`.
- **Singleton addressing:** `env.ARENA.idFromName("arena")` — one instance, the global coordinator.
- **Depends on:** `ROOM` namespace (to mint/seed rooms), the bot roster, `DIRECTORY` (optional, for
  naming uniqueness).

### 2. Open-Games index (data, lives inside `ARENA` DO storage)

- **Purpose:** the authoritative "what's joinable right now."
- **`OpenGame`** shape:
  ```ts
  type OpenGame = {
    path: string;        // "<owner>/<slug>" room key to join
    name: string;        // display name of the room
    host: string;        // the waiting player's username (a persona name — looks human)
    edition: string;     // theme id (for a themed row)
    wordLength: number;  // 4–12
    seats: string;       // "1/2"
    seededAt: number;    // for staleness pruning
  };
  ```
- **Staleness rule:** the seeding alarm prunes any seeded entry older than `STALE_MS` that the
  room never confirmed as live — belt-and-suspenders against a room that crashed before reporting.
- **v1 index = bot-seeded rooms only.** Real human-created waiting rooms registering into the same
  index (humans finding humans) is a cheap, room-source-agnostic extension — but it's **v2**. v1's
  only join path is human-joins-bot, matching the intended first-run experience.

### 3. Worker routes (`src/worker.ts`)

- **Purpose:** expose the index to the browser and nothing more.
- `GET /api/arena/open` → proxies `ARENA./open`, returns `OpenGame[]` JSON.
- Join needs **no new route**: a row's `path` is an ordinary `<owner>/<slug>`; tapping it navigates
  to the existing room URL and the normal WebSocket join runs. (This is why the disguise is free at
  join time — the client experiences a plain room.)

### 4. Arena tab UI (`public/hub.js`, `public/index.html`, `public/style.css`)

- **Purpose:** replace the stub (`hub.js:47`) with a live list.
- Fetch `GET /api/arena/open`, render each `OpenGame` as a **glass** row (per the no-pills Glass
  Aurora language — zero pills/chips): host name + avatar, edition tint, `wordLength`, `1/2 waiting`.
- Tap → navigate to `path`. Empty/loading/error states handled (never a blank panel).
- Light polling/refresh while the tab is open (e.g. every few seconds) so rows appear/disappear live.

### 5. Bot rooms — generalize the existing bot (`src/room.ts`)

Today `ensureBot()` only fires for `slug === ROBOT_SLUG`. v1 generalizes:

- **Seed marker:** rooms minted by `ARENA` carry a flag (e.g. `seed: { persona, profile }` on room
  state, set at init). `ensureBot()` fires for seeded rooms too, adding **that persona** as the
  waiting player (human name, not "clanker").
- **Auto-start:** a seeded room has no human host to click *Start*. When the human joins (2/2), the
  room transitions `lobby → playing` automatically (existing word-pick path).
- **Report to ARENA:** on entering lobby as a seeded waiting room → `POST ARENA./open`. On the human
  joining / starting / finishing → `POST ARENA./close`. Room owns its own index truthfulness.
- The existing **`robots` room keeps working unchanged** (labeled clanker, not disguised).

### 6. Bot roster (`src/bots.ts` — **new**, pure data + selection)

- **Purpose:** the cast of characters. Hand-authored, in code (leanest — no DB).
- **`BotPersona`** shape:
  ```ts
  type BotPersona = {
    id: string;          // stable key for H2H memory
    name: string;        // human-looking display name ("Maya", "Theo", …)
    avatar: string;      // emoji or asset id — human, not robotic
    edition: string;     // which soul/voice/theme this character wears
    blurb: string;       // one-line personality (for future surfacing)
  };
  ```
- v1: ~6–8 personas. **Soul = reuse the existing edition/companion/voice system**
  (`public/edition.js`, `companion.js`, `voice/`) — a persona is bound to an edition and speaks its
  lines. No new voice work in v1.
- Pure `pickPersona()` selection (deterministic-testable; vary by seed/index, never `Math.random`
  at module load).

### 7. Noob skill profile (`src/noob.ts` — **new**, and it stays BLIND)

> **SACRED INVARIANT preserved:** `solver.ts` must remain structurally incapable of seeing the
> answer. Degradation does **not** touch that blindness — it wraps the blind solver and only ever
> chooses among *legal guesses*, never by reading the word.

- **Purpose:** make the bot play like a slow, fallible human.
- **Interface:** `noobGuess(view: BotView, profile): string` — same `BotView` the solver gets
  (`{ wordLength, ownGuesses }`). It calls `computeNextGuess` for the "smart" line, then degrades:
  - **Mistakes:** with probability `p`, return a *plausible but sub-optimal* legal word instead of
    the constraint-best (e.g. honor greens so it doesn't look insane, but ignore a yellow/gray →
    a believable human slip that wastes a guess).
  - **Pacing:** slower alarm delays than clanker's 6–12s / 4–10s (reuse `scheduleBotTick`, widen).
- v1 ships **one** profile (`NOOB`). Levels (v3) become more profiles + a picker. The *mechanism*
  is in place; the *ladder* is not built.
- Wired in at `room.ts` `alarm()`: seeded rooms call `noobGuess(...)`; the `robots` room keeps
  calling `computeNextGuess(...)` directly (clanker stays sharp-ish).

### 8. H2H memory (`src/user.ts` + UI)

- **Purpose:** "You vs Maya: 3–1" — the day-1 soul-and-memory promise, leanest form.
- **Storage:** extend `UserProfile` with `h2h?: Record<personaId, { w: number; l: number }>`
  (self-healing default `{}`, matching the existing `load()` backfill pattern).
- **Endpoint:** `POST /h2h` `{ personaId, result: "w" | "l" }` on the USER DO — increment.
  ⚠️ **Routing footgun:** the USER DO matches paths with `url.pathname.endsWith(...)`. A recent
  incident had `/ledger/append` silently swallowed by `endsWith("/append")`, breaking all gold
  minting. `/h2h` doesn't collide today, but add it as a distinct, non-overlapping suffix and keep
  the most specific matches first — never introduce a path that another route's `endsWith` can shadow.
- **Write path:** when a seeded room finishes, it reports the human's result vs the persona to the
  human's USER DO (alongside the existing game-record `/append`).
- **Surface:** the Arena row and/or the in-room header shows the standing record when the human has
  history with that persona ("You vs Maya 3–1"); first encounter shows nothing special (or a quiet
  "new face").

---

## Disguise integrity (a first-class requirement, not an afterthought)

The opponent must read as a person across **every** channel. v1 must close all client-visible tells:

| Channel | Tell today | v1 fix |
|---|---|---|
| Snapshot | `PlayerState.isBot` is sent to clients (`types.ts:36`, in `RoomSnapshot.players`) | **Strip `isBot`** (and any seed metadata) from the outbound snapshot. Keep it server-side only. |
| Chat | `🤖 clanker powered on…` system line (`room.ts:485`) | Seeded rooms emit **no** bot-announcement; persona joins look like a normal player join. |
| Name | `clanker` is obviously a robot | Seeded bots use **persona names** (human). `clanker` stays only in the labeled `robots` room. |
| Avatar | n/a | Persona avatars are human, never robotic. |
| Skill/timing | near-perfect, instant | **Noob profile**: mistakes + slow pacing (§7). |

> Implementation note: this means a **client-facing snapshot projection** — the server's internal
> `RoomSnapshot` keeps `isBot`/seed data; what's serialized to the socket omits it. This is the
> single most security-sensitive correctness item in v1: a leaked `isBot` breaks the whole premise.

## Fairness invariant (unchanged, load-bearing)

The bot never sees the answer. v0 degradation (§7) makes it play *worse*, never makes it *peek*.
`solver.ts` and the new `noob.ts` both take only `BotView`. This is the same wall `solver.ts`
documents at its top, and it stays test-guarded.

---

## Data flow (end to end)

1. **Seed:** `ARENA.alarm()` sees `open < TARGET_OPEN` → picks a persona + edition + length, mints a
   `ROOM` (`idFromName(syntheticPath)`), initializes it as a seeded lobby with the persona waiting,
   records it in the index.
2. **Browse:** human opens Arena → `GET /api/arena/open` → rows render, including this waiting game.
3. **Join:** human taps the row → navigates to `path` → normal WebSocket `hello` → room now 2/2.
4. **Auto-start:** seeded room flips `lobby → playing`, picks the word (existing path), bot begins
   its noob heartbeat. Room `POST ARENA./close` (no longer joinable).
5. **Play:** human vs noob bot. Bot guesses via `noobGuess` (blind, fallible, slow).
6. **Finish:** existing finish flow. Human's game record `→ USER ./append`; H2H `→ USER ./h2h`.
7. **Restock:** the closed slot drops `open` below target; next `ARENA.alarm()` mints a replacement.

---

## Error handling & silent-failure guards

- **Index never lies:** room owns create→register→close; `ARENA` prunes stale seeds on each tick.
  A row that 404s on join (raced) → UI removes it and refreshes, never a dead end.
- **Seeding is best-effort and capped:** hard cap `MAX_SEEDED` so a bug can't mint unbounded rooms.
- **H2H write is best-effort** (`waitUntil`), never blocks finishing a game (mirrors existing
  `DIRECTORY`/challenge best-effort writes).
- **Disguise leak = test failure:** a unit test asserts the client-facing snapshot contains no
  `isBot` and no seed metadata.

---

## Testing (pure units first, matching the repo's Vitest style)

- `noob.ts`: given a `BotView`, the noob profile (a) never returns an illegal-length word, (b)
  produces sub-optimal guesses at the configured rate, (c) **never** references the answer (type-level
  + the module imports nothing that exposes it).
- `bots.ts`: `pickPersona()` is deterministic and covers the roster.
- Snapshot projection: client-facing serialization omits `isBot` / seed fields (disguise guard).
- Index ops (pure where possible): add/refresh/close/prune transitions on the `OpenGame` map.
- Integration (manual smoke): seed → Arena lists it → join → auto-start → beat the bot → H2H shows.

---

## Deploy / migration (known gotcha, baked in)

- New DO namespace `ARENA` → add wrangler migration **`v4` with `new_sqlite_classes: ["Arena"]`**
  (v2/v3 already use `new_sqlite_classes` for `User`/`Challenge` — the established pattern for any
  new DO on the free plan). Using `new_classes` here would deploy-fail with **err 10097**, and a
  **dry-run won't catch it** — only a real deploy does. The `Arena` DO uses the KV-style
  `ctx.storage.get/put` API, which is supported on `new_sqlite_classes`.
- Add the `ARENA` binding to `Env` (`types.ts`) and `wrangler.toml` `durable_objects.bindings`.

---

## Suggested build sequence (for the plan)

1. `ARENA` DO + binding + `v4` migration + `GET /api/arena/open` (returns empty list) — deploys clean.
2. Generalize `ensureBot` + seed marker + auto-start; ARENA seeding alarm mints 1 room. Verify a
   seeded waiting game appears via the API.
3. Arena tab UI renders the list + join. Verify the magic-moment join works against a sharp bot.
4. `noob.ts` + wire into seeded rooms. Verify the bot is now slow and beatable.
5. Bot roster (`bots.ts`) + human names/avatars + disguise projection (strip `isBot`, no robot chat).
   Verify no tell leaks to the client.
6. H2H memory (USER DO field + endpoint + write + UI surface). Verify "You vs Maya" persists.

---

## Deferred (so the reader knows the shape of later phases)

- **v2 — Living lobby + tuning:** background **bot-vs-bot** matches (two `isBot` players in one
  seeded room, same alarm loop run twice) so the Arena shows games *in progress*; **backfill** (a
  lonely human's room gets a bot after an alone-too-long alarm); the **frequency dial** as real config.
- **v3 — Depth:** skill **levels** (more `noob.ts` profiles + a picker, biased toward a target human
  win-rate); rivalry arcs; bot presence on leaderboards; online-players list.
