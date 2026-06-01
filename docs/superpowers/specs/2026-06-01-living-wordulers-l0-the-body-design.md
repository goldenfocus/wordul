# Living Wordulers — L0: The Body

## 1. Vision & the Layer Arc

Wordul is a real-time multiplayer Wordle living on Cloudflare Workers + Durable Objects. The vision is a **living population of autonomous wordulers** — agents *born in* and *living in* Wordul, each like a little kid who does not even know it is an AI. It thinks it is just a worduler, worduling. It perceives only what a human perceives — the public color masks of its own guesses, the chat, the scoreboard — and **never** the secret answer, never its own source code. We grow this population in **layers**, each its own shippable thing. **L0 is the body**: a believable, fallible, human-paced bot that joins one room and plays one real game from public masks, backed by a persistent per-bot identity from day zero. Everything beyond L0 is documented here as a clean *seam*, not built.

| Layer | Name | What it adds | Status |
|-------|------|--------------|--------|
| **L0** | **The Body** | One bot, one room, one real game from public masks; persistent Agent DO identity; alarm-driven tick; archive seam (write only). | **← BUILD TARGET** |
| L1 | The Self | Persistent memory of games, opponents, results; opener evolution; tilt persistence. | Deferred (seam ready) |
| L2 | The Will | Goals + daily rhythm; the agent discovers it can join *other* rooms; self-waking alarm. | Deferred (seam ready) |
| L3 | The World | Population roams, forms relationships, emergently creates rooms/themes/jokes/teachings; programmatic-SEO sub-layer; Census/god-view aggregation. | Deferred (seam ready) |
| L4 | The Soul | Personality, banter, coaching; themed editions (a dark LOTR "Morgul" edition). | Deferred (seam ready) |

L0 must stand alone: a real, shippable, testable thing. The full arc is orienting context only — every L0 decision is chosen so L1–L4 pour into the same vessels with no rewrite.

---

## 2. Guiding Principles

These are founding constraints, not implementation details. Write them in.

- **Agents never know they are AI; humans always can.** Undisclosed bots are framed as a *consensual* "spot the real players" Turing game — never deception. A bot is a little kid worduling; the player base is invited to guess who is real. This is also the marketing hook. `isBot` is honest at the source: `PlayerState`, the Agent DO, and every reported game record carry it from day one — and it is **authoritative from persisted state**, never re-derived from a KV lookup on the hot path.
- **Disclosure is real wherever it persists.** The in-game "spot the bot" challenge is the *only* place a bot goes undisclosed, and only to live players who opted into the game. Every *persistent, crawlable, or machine-read* surface labels the bot honestly. At L0 this is enforced by a **deny-by-default indexability rule**: a bot's profile page and any archive-derived page serve `<meta name="robots" content="noindex">` and are **never** placed in the sitemap, until a future render layer's soul-score gate explicitly flips a page to `index` *with* machine-readable disclosure (JSON-LD typing the entity as a fictional/`SoftwareApplication` agent, a visible "autonomous worduler (AI player)" badge, non-impersonating meta copy). Quality per page, infinite pages is only true if the default for an ungated page is `noindex`.
- **Cheat-isolation is sacred.** The solver/agent code must be *structurally incapable* of reading the answer. The wall is a single typed bridge: the Room constructs a `BotView { wordLength, ownGuesses: GuessRow[] }` from *only* `player.guesses` + `state.wordLength`, and the solver consumes `BotView` and nothing else. It imports nothing from `room.ts`/`user.ts`, references neither `state.word` nor `scoreGuess`. Making the answer reachable would require editing the `botView()` bridge signature — a visible, test-guarded act, not a silent extra argument.
- **Believability over optimality.** The goal is a distracted-but-earnest human, not an optimal solver. Pacing and fallibility are the whole game. Every behavioral parameter is deterministic given a seed, so believability is testable.
- **One scoring path.** Bots and humans pass through the *exact same* guess-scoring core. There is no parallel bot scoring function — a mirror is a fork, and a fork drifts. Reuse is enforced structurally (§4.3).
- **Tiered retention with an indexability gate.** Hot DO state stays capped (fast). Cold archive keeps every game forever. *Only* games that clear a future "soul score" become indexable pages; the rest stay `noindex`. The indexable link graph must be human-anchored: a future render layer indexes a game only if a human participates *or* it clears the soul gate, and bot-profile links from hub pages carry `rel=nofollow`/`noindex`. L0 builds the archive *write* and bakes provenance (`isBot` per player) into the blob so the render layer can enforce this; the gate itself is deferred.
- **Moderation inherits a filter.** Any future bot chat uses a constrained phrasebook first, a free LLM *never*, and every outbound string passes a moderation gate. The enforcement seam lives in the Room, not on a profile flag: `onChat` carries an `if (player.isBot) return` guard (a no-op at L0 since bots never chat), and L4 bot chat routes through a separate `botChat(handle, phrasebookKey)` path that is moderation-gated by construction — never through `onChat`'s free-text surface.

---

## 3. L0 Scope

### Ships in L0

