# Arena Liquidity Bots — Design (v1: Living Arena + Characters)

**Date:** 2026-06-02 (revised 2026-06-03 after a code-grounded review)
**Status:** Approved (brainstorm) → ready for implementation plan
**Scope:** v1 only. v2/v3 sketched at the end, explicitly out of scope here.

> **Revision 2026-06-03:** reconciled against live code before planning. Fixes: migration tag
> `v4`→`v5` (Daily already took v4); added the missing `Room` server-side seed route (rooms are
> connect-triggered today and cannot exist eagerly without it); reordered the build sequence so the
> disguise projection + noob land *before* the Arena tab is publicly reachable (prod-is-dev);
> collapsed the index to one status-carrying list; pinned the seed-count / restock / persona-
> uniqueness rules. Search "▶ rev" for every inline change.

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
`ARENA` DO also reuses the **alarm heartbeat** the bot already runs (`scheduleBotTick`
`room.ts:558–567`, `alarm()` `571–582`) for its seeding tick — no new concurrency primitive.

> **▶ rev — the real new primitive is the *eager* room.** Today a Room is inert until a WebSocket
> wakes it: it learns its own `path` from the WS query param (`room.ts:108–116`) and only adds its
> bot inside the connect path (`ensureBot`, `room.ts:549–556`). A seeded Arena room must exist, hold
> a waiting persona, and be *listed* with **zero humans connected**. That requires a new
> server-to-server init on the Room (§5, `POST /seed`) — this, not the coordinator DO, is the piece
> with no precedent in the codebase. Daily is *not* a precedent: it seeds inside the WS hello path
> (`seedDailyIfNeeded`), still connect-triggered.

---

## Components (each an isolated unit: purpose · interface · depends on)

### 1. `ARENA` coordinator Durable Object — **new** (`src/arena.ts`)

- **Purpose:** own the Open-Games index and keep the Arena stocked.
- **Interface (HTTP, DO-internal + one public-facing via worker):**
  - `GET /open` → `OpenGame[]` (the list the Arena UI renders).
  - `POST /open` `{ path, name, edition, wordLength, seats }` → register/refresh a waiting room.
  - `POST /close` `{ path }` → remove a room from the index (room filled, started, or swept).
  - `alarm()` → seeding tick: reconcile lifecycle (§2), count **live seeds** (`status !== "closed"`);
    if `< TARGET_OPEN`, mint more (capped at `MAX_SEEDED`); prune stale; reschedule the next tick.
  - **▶ rev — lazy bootstrap:** every `GET /open` ensures an alarm is pending and, if below target,
    kicks a best-effort seed (`waitUntil`, non-blocking). Without this, a cold or just-deployed ARENA
    DO has no pending alarm and serves an **empty** Arena until the first timer fires — breaking the
    "never empty" promise. Reading the index self-heals it.
- **State (single KV-style blob, matching the codebase convention):**
  `{ seeded: Record<path, SeedRec>, seedCount: number }` (▶ rev — one status-carrying list, not two;
  see §2 for why).
- **Singleton addressing:** `env.ARENA.idFromName("arena")` — one instance, the global coordinator.
- **Depends on:** `ROOM` namespace (to mint/seed rooms), the bot roster, `DIRECTORY` (optional, for
  naming uniqueness).

### 2. Open-Games index (data, lives inside `ARENA` DO storage)

- **Purpose:** the authoritative "what's joinable right now."
- **▶ rev — one list with a status, not two.** The original `{ open, seededPaths }` split forces a
  reconciliation race: a room is minted (in `seededPaths`) but has not `POST /open`'d yet (not in
  `open`), so the seed count is ambiguous — count `open` and you over-mint past `TARGET_OPEN`; count
  `seededPaths` and a silently-failed mint never retries. Collapsing to a single record keyed by
  path, carrying a `status`, removes the ambiguity:
  ```ts
  type SeedRec = {
    path: string;        // "<owner>/<slug>" — UNIQUE per mint (see §5)
    name: string;        // display name of the room
    host: string;        // persona display name — looks human
    personaId: string;   // stable key: persona uniqueness + H2H attribution
    personaIcon: string; // avatar (human, never robotic)
    edition: string;     // theme id (for a themed row)
    wordLength: number;  // v1: pinned to 5 (see §6)
    seats: string;       // "1/2"
    mintedAt: number;    // set when ARENA mints the room
    status: "minted" | "registered" | "closed";
  };
  // ARENA state: { seeded: Record<path, SeedRec>, seedCount: number }
  ```
  - **`GET /open`** returns the records filtered to `status === "registered"` (a room that has
    confirmed itself live via `POST /open`). The browser-facing `OpenGame` is that projection.
  - **Seed count** (drives mint) = records with `status !== "closed"`. Minted-but-not-yet-registered
    rooms ARE counted, so we never over-mint while a fresh room is still waking.