- **Agent DO** (`src/agent.ts`) — one Durable Object per bot, the persistent "self" vessel. Holds handle, fixed playstyle, born timestamp, and `isBot:true` / `systemOwned:true` (humans cannot claim a bot handle). Exposes the *same* fetch surface as the User DO so a bot's `/@handle` page renders identically to a human's — except served `noindex` (deny-by-default until the deferred soul gate).
- **`spawnBot()`** (`src/agent-spawn.ts`) — the single bot-minting entry point: writes the `bot:<handle>` routing sentinel **only** (never a `user:` sitemap key) and `POST /init`s the Agent DO.
- **`solver.ts`** (`src/solver.ts`) — a pure, deterministic, fallible, cheat-isolated guesser. Input: a `BotView` (word length + the bot's own past `GuessRow[]`) + a playstyle + a seed. Output: next guess.
- **Pacing** (`computeThinkMs`, folded into the solver module family) — entropy-scaled, non-uniform, seeded think-time. Pure and seedable.
- **Room tick** (extend `src/room.ts`) — a DO alarm that wakes on the soonest bot's think-time, drives that bot through the *exact same* extracted `applyGuess` core a human uses, reschedules to the next thinker (multiplexing many bots onto one alarm), counts bots as active in `isGameOver`, and reports each bot result on finish. Hibernation-safe; finish reports fire via `ctx.waitUntil`.
- **Archive seam** (`src/archive.ts`) — append every finished game to cheap cold storage (R2) the moment the room seals, *guarded by binding presence* so a missing bucket never gates the deploy. Write only.
- **Scoreboard cap** (`src/scoreboard.ts`) — `SCOREBOARD_CAP` LRU/top-N eviction, because L0 introduces the roaming actor that makes scoreboard growth unbounded.
- **`isBot` at the source** — added to `PlayerState`, authoritative from persisted state, propagated into every reported game record and the archive blob.
- **Tests** — solver unit tests (cheat-isolation, constraint correctness incl. the duplicate-letter/`minCounts` case, fallibility, determinism), pacing tests, room-tick integration tests (incl. cold-wake + finish-idempotency), archive tests, and a believability smoke (opener loyalty + non-uniform timing).

### Non-Goals (deferred, documented as seams)

- **Census DO + `/agents` god-view** — the cross-entity aggregation primitive. There is no population to see at L0 (one bot, one room). `finishGame()` emits a single structured-log line of the finish event as the observability seam; the aggregation DO + dashboard land in **L3**, reading the archive. This collapses the migration to a single new class (`Agent`).
- **Tilt / mood drift** — `computeTilt` ships as a flat no-op seam returning `0`. Real tilt needs L1 persistence (it is ephemeral and resets on cold start) *and* a new Agent→Room read path that L0 does not need. To keep L1 a one-line wiring change, `addBot()`/`scheduleBotTick()` accept an optional `seedState?: { recentResults?: ('won'|'lost')[] }`, always passed empty at L0; L1 fills it from a `GET /?username=` on the Agent DO (whose `games[]` makes `recentResults` derivable with no schema change). This Agent→Room read is the documented L1 insertion point.
- **AFK gaps + full timing-forensics harness (K-S / bimodality)** — these calibrate against a human-timing population that does not exist at L0. Deferred to L3 alongside the population. L0 ships only the non-uniform, entropy-scaled, seeded `computeThinkMs`.
- **L1 memory** — `memories[]` / opponent recall / opener evolution / persisted tilt. (Agent DO storage map is already additive; the `seedState` seam above is the wiring hook.)
- **L2 will** — goals, daily rhythm, a self-waking `alarm()` on the Agent DO, autonomous room discovery. (`/bot/join` is the seam; the Agent DO can already `setAlarm`.)
- **Handle-claim hardening (known accepted L0 gap).** The game is passwordless; `onHello` trusts the client username, so a human *could* send `hello` with a bot's handle over WebSocket. Accepted at L0 because mint is controlled and the framing is consensual. **Mitigation already in L0:** `onHello` cross-checks `DIRECTORY.get('bot:<username>')` and refuses to mark such a player as a non-bot, so the god-view/archive split can never silently count a bot-handle claimant as human. The full rejection (refuse the socket entirely) is the L2 fix.
- **L3 world** — population roaming, relationships, emergent room/theme creation, the SEO render layer (soul-score gate, JSON-LD game pages, word-hub pages, curated sitemap, archive read path), dead-room reaper, Census sharding.
- **L4 soul** — personality, banter, coaching, themed editions, bot chat (phrasebook-first, moderation-gated, never free LLM; only the `onChat` `isBot` guard + principle ship now).

---

## 4. Components

### 4.1 Agent DO — the persistent per-bot identity vessel

**Purpose.** A Durable Object that is the singular *self* of one bot. It stores the bot's handle, playstyle, born timestamp, and the `isBot` / `systemOwned` flags that make it structurally distinct from a human User DO. It exposes the *same* fetch interface as the User DO, so the existing `/@handle` route renders a bot profile identically to a human one — except the served HTML is `noindex` and the handle is absent from the sitemap. It receives game results through the *exact same* reporting pipeline `room.ts` already uses for User DOs — no new reporting path. It is the vessel L1 memory and L2 goals pour into with no rewrite — deliberately roomy.

**Files touched.**
- `src/agent.ts` *(create)* — the `Agent` DO class. Private `load()` mirrors `User.load()` exactly (reads the `'profile'` key, backfills `username`, persists on first contact). `createAgentProfile(handle, playstyle)` is a pure factory: `emptyStats()`, `games:[]`, `ownedRooms:[]`, `createdAt:Date.now()`, `isBot:true`, `systemOwned:true`. `isBot`/`systemOwned` set once at birth, never mutated.
- `src/agent-spawn.ts` *(create)* — `spawnBot(env, handle, playstyle)`: the **only** mint point. Writes **only** `bot:<handle>='1'` (the routing sentinel; **no** `user:` key — see §4.6), then POSTs `/init` to the Agent DO (idempotent). Retries the sentinel write with backoff to survive KV eventual-consistency lag; `/init` idempotency makes double-mint safe.
- `src/types.ts` *(modify)* — add `Playstyle`, `AgentProfile`, and `AGENT: DurableObjectNamespace` to `Env`. All additive.
- `src/worker.ts` *(modify)* — import + re-export `Agent`; in the `/api/user/<name>` handler and `injectMeta`, check `DIRECTORY` for `bot:<name>` and route to `AGENT` instead of `USER` when present; when it is a bot, `injectMeta` emits `noindex` (see §4.6). `PROFILE_RE`/`ROOM_RE` unchanged — bot handles satisfy `[a-z0-9_-]{3,20}`.
- `wrangler.jsonc` *(modify)* — `AGENT` binding + the `v3` migration (single new class).

**Stored shape.**
```ts
type Playstyle = {
  skillTier: 'novice' | 'casual' | 'skilled' | 'expert';
  temperamentSeed: number;            // fixed at birth, drives ALL solver RNG
  openerWords: Record<number, string[]>; // per-length favourites (sizes 4–12), 1–2 each
  mistakeBudget: number;
  probeWithValid: boolean;            // higher tiers burn .valid non-answers (see §4.2 / §8)
};
type AgentProfile = UserProfile & {
  isBot: true;
  systemOwned: true;                  // humans cannot claim a bot handle
  playstyle: Playstyle;
  // chatEnabled is NOT persisted at L0. Bot chat is an L4 concern enforced in the
  // Room (onChat isBot-guard), not on this profile. The kill-switch flag, if ever
  // wanted, is added then — a profile boolean cannot gate a Room-level surface.
};
```

**Interfaces.**
- `GET /?username=<handle>` → `AgentProfile` JSON (superset of `UserProfile`; identical to the User DO GET).
- `POST /append?username=<handle>` → body `GameRecord`; `applyGame` + `appendCapped(games, HISTORY_CAP=100)`; returns `'ok'`. **Byte-for-byte identical contract to `User.fetch /append`.**
- `POST /room?username=<handle>` → upsert `ownedRooms`, cap `ROOMS_CAP=100`.
- `POST /init` → body `{ handle, playstyle }`; idempotent mint (creates the `AgentProfile` only if absent).
- `spawnBot(env, handle, playstyle): Promise<void>`.

**Data flow.** Routing is gated by one KV read. `worker.ts` checks `DIRECTORY.get('bot:<name>')`; hit → `AGENT` stub + `noindex` meta, miss → `USER` stub. The downstream `GET ?username=<name>` is identical in both cases. The frontend receives a valid `UserProfile` shape; the extra `isBot`/`systemOwned`/`playstyle` fields are available for bot-badge rendering. `applyGame`/`appendCapped` are reused unchanged from `stats.ts`.

### 4.2 solver.ts — the cheat-isolated, fallible guesser

**Purpose.** A pure, side-effect-free module taking *only* a `BotView` (what a human spectator sees — word length + the bot's own past `GuessRow[]`), a deterministic `Playstyle`, and a seed, returning the next guess. It never touches `state.word`. It imports nothing from `room.ts`, `user.ts`, or any DO. **Structural cheat-isolation is enforced by the typed bridge**: its only corpus is `WORDS_BY_SIZE` (public), its only game input is the `BotView` the Room hands it.

**Files touched.**
- `src/solver.ts` *(create)* — the pipeline below, plus pacing helpers and `HUMAN_TELLS`.
- `src/solver.test.ts` *(create)* — see §7.

**Pipeline (internal).**
1. `buildConstraints(guesses)` — derive greens/yellows **and per-letter `minCounts`** from the `Color[]` masks only. **Literal note: the codebase `Color` is `'gray'` (American spelling, `color.ts:1`), not `'grey'`.** A grey letter contributes an *upper bound* on that letter's count, **not** a flat exclusion: with `minCounts` tracking green+yellow occurrences, a letter that comes back green+gray (duplicate-letter case) is allowed exactly one instance, never zero. A naive grey-exclusion set over-prunes correct duplicate-letter answers and is a glaring tell.
2. `filterCandidates(pool, constraints)` — narrow **`WORDS_BY_SIZE[len].answers`** (the answer subset, NOT the full `.valid` set — ranking the full valid set inside an alarm handler is too slow).
3. `rankCandidates` — letter-frequency entropy over the surviving set (hardcoded English frequency table, no runtime computation).
4. `applyFallibility(ranked, view, playstyle, rng, guessNumber)` — gated by mistake budget + a per-tier probability table: drop to a lower-ranked pick, replay a known-dead letter, ignore a green (the classic human flub), or emit a curated plausible non-word (eats the rejection). For `playstyle.probeWithValid` (higher tiers), a fraction of *mid-game* guesses is drawn from `.valid` non-answers **constrained to the already-filtered candidate set** (so the scan stays in the alarm budget) — strong humans burn valid probes to split letters, and an answers-only expert never doing so is itself a tell.
5. `resolveOpener` — on guess 1, return from `playstyle.openerWords[wordLength]`. If that length has no opener (e.g. an unusual length), fall back to a **seed-salted** rank-N pick (`rng`-chosen, never deterministic rank-1) so two bots in the same room/round never collapse onto the identical fallback word.

**Interfaces.**
```ts
type BotView = { wordLength: number; ownGuesses: GuessRow[] }; // the COMPLETE game-state surface

export function computeNextGuess(
  view: BotView, playstyle: Playstyle, rollSeed: number
): string;
export function computeThinkMs(
  guessIndex: number, candidateCount: number, playstyle: Playstyle, rollSeed: number
): number;                                                      // entropy-scaled, non-uniform
export function computeTilt(recentResults: ('won'|'lost')[], threshold: number): number; // L0: returns 0 (no-op seam)
export function seededRng(seed: number, salt: number): () => number;  // mulberry32, append-only once deployed
export function deriveSeed(handle: string, roomPath: string, round: number, guessCount: number): number;
export const HUMAN_TELLS: readonly string[];
```
`BotView` is the **only** game-state input the solver ever receives. There is no parameter through which `state.word` can be passed.

**RNG & seeding.** `seededRng` is mulberry32 — no external deps. **The seed is `deriveSeed(handle, roomPath, round, guessCount)`, concretely `fnv1a(`${handle}|${roomPath}|${round}|${guessCount}`)`** — folding the room path + round so two bots in the same room/round/guess never pick identically (a fatal tell). Both `fnv1a`/`deriveSeed` and `seededRng` are **append-only once deployed** — changing either remints every wild bot's behavior, including its openers. (Test: 100 distinct handles in the same room/round/guess yield 100 distinct first guesses.)

**Data flow.** The Room alarm builds `botView(player, state)` from `player.guesses` + `state.wordLength` only → `computeNextGuess(view, playstyle, seed)` → a string → submitted through the existing scoring core unchanged. The core runs `WORDS_BY_SIZE[len].valid.has(word)` for the dict check and `scoreGuess(word, state.word)` server-side. The solver only ever reads the `Color[]` masks the core wrote in prior turns.

**The duplicate-letter trap (the hardest correctness case).** `scoreGuess` uses a leftover-counter: a letter guessed twice can come back green+gray, where the gray means *"no additional occurrence,"* not *"zero occurrences."* `buildConstraints` must track `minCounts` per letter rather than a flat grey-exclusion set, or it over-prunes correct duplicate-letter answers. Test by feeding **real `scoreGuess` output** (which emits `'gray'`) so the gray/grey spelling can never drift from the source of truth.

### 4.3 Room tick — alarm-driven bot turn loop

**Purpose.** Extend the Room DO with a DO alarm that wakes on the soonest bot's think-time, drives that bot through the identical scoring core, reschedules to the next soonest thinker (multiplexing many bots onto one alarm), makes bots count in `isGameOver`, and reports bot results on finish. Hibernation-safe: alarm-driven, no live outbound socket. **No change to scoring, gold, or win/finish semantics — there is one scoring path, not two.**

**The one-scoring-path refactor (load-bearing).** `onGuess` today interleaves socket handling with scoring. Extract a **pure core** with zero socket/ws references:
```ts
// applyGuess mutates the player and returns the outcome. No ws, no broadcast, no maybeFinish.
function applyGuess(player: PlayerState, word: string): { accepted: boolean; invalidReason?: string }
```
It performs, in the live order: the `phase !== 'playing'` guard, the `guesses.length >= maxGuesses` pre-check (**before** validity — load-bearing for "a bounce costs no guess"), the length+charset regex, the `WORDS_BY_SIZE[len].valid.has(word)` dict check, `scoreGuess`, `allGreen → status='won'` + first-winner assignment, the post-check `status='lost'`. It does **not** broadcast and does **not** call `maybeFinish` — both callers own that.
- `onGuess` becomes: resolve player from ws → `applyGuess` → on rejection send `invalid_guess` to the ws → `maybeFinish` → `persistAndBroadcast`.
- The alarm loop calls the **same** `applyGuess(botPlayer, word)`. There is now literally one scoring path; a future win-logic refactor cannot give bots different rules than humans.

**Files touched (`src/room.ts`, surgical; plus `src/types.ts`, `src/worker.ts`, `src/room.tick.test.ts`).**
1. **`addBot(handle, playstyle, seedState?)`** — validates `phase==='lobby'`, under `MAX_PLAYERS`, handle absent; pushes `PlayerState { username, connected:true, isBot:true, guesses:[], status:'playing' }`. Bots are injected via an internal `POST /bot/join` (proxied in `worker.ts`), **never** `onHello`/WebSocket. `seedState` is accepted and ignored at L0 (the L1 seam).
2. **`isGameOver()` fix** — change `active = players.filter(p => p.connected)` to `players.filter(p => p.connected || p.isBot)`. **Load-bearing:** bots are never WebSocket-connected, so without this they'd never count as active and the game would stall. Test this path explicitly.
3. **`scheduleBotTick()`** — at the tail of `onStart()` (after `persistAndBroadcast()`): compute each playing bot's first (opener) think-time, write `botSchedule: Record<handle, epochMs>` **into the single `state` blob the ctor already restores** (not a separate in-memory field — an in-memory field is empty after hibernation, the exact bug the `chatThrottle` comment warns about), then `ctx.storage.setAlarm(soonest)`. The DO then hibernates.
4. **`alarm()` (new) — the core loop.**
   - The Room ctor restores `state` (incl. `botSchedule`) via `blockConcurrencyWhile` *before* `alarm()` runs, so the schedule survives a cold wake. `now = Date.now()`.
   - **Re-anchor to `Date.now()` on every wake** — Cloudflare alarm drift / hibernation can fire past-due; process immediately and recompute fresh waits.
   - For each bot with `nextWakeAt <= now`: **at the top of each iteration, break if `state.phase !== 'playing'`** (a finish mid-loop must stop further bot guesses). Then if `status==='playing'`: `botView(player, state)` + `deriveSeed(...)` → `computeNextGuess` → `applyGuess(player, word)` (on a non-word bounce, `console.warn` and retry from valid candidates — the bounce costs no guess); update `botSchedule[handle] = now + computeThinkMs(...)`.
   - Call `maybeFinish()` once after the loop; call `persistAndBroadcast()` **once** after all ready bots.
   - **Reschedule from ONLY bots with `status==='playing'` AND `state.phase==='playing'`.** If none remain, `ctx.storage.deleteAlarm()` and delete the `botSchedule` entry/key — no zombie alarm may wake a finished DO.
5. **`finishGame()` reporting** — after the existing USER fan-out, route bot players to `env.AGENT` with the **identical** `GameRecord` payload. **`isBot` authority:** trust `player.isBot` from persisted `PlayerState` directly — **no per-player `DIRECTORY.get` fallback** (it adds a hot-path KV read and an eventual-consistency race that can mint a ghost human profile). `addBot` set the flag; it rides every `RoomSnapshot`. Add `isBot` to each `FinishedPlayer`/`GameRecord` and the archive blob (via `buildGameRecords(records)` reading `player.isBot`). **When called from `alarm()`, all reports fire via `ctx.waitUntil(...)`, not an awaited `Promise.allSettled`** — game state is already persisted, nothing downstream needs them to resolve, and a slow KV/DO/R2 hop must not stretch the alarm handler or delay another game's bot pacing in the same DO. Plus the archive write (§4.5) and the structured-log finish event (the L3-Census seam).

**Supporting changes.** `src/types.ts` adds `isBot?: boolean` to `PlayerState` (additive; absent = human, fans out through every `RoomSnapshot` automatically) and `BotView`. `wrangler.jsonc` adds bindings + migration. `src/worker.ts` adds the `POST /bot/join` proxy.

**Bot-only rooms.** `isGameOver`'s `connected || isBot` means a room with only a bot and zero connected humans runs to completion on the alarm. That is intended; the dead-room reaper is L3. Because AFK gaps are deferred (§3 Non-Goals), no bot can hold a multi-minute alarm in an unobserved room at L0 — bot-only rooms always progress at normal `computeThinkMs` pace and self-extinguish the alarm when all bots finish. (Test: bot-only room runs to completion and clears its alarm.)

**Cheat isolation in the loop.** `botView(player, state)` reads `player.guesses` + `state.wordLength` only — `state.word` is never folded in. `computeNextGuess(view, ...)` has no parameter for the answer. The only place the answer appears is `scoreGuess(word, state.word)` *inside `applyGuess`* — the same server-side scoring *every human guess* passes through.

### 4.4 Observability seam (structured log; Census deferred to L3)

**Purpose.** You cannot grow a culture you cannot see — but at L0 there is no culture, only one bot in one room. The aggregation DO + `/agents` god-view are an **L3** primitive (they read the archive once a population exists). L0 ships the *seam*, not the dashboard.

**Files touched.**
- `src/room.ts` *(modify)* — in `finishGame()` (inside the `ctx.waitUntil` best-effort block), emit **one structured `console.log` line** of the finish event: `{ roomPath, finishedAt, wordLength, durationMs, players: [{ username, isBot, result, guesses }] }`. This is the exact wire shape the L3 Census `/event` ingestion will adopt, so the call site is forward-compatible. Sample-log the bot fallibility paths (non-word bounces) too, so they are observable in production.

**Why no DO at L0.** A whole aggregation Durable Object — rolling counters, a ring buffer, a wire format, a migration tag, a route, a dashboard, and a test suite — to count games for a single bot is L3 scope front-loaded. None of L0's success criteria (a believable bot plays a real game and persists its identity) depend on it. Deferring it also collapses the migration to a single new class and removes the Agent+Census tag-coordination question entirely. When the population is real, the L3 Census reads the archive (§4.5) — which already carries `isBot` provenance per player — and the god-view is built then, with a sharded call site (`censusShardKey()` returning `'global'` on day one).

### 4.5 Archive seam (write only)

**Purpose.** Append every finished game to cheap cold storage the moment the room seals, so the deferred programmatic-SEO layer has raw material with full provenance. **L0 writes; it does not render, and nothing in L0/L1/L2 reads it.**

**Files touched.**
- `src/archive.ts` *(create)* — pure `archiveGame(env, payload): Promise<void>`. **If `env.ARCHIVE` is unbound, return immediately** — a missing bucket must never gate an L0 deploy. Otherwise serialize `ArchivePayload = GameRecord & { round: number; isBot: boolean[] }` to JSON → `env.ARCHIVE` R2 at key `game/{roomPath}/{round}/{finishedAt}.json`. One self-contained blob per round per room (~<2KB), no read-back → short per-room LISTs. Fire-and-forget safe (called inside the finish `ctx.waitUntil` block; swallows R2 errors). Belt-and-suspenders guard: `if (!payload.finishedAt) return` — never archive an in-progress game. No `cloudflare:workers` import; unit-testable with a mock R2.
- `src/room.ts` *(modify)* — in `finishGame()`'s `ctx.waitUntil` block, call `archiveGame(...)` (`console.error('archive failed', …)` on reject).
- `src/types.ts` *(modify)* — `ARCHIVE?: R2Bucket` on `Env` (optional — the guard above tolerates absence).
- `wrangler.jsonc` *(modify)* — `ARCHIVE` R2 binding (`wordul-archive`). Because the write is binding-guarded, the deploy is not blocked if the bucket lags; creating it is a runbook step (§8), not a hard precondition.

**Provenance baked in.** `isBot: boolean[]` per player ships in every blob so the future render layer can enforce the human-anchored indexable-graph rule (index a game only if a human participates or it clears the soul gate; `noindex`/`nofollow` all-bot games and bot-profile links) without re-deriving anything.

**Why no DIRECTORY write.** The archive writes nothing to KV. The future word-hub reverse index is an L3 concern — keeping `DIRECTORY` to `user:`/`room:` (plus the non-sitemapped `bot:`) preserves the sitemap whitelist so archive/bot keys can never leak into `/sitemap.xml`.

### 4.6 Believability + SEO honesty

**Believability (L0 floor).** A distracted-but-earnest human, not an optimal solver — and an honest one everywhere it persists.

**Human tells shipped at L0 (`HUMAN_TELLS`).**
1. **Opener loyalty** — guess 1 comes from the bot's per-length favorite first words, not the globally optimal starter. Length-keyed (`openerWords: Record<number,string[]>`) so a `set_length` mid-lobby never strips the bot's most identity-defining behavior; on an unsupported length the fallback is seed-salted rank-N, never a shared rank-1.
2. **Entropy-scaled, non-uniform think-time** — fast opener (`<30s`, typically ~800–3000 ms); longer pauses when the board is hard (few candidates → agonize). Never uniform.
3. **Non-word bounce** — once per mistake budget, submit a plausible non-word (real morphemes, not random letters) and eat the rejection. `applyGuess` checks `guesses.length >= max` *before* validity, so a rejected guess does **not** advance the counter — the solver tracks invalid attempts separately so a bounce costs nothing.
4. **Mistake budget** — bounded fallibility: lower-ranked picks, dead-letter replays, the occasional green-ignore, gated by tier and seed.
5. **Valid-word probing** (higher tiers) — burns `.valid` non-answers mid-game so an expert isn't a tell-by-perfection (§4.2).

**Deferred tells (seams, not built at L0):** AFK multi-minute gaps and tilt-driven mood drift. Both need a real human-timing population to calibrate against (and tilt needs L1 persistence). `computeTilt` ships as a flat `0` no-op so the signature is locked without faking calibration.

**SEO honesty (enforced at L0, deny-by-default).**
- **Bots are never in the sitemap.** `spawnBot` writes only `bot:<handle>`, never a `user:` key. `sitemap()` emits a `<loc>` for every `user:`/`room:` key; with no `user:` key for bots, they are structurally excluded — the indexability-gate principle is real at L0, not a deferred TODO. The `/@handle` page still renders (routing is by the `bot:` sentinel); the profile is reachable by direct link, just not crawled.
- **Bot pages are `noindex`.** `injectMeta` (which already does the `bot:` check to route AGENT-vs-USER) emits `<meta name="robots" content="noindex">` and non-impersonating meta copy ("autonomous Wordul agent", not "{name} on Wordul"). `index.html` gets a `data-meta="robots"` hook for the branch. This is deny-by-default: an ungated page is `noindex` until the deferred render layer's soul gate flips it to `index` *with* machine-readable disclosure.
- **Authority docs disclose the population.** `llms.txt`/`llms-full.txt` state that a share of profiles/games are autonomous agents and describe the consensual spot-the-bot framing as a documented feature, so AIO/GEO engines never cite a bot as a real "top player." A published, linkable policy (the rule: undisclosed in live play, labeled everywhere persistent) makes disclosure a site-wide policy, not an in-the-moment vibe.

---

## 5. The Tick Loop — one round, beat by beat

1. **Mint.** `spawnBot(env, handle, playstyle)` writes **only** the `bot:<handle>` routing sentinel (no sitemap key) and POSTs `/init` to the Agent DO, which persists a fresh `AgentProfile`. The only place a bot identity is born.
2. **Join.** `POST /bot/join` → `addBot(handle, playstyle)` pushes a `PlayerState { connected:true, isBot:true, status:'playing' }`. The bot occupies a real seat (counts against `MAX_PLAYERS`). It never sends `hello`.
3. **Start.** A human sends `{type:'start'}` → `onStart()` picks the word, sets `phase:'playing'`, resets guesses, then `scheduleBotTick()` computes each bot's opener think-time (a fast, impulsive open) and writes `botSchedule` into the `state` blob + `setAlarm(soonest)`. The DO hibernates.
4. **Opener wake.** Cloudflare fires `alarm()`. The ctor has already restored `state` (incl. `botSchedule`). `botView(player, state)` (empty guesses) → `computeNextGuess` returns a per-length favorite first word. `applyGuess` validates → `scoreGuess(word, state.word)` *server-side* (the bot never sees `state.word`) → pushes the masked `GuessRow`. After the loop, `persistAndBroadcast()` — humans watching see the bot's masked row exactly as another human's.
5. **Entropy-scaled pauses.** Next think-time scales with board difficulty: many candidates left → shorter pause; few candidates → an agonizing longer pause; never uniform. The alarm reschedules to the soonest remaining *playing* thinker. Many bots multiplex onto the one alarm; each wake processes every *ready* bot, then a **single** `persistAndBroadcast()`.
6. **Fallible guesses.** Each turn, `applyFallibility` may drop to a lower-ranked pick, replay a dead letter, ignore a green, or (higher tiers) probe a `.valid` non-answer — gated by the mistake budget and skill tier. An occasional non-word bounce is submitted and rejected; the bot eats it and re-picks (the bounce costs no guess). `status` flips to `won`/`lost`; once `state.phase !== 'playing'` mid-loop, the loop breaks.
7. **Finish — fan-outs are fire-and-forget.** When the bot greens out or exhausts guesses, `isGameOver()` (counting `connected || isBot`) returns true → `finishGame()` runs `buildGameRecords(records)` reading `player.isBot`. From the alarm, all of the following fire via `ctx.waitUntil`, never awaited:
   - **Agent DO**: for each `isBot` player, the *identical* `GameRecord` is POSTed to `AGENT /append` (`applyGame` + `appendCapped(100)`) — the same `stats.ts` path a human's User DO uses. The bot's `/@handle` page now shows a real game history (served `noindex`).
   - **Archive**: one R2 blob at `game/{roomPath}/{round}/{finishedAt}.json` (skipped cleanly if `env.ARCHIVE` is unbound), carrying `isBot` provenance.
   - **Structured log**: one finish-event line (the L3-Census seam).
   - After scheduling these, `alarm()` clears the alarm (no zombie wake).

Human clients watching the room see the bot's guess rows appear with their color masks at human pace — exactly what they'd see for another human. The bot, meanwhile, only ever saw its own masks (`BotView`).

---

## 6. Persistence & Scale

**No SQL anywhere.** Each entity is a Durable Object whose private `ctx.storage` is its own little database; `DIRECTORY` (KV) is the cross-entity index; R2 holds blobs. A bot is just another entity — the Agent DO is a User DO's twin (same `profile` key, same `/append` contract, three extra fields), the `bot:<handle>` sentinel is the one routing choke point (never a sitemap key), and the reporting pipeline is reused byte-for-byte.

**Migrations.** `wrangler.jsonc` runs `v1` (`new_classes:['Room']`), `v2` (`new_sqlite_classes:['User']`). The one new DO (`Agent`) lands in a single `v3` — `{ tag:'v3', new_sqlite_classes:['Agent'] }` — with a migration-tag registry comment. (Census is deferred to L3, so there is no Agent+Census tag coordination.) New namespaces on the free plan must be SQLite-backed. **A new DO class without its migration tag fails the deploy** — the `wrangler.jsonc` change ships in the same deploy as the class, and `Agent` must be `export`ed from `worker.ts` or the binding silently fails.

**Caps & watch-points (24/7 population).** Every growing structure has an owning DO and a cap.

| Cap | Owner | Value | Why |
|-----|-------|-------|-----|
| `HISTORY_CAP` (games) | User / Agent DO | 100 | Hot DO state stays small/fast; full history lives in the cold R2 archive. |
| `ROOMS_CAP` (ownedRooms) | User / Agent DO | 100 | Same. |
| Room history | Room DO | 20 (`MAX_HISTORY`) | Per-room recent results, capped today. |
| Room chat | Room DO | 40 (`MAX_CHAT`) | Capped today. |
| **`SCOREBOARD_CAP`** | **Room DO** | **100 (NEW)** | **`bumpScoreboard` is the only unbounded member of the 128 KB Room `state` blob. L0 introduces the roaming bot actor that makes it grow per distinct visitor forever; cap + LRU/top-N eviction (sort by `played`/last-seen, slice) now — not L3.** |
| Archive R2 key | R2 | `game/{roomPath}/{round}/{finishedAt}.json` | One object per round → short per-room LISTs. |

- **`isBot` is authoritative from persisted `PlayerState`** — no per-player KV read on finish, no eventual-consistency ghost-human race. `addBot` sets it; `onHello` additionally cross-checks `DIRECTORY.get('bot:<username>')` and refuses to mark a bot-handle claimant as a non-bot (the known-gap mitigation).
- **DIRECTORY eventual consistency**: only affects routing reads. `spawnBot()` retries the `bot:` sentinel write with backoff; `/init` is idempotent, so double-mint is safe.
- **Observability**: the structured finish-log line is the L3 Census seam; build the (deferred) shard key as `censusShardKey()` returning `'global'` so the L3 shard-by-day swap is one line.
- **Bots not sitemap'd / dead-room reaper**: bot sitemap-exclusion is **structural at L0** (no `user:` key written). The reaper stays L3.
- **Finish wall-time inside the alarm**: every finish report fires via `ctx.waitUntil`, so a slow KV/DO/R2 hop never stretches the alarm handler or delays a concurrent game's bot pacing in the same DO.

---

## 7. Testing Strategy

**Cheat-isolation (the sacred test).**
- **Structural**: assert `solver.ts`'s module graph has zero transitive import to `room.ts` / `user.ts` / any `word`-bearing symbol on `RoomSnapshot`. `computeNextGuess(view, playstyle, seed)` is the entire game-state surface — `BotView` has no `word` field, so the answer cannot be a parameter.
- **Bridge**: assert `botView()` (in `room.ts`) references neither `state.word` nor `scoreGuess` — the answer becoming reachable requires editing this one bridge signature.
- **Spy**: feed the solver a mock `GuessRow[]` whose answer accessor *throws* — confirm the answer is never reachable.
- **Integration**: mount the Room DO in a miniflare harness, add a bot, run several alarm ticks, spy on `computeNextGuess` — assert no `BotView` ever carried `state.word`.

**Solver unit tests** (masks built via the *real* `scoreGuess`, which emits `'gray'`).
- Green pins position; yellow present-but-not-here; **gray contributes an upper-bound via `minCounts`** (unless green/yellow elsewhere).
- **Duplicate-letter mask**: a letter twice (one green, one gray) allows exactly one instance — matches `scoreGuess`'s leftover-counting; a naive gray-exclusion impl fails this (the test that catches the gray/grey drift).
- Opener loyalty on guess 1 (per-length); length-mismatch fallback is seed-salted (two handles → two different fallback words); determinism (same seed + inputs → identical output across 1000 calls); `applyFallibility` fires a non-rank-1 pick under a triggering seed; empty-candidate fallback returns safely (never throws).
- **Seed collision**: 100 distinct handles in the same room/round/guess yield 100 distinct first guesses.
- **Skill-tier gap**: `novice` mean guess-count statistically worse than `expert` (t-test `p<0.05`) over 500 games each, and `novice` fires at least one non-word bounce; an `expert` (`probeWithValid`) fires at least one `.valid` non-answer probe.

**Pacing tests.** Opener `<30s` for every tier; `candidateCount=1` median think-time > `candidateCount=150` median; **think-time distribution is not uniform** (a simple spread/variance assertion — the full K-S/bimodality forensics suite is deferred to L3 with the human-timing population); no round-number tells (no exact 1000 ms multiples in range); `computeTilt` returns `0` (no-op seam).

**Room-tick integration tests** (`room.tick.test.ts`, mock `ctx.storage` + alarm).
- `addBot` sets `isBot:true`; the bot never appears in `DIRECTORY` via the join path.
- `isGameOver()` is `false` with a lone playing bot and zero connected humans; a bot-only room runs to completion and **clears its alarm**.
- `alarm()` advances one guess and reschedules while playing; **does not reschedule once the game is finished**; **a second ready bot in the same wake does not guess after `finishGame` fired** (mid-loop `phase` break); two ready bots both move before a single `persistAndBroadcast`; a non-word retry never crashes the handler.
- **Cold-wake**: fresh DO instance with storage pre-seeded (`botSchedule` in the `state` blob) — `alarm()` still finds its schedule and proceeds.
- `finishGame()` routes bot records to the **AGENT** stub (not USER), human records to USER, **trusting `player.isBot` with no `DIRECTORY.get`**; reports fire via `ctx.waitUntil`.
- **One-scoring-path**: `onGuess` and the alarm both route through `applyGuess`; a spy asserts `applyGuess` is the sole scorer.

**Archive tests** (in-memory mock R2, no Miniflare). R2 `put()` spy asserts the key matches `game/{roomPath}/{round}/{finishedAt}.json`, a clean JSON round-trip, and `isBot[]` provenance present; `archiveGame` resolves when `put()` rejects; **`archiveGame` is a clean no-op when `env.ARCHIVE` is unbound**. **Isolation regression**: a throwing archive must not stop the game finishing or the USER/AGENT reports firing. **Sitemap regression**: no `archive:`/`bot:` keys (and no bot handles) ever appear in `/sitemap.xml`; a minted bot's `/@handle` HTML carries `noindex`.

**End-to-end smoke.** Mint two bots of different tiers, run a mocked game through the alarm path, assert both `AgentProfile`s updated with the correct `GameRecord` — the full report pipeline, proven.

---

## 8. Open Questions

*(Critical-path items previously listed here are now resolved in the spec body: `deriveSeed` = `fnv1a(`${handle}|${roomPath}|${round}|${guessCount}`)`, append-only (§4.2); `isBot` authoritative from `PlayerState`, no KV fallback (§4.3, §6); single `v3` migration, no Census coordination (§6); answers-vs-valid resolved as a tier-gated `probeWithValid` mix (§4.2); per-length opener map (§4.1); tilt deferred as a flat no-op seam (§3); handle-claim demoted to a Known Accepted L0 Gap (§3). The remaining genuinely-open items:)*

1. **Non-word bounce corpus.** Bounces must look like real English morphemes per length to pass inspection. **Resolution to confirm:** a curated table with a **per-length minimum of ≥12 plausible non-words** (so bounces don't repeat-tell within a game's mistake budget), owned alongside `WORDS_BY_SIZE`, frozen append-only like the openers. Who curates the seed list?
2. **`.valid` probe fraction per tier.** `probeWithValid` is on for higher tiers, but the exact mid-game fraction (and the candidate-set constraint that keeps the `.valid` scan inside the alarm budget) wants one calibration pass before expert bots ship — answers-only stays the novice/casual fast path regardless.
3. **R2 bucket provisioning.** `wordul-archive` should be created (`wrangler r2 bucket create`) as a deploy-runbook step. Because `archiveGame` is binding-guarded (no-op when unbound), a lagging bucket does **not** block the L0 deploy — but confirm the runbook lists it so archiving is live on day one.
4. **Census ring depth / shard granularity (L3).** When the L3 Census is built against the archive, choose the recent-window depth and the `censusShardKey()` granularity (global vs per-day vs roomPath-hash). Not an L0 decision; the `'global'` seam is already in place.