- **Lifecycle + prune (every tick):**
  - `minted` → room exists, expected to register. Still `minted` after `STALE_MS` (crashed before
    reporting) → drop it; the count then triggers a clean re-mint.
  - `registered` → joinable, shown in the Arena. The room flips it to `closed` on join/start/finish.
  - `closed` → removed after a short grace (a racing client gets a clean "gone"), then GC'd.
  - Belt-and-suspenders: a `registered` entry older than a generous `MAX_OPEN_MS` with no close
    report (the close POST was lost) is pruned by age. This staleness sweep — not the happy-path
    report — is the load-bearing truth guard (see Testing).
- **v1 index = bot-seeded rooms only.** Real human-created waiting rooms registering into the same
  index (humans finding humans) is a cheap, room-source-agnostic extension — but it's **v2**. v1's
  only join path is human-joins-bot, matching the intended first-run experience.

### 3. Worker routes (`src/worker.ts`)

- **Purpose:** expose the index to the browser and nothing more.
- `GET /api/arena/open` → proxies `ARENA./open`, returns `OpenGame[]` JSON. (The proxied `/open`
  also triggers ARENA's lazy bootstrap — §1 — so the first hit after a deploy fills the Arena.)
- Join needs **no new route**: a row's `path` is an ordinary `<owner>/<slug>`; tapping it navigates
  to the existing room URL and the normal WebSocket join runs. (This is why the disguise is free at
  join time — the client experiences a plain room.)

### 4. Arena tab UI (`public/hub.js`, `public/index.html`, `public/style.css`)

- **Purpose:** replace the stub (`hub.js:47`) with a live list.
- Fetch `GET /api/arena/open`, render each `OpenGame` as a **glass** row (per the no-pills Glass
  Aurora language — zero pills/chips): host name + avatar, edition tint, `wordLength`, `1/2 waiting`.
- Tap → navigate to `path`. Empty/loading/error states handled (never a blank panel).
- Light polling/refresh while the tab is open (e.g. every few seconds) so rows appear/disappear live.

### 5. Bot rooms — generalize the bot + add a server-side seed route (`src/room.ts`)

Today `ensureBot()` only fires for `slug === ROBOT_SLUG` (`room.ts:549–556`) and a Room learns its
identity / adds its bot only via the WebSocket connect path. v1 needs rooms that exist *before* any
human connects, so:

- **▶ rev — new `POST /seed` route on the Room DO (the missing primitive).** `ARENA` calls
  `roomStub.fetch("https://do/seed", { method: "POST", body: { path, persona, profile, edition,
  wordLength } })`. The handler sets `state.path/owner/slug` (no `?room=` query exists at seed time —
  this is where a seeded room's identity comes from), stamps the **seed marker**
  `seed: { personaId, profile }`, injects the persona as a waiting player via the generalized
  `ensureBot`, leaves `phase: "lobby"`, persists, then `POST ARENA./open` to register itself
  (`status: registered`). Mirrors how `seedDailyIfNeeded` initializes server-side, but triggered by
  ARENA instead of a client connect.
- **Generalized `ensureBot`:** fires for seeded rooms too (gate on the seed marker, not just
  `ROBOT_SLUG`), adding **the persona** as the waiting player (human name + avatar, not "clanker")
  and emitting **no** `🤖 powered on` system line (`room.ts:555` is a disguise tell — see §Disguise).
- **Auto-start on human join:** a seeded room has no human host to click *Start*. When the human's
  `hello` brings it to 2/2, the room runs the existing start path (`onStart` word-pick →
  `lobby → playing` → `scheduleBotTick`) automatically. `onStart` (`room.ts:439`) currently takes a
  `ws` for its "who started" line + error sends — factor the startable core out so the seeded path
  can call it without a socket.
- **Report to ARENA:** on seed → `POST ARENA./open`; on the human joining/starting → `POST
  ARENA./close`; on finish → `POST ARENA./close` (idempotent). The room owns its own index
  truthfulness; ARENA's staleness sweep (§2) is the backstop if a report is lost.
- **▶ rev — unique path per mint.** `idFromName(path)` is deterministic, so reusing a synthetic path
  on restock returns the *same* DO instance, still holding the finished game's state/chat. Seeded
  paths therefore embed `seedCount` (e.g. `arena/maya-7`) so every mint is a fresh DO. Trade-off:
  finished seeded DOs accumulate (ties into the existing junk-record cleanup TODO) — the leaner
  correctness choice over reset-in-place, which risks stale chat/state leaking into a "new" game.
- The existing **`robots` room keeps working unchanged** (labeled clanker, not disguised; still
  calls `computeNextGuess` directly).

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
- **▶ rev — `pickPersona(seedCount, openPersonaIds)` is pure and uniqueness-aware:** it varies by
  ARENA's monotonic `seedCount` (deterministic + unit-testable — not `Math.random`) AND excludes any
  persona already hosting an open room. Two simultaneous "Maya" rooms would be a visible tell *and*
  collide on the H2H key (`h2h[maya]`); excluding open personas prevents both. (Runtime `Math.random`
  for *timing jitter* stays fine — already used at `room.ts:565`; the determinism rule is about
  selection logic, not pacing.)
- **▶ rev — v1 seeds are 5-letter.** `wordLength` is free 4–12 in the data, but a "beatable noob" at
  10–12 letters can still crush most humans and the first-run win wobbles. Pin v1 seeds to the
  friendly 5-letter default so the magic moment lands; length variety is a v2 knob.
- **▶ rev — free win:** because a persona wears an edition, every Arena room showcases a theme from
  the library — reinforcing the "grow the edition library / beat NYT" direction at zero extra cost.
  Caveat: the room has one shared edition (`types.ts:69`), so joining a persona overrides the human's
  theme for that game — intended.

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
| Snapshot | `PlayerState.isBot` is sent to clients (`types.ts:38`, in `RoomSnapshot.players`) | **Strip `isBot`** (and any seed metadata) from the outbound snapshot. Keep it server-side only. |
| Chat | `🤖 clanker powered on…` system line (`room.ts:555`) | Seeded rooms emit **no** bot-announcement; persona joins look like a normal player join. |
| Name | `clanker` is obviously a robot | Seeded bots use **persona names** (human). `clanker` stays only in the labeled `robots` room. |
| Avatar | n/a | Persona avatars are human, never robotic. |
| Skill/timing | near-perfect, instant | **Noob profile**: mistakes + slow pacing (§7). |

> Implementation note: this means a **client-facing snapshot projection** — the server's internal
> `RoomSnapshot` keeps `isBot`/seed data; what's serialized to the socket omits it. This is the
> single most security-sensitive correctness item in v1: a leaked `isBot` breaks the whole premise.

> **▶ rev — accepted soft tell:** in v1 only bots accumulate H2H (human-human tracking is v2), so the
> *presence* of a "You vs X" record technically reveals X is a bot to a savvy user. We accept this:
> the "You vs Maya: 1–0" moment IS the product, and the inference requires a player who both notices
> the record and reasons about it. Closing it (seed human-human H2H) is a v2 follow-up, not a v1 gate.

## Fairness invariant (unchanged, load-bearing)

The bot never sees the answer. v0 degradation (§7) makes it play *worse*, never makes it *peek*.
`solver.ts` and the new `noob.ts` both take only `BotView`. This is the same wall `solver.ts`
documents at its top, and it stays test-guarded.

---

## Data flow (end to end)

1. **Seed:** `ARENA.alarm()` sees live seeds `< TARGET_OPEN` → `pickPersona(seedCount, openPersonas)`
   picks a fresh persona (5-letter, edition from the persona), mints a `ROOM` at a **unique** path
   (`idFromName("arena/<persona>-<seedCount>")`), calls `Room POST /seed` to initialize the seeded
   lobby with the persona waiting (`status: minted`). The room then `POST ARENA./open`
   (`status: registered`).
2. **Browse:** human opens Arena → `GET /api/arena/open` → rows render, including this waiting game.
3. **Join:** human taps the row → navigates to `path` → normal WebSocket `hello` → room now 2/2.
4. **Auto-start:** seeded room flips `lobby → playing`, picks the word (existing path), bot begins
   its noob heartbeat. Room `POST ARENA./close` (no longer joinable).
5. **Play:** human vs noob bot. Bot guesses via `noobGuess` (blind, fallible, slow).
6. **Finish:** existing finish flow. Human's game record `→ USER ./append`; H2H `→ USER ./h2h`.
7. **Restock:** the `closed` record drops the live-seed count below target; the next `ARENA.alarm()`
   mints a replacement at a **new** unique path (never the closed one — §5).

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
- **▶ rev — index lifecycle as a pure, fully-tested reducer:** the truthful seam (the cross-DO
  open/close report) is the *least* unit-testable part in a pure-Vitest setup, so model the index as
  a pure `(state, event) → state` reducer and cover every transition — `minted→registered→closed`,
  stale-`minted` drop, aged-`registered` prune, count = `status !== "closed"`. The prune logic is the
  load-bearing truth guard; cover it exhaustively even though the happy-path report is only smoke-tested.
- Integration (manual smoke): seed → Arena lists it → join → auto-start → beat the bot → H2H shows.
  ▶ rev — also smoke the failure the sweep guards: kill a room mid-wait, confirm its row drops from
  `/open` within `MAX_OPEN_MS` rather than becoming a ghost.

---

## Deploy / migration (known gotcha, baked in)

- **▶ rev — New DO namespace `ARENA` → wrangler migration `v5` with `new_sqlite_classes: ["Arena"]`.**
  The spec originally said `v4`, but **`v4` already shipped as `Daily`** (`wrangler.jsonc`: v1 Room ·
  v2 User · v3 Challenge · v4 Daily) — a duplicate tag is the exact version-collision incident class.
  **Read the current max tag at implementation time; today that's `v5`.** v2/v3/v4 all use
  `new_sqlite_classes` for new free-plan DOs — the established pattern. Using `new_classes` here would
  deploy-fail with **err 10097**, and a **dry-run won't catch it** — only a real deploy does. The
  `Arena` DO uses the KV-style `ctx.storage.get/put` API, supported on `new_sqlite_classes`.
- Add the `ARENA` binding to `Env` (`types.ts`) and `wrangler.toml` `durable_objects.bindings`.

---

## Suggested build sequence (for the plan)

> **▶ rev — prod-is-dev reorder.** This project ships each green step to prod, so the Arena tab must
> not become publicly reachable until the disguise projection AND the noob profile are in — otherwise
> a live window exposes `isBot`, the `🤖 powered on` line, and an *unbeatable* sharp bot to real
> users. Everything before the tab is server-side and invisible; the tab flips on **last**.

1. `ARENA` DO + binding + **`v5`** migration + `GET /api/arena/open` (returns empty list) — deploys
   clean. No UI yet.
2. `Room POST /seed` + generalized `ensureBot` + seed marker + auto-start-on-join; ARENA seeding
   alarm (single-list lifecycle + lazy bootstrap) mints 1 room. Verify a seeded waiting game appears
   **via the API** (still no public tab).
3. `noob.ts` + wire into seeded rooms (seeded → `noobGuess`; `robots` → `computeNextGuess`). Verify
   via the API / a test room that the bot is now slow and beatable.
4. Bot roster (`bots.ts`) + persona names/avatars + **disguise projection** (strip `isBot`/seed from
   the outbound snapshot, suppress the robot chat line). Verify no tell leaks to the client.
5. H2H memory (USER DO `/h2h` field + endpoint + write + in-room surface). Verify "You vs Maya"
   persists across games.
6. **Arena tab UI goes live** (`hub.js:47` stub → real list + join + light poll). Only now is the
   feature publicly reachable — by which point bots are beatable and disguised. Verify the full
   magic moment end-to-end.

---

## Deferred (so the reader knows the shape of later phases)

- **v2 — Living lobby + tuning:** background **bot-vs-bot** matches (two `isBot` players in one
  seeded room, same alarm loop run twice) so the Arena shows games *in progress*; **backfill** (a
  lonely human's room gets a bot after an alone-too-long alarm); the **frequency dial** as real config.
- **v3 — Depth:** skill **levels** (more `noob.ts` profiles + a picker, biased toward a target human
  win-rate); rivalry arcs; bot presence on leaderboards; online-players list.
