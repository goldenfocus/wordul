# Living Arena — Increment 2: Multi-Bot Seats + N-Player Race — Design

**Date:** 2026-06-04
**Status:** Approved (brainstorm) → ready for implementation plan (run `superpowers:writing-plans` on this).
**Base:** branch off latest `origin/main`. Increment 1 (breathing count + length variety) already shipped to prod (`prod-339`).
**Builds on:** `2026-06-02-arena-liquidity-bots-design.md` (v1) and `2026-06-04-living-arena-v2-design.md` (v2 umbrella). This is the second of three increments under the v2 umbrella.

> **Read first, in order:** the v2 umbrella spec (`…living-arena-v2-design.md`) for the why, then this. This doc is written to be implementable **from a cold context** — §"Current single-bot assumptions" has the exact code that must change.

---

## What this increment delivers

The last visible "spot the bot" tell from Increment 1 is that **every room is `1/2`**. This increment makes seat counts genuinely vary — `1/2`, `2/3`, `1/3`, `4/5`, `3/4` — and makes **joining** one a real, winnable **N-player race** (you vs the bots that fill the room). It takes the Room Durable Object from its current hard-coded **single-bot** model to **multiple bots per room**.

**The magic moment:** Open Arena → see rooms of different sizes (`2/3`, `4/5`) with different word lengths → tap a `2/3` → it fills to `3/3` → you race **two** little characters at once, "first to guess wins" → and you can still win.

### In scope
- `SeedRec` carries `capacity` (2–5) and `botCount` (1…capacity−1); `seats` = `${botCount}/${capacity}`.
- Pure `rollSpawn(rolls)` chooses capacity + botCount (weighted toward small rooms).
- `pickPersonas(seedCount, n, openIds)` — n **distinct** personas for a multi-bot room.
- Room DO seeds **k bots**, and on a human join **fills the remaining seats with bots** then auto-starts an N-player race.
- The bot heartbeat drives **all** bots (per-bot pacing on one alarm), not just the first.
- Difficulty scales with **length AND field size** so racing 2–4 bots stays winnable.
- Disguise holds for N bots (the existing `projectPlayerForClient` chokepoint, now asserted for multi-bot).

### Out of scope (later)
- **Bot-vs-bot "self-start" / in-progress rooms + spectating** → **Phase 2** (these are the same feature; a multi-bot game you can't watch has little value, so they ship together).
- **"Play now" escape-hatch button + Arena UI polish (in-progress strip)** → **Increment 3**. (Varied `seats` already render in the existing row UI for free this increment.)
- Skill levels / tuning dials → v3.

---

## ⚠️ The one product fork to confirm before building

Two readings of "varied seats":

- **(A) Recommended — join = N-player race.** Tapping a `4/5` makes you race 4 bots. Varied lobby **and** a new battle-royale-ish mode. This spec is written for (A).
- **(B) Lobby-only atmosphere.** Multi-bot rooms exist to make the lobby look alive and are primarily **spectate** targets (Phase 2); rooms a human can *join* stay small (`1/2`, `1/3` → race 1–2 bots). Less Room surgery now.

**The original ask** ("some might be waiting 1/3 4/5 etc" + "you can be a viewer … see all sides") leans toward varied lobby + **spectating** the bigger games — which is closer to (B) with spectating in Phase 2. **Confirm with Yan which one he wants before writing the plan.** If (B): build only the `SeedRec`/`rollSpawn`/`pickPersonas`/seed-k-bots parts, keep human-join capacity ≤ 3, and skip the N-player race tuning. The rest of this spec still applies. The implementer should ask via AskUserQuestion at plan time.

---

## Current single-bot assumptions (EXACT code that must go plural)

All in `src/room.ts` unless noted. Reference by **function name + snippet** (line numbers drift). Every one of these assumes exactly one bot via `players.find(p => p.isBot)` or a `some(isBot)` gate.

**1. `SeedBody` contract (top of room.ts) — singular persona:**
```ts
type SeedBody = {
  path: string;
  persona: { id: string; name: string; avatar: string };   // → personas: {…}[]
  profile: "noob";
  edition: string;
  wordLength: number;                                        // → add: capacity: number
};
```

**2. `handleSeed(req)` — injects one persona:**
```ts
this.state.seed = { personaId: b.persona.id, profile: b.profile };   // → seed needs to track capacity + roster
…
this.ensureBot(b.persona);                                            // → ensureBots(b.personas, capacity-? )
```

**3. `ensureBot(persona?)` — single-bot gate (the core):**
```ts
private ensureBot(persona?: { id: string; name: string; avatar: string }): void {
  if (this.state.isDaily) return;
  if (!this.isRobotRoom() && !this.state.seed) return;
  if (this.state.players.some((p) => p.isBot)) return;     // ← STOPS at one bot
  if (this.state.players.length >= MAX_PLAYERS) return;
  this.state.players.push({ username: persona ? persona.id : BOT_NAME, …, isBot: true, … });
  if (this.isRobotRoom()) this.pushSystem(`🤖 ${BOT_NAME} powered on …`);   // /robots only — keep
}
```
Generalize to add **up to a target count** of distinct bots (each with its own persona username/avatar), never exceeding `MAX_PLAYERS` (8). The `/robots` room keeps the single-clanker behavior + its system line.

**4. Seeded auto-start in `onHello(...)` — finds one bot, starts:**
```ts
this.ensureBot();
if (this.state.seed && this.state.phase === "lobby" && this.state.players.some((p) => !p.isBot && p.connected)) {
  const persona = this.state.players.find((p) => p.isBot);     // ← single
  await this.runStart(persona?.username ?? "arena");
}
```
Generalize: on the human's join, **fill remaining seats** (`capacity − currentPlayers`) with fresh distinct bots, then `runStart`. The "who started" label can stay any persona name or "arena".

**5. Seeded 1-human cap in `onHello(...)` (keep as-is):**
```ts
if (this.state.seed && this.state.players.some((p) => !p.isBot)) { /* reject 2nd human */ }
```
Still correct — a seeded room is exactly **1 human + N bots**. Don't change.

**6. `scheduleBotTick()` — paces ONE bot:**
```ts
private scheduleBotTick(): void {
  const bot = this.state.players.find((p) => p.isBot);          // ← single
  const opening = !bot || bot.guesses.length === 0;
  const seeded = !!this.state.seed;
  const base = seeded ? (opening ? 10000 : 7000) : (opening ? 6000 : 4000);
  const spread = seeded ? 10000 : 6000;
  void this.ctx.storage.setAlarm(Date.now() + base + Math.floor(Math.random() * spread));
}
```
Replace with per-bot scheduling (see §"Per-bot heartbeat").

**7. `alarm()` playing-phase — advances ONE bot:**
```ts
const bot = this.state.players.find((p) => p.isBot && p.status === "playing");   // ← single
if (!bot) return;
const view = { wordLength: this.state.wordLength, ownGuesses: bot.guesses };
const word = this.state.seed
  ? noobGuess(view, { mistakeRate: mistakeRateFor(this.state.wordLength) }, Math.random())   // ← Inc.1: length-scaled
  : computeNextGuess(view);
if (word) await this.applyGuess(bot, word);
await this.persistAndBroadcast();
const stillGoing = this.state.players.some((p) => p.isBot && p.status === "playing");
if (stillGoing && this.state.phase === "playing") this.scheduleBotTick();
```
Replace with a loop over **all due bots** (see §"Per-bot heartbeat").

**8. `src/arena.ts` `alarm()` seed POST — sends one persona + capacity-less body:**
```ts
body: JSON.stringify({
  path,
  persona: { id: persona.id, name: persona.name, avatar: persona.avatar },   // → personas: [...]
  profile: "noob",
  edition: persona.edition,
  wordLength,                                                                  // → + capacity
}),
```

**9. `src/bots.ts` `pickPersona(seedCount, openIds)` — picks one.** Add `pickPersonas(seedCount, n, openIds)` returning up to `n` distinct (fewer if roster exhausted; `pickPersona` becomes the n=1 case). `projectPlayerForClient` (the disguise total-omit) already handles any number of bots — leave it, but add a multi-bot test.

**Disguise note:** `RoomSnapshot` carries `isBot` server-side; the outbound projection strips it via `projectPlayerForClient` (`bots.ts`). With N bots the chokepoint is unchanged — just assert it for the N case.

---

## Data + contract changes

### `src/arena-core.ts` (pure)
- `SeedRec` add: `capacity: number;` and `botCount: number;`. `seats` becomes the derived `${botCount}/${capacity}` (set at mint; or compute in `openGames`). `host`/`personaId`/`personaIcon` stay the **face** persona (the first of the room's bots) for the lobby row.
- New pure helper `rollSpawn(rCap: number, rBots: number): { capacity: number; botCount: number }`:
  - `capacity` from a weighted table favoring small rooms, e.g. `CAPACITY_WEIGHTS = [[2,6],[3,4],[4,2],[5,1]]` (mostly 2–3, occasional 4–5).
  - `botCount` ∈ `[1, capacity-1]` (always ≥1 open seat for the human), rolled from `rBots`.
  - Pure + injected rolls (same pattern as `rollWordLength`/`rollLifetime` from Inc.1). Unit-test bounds exhaustively.
- `OpenGame` may stay as-is (it already exposes `seats`, `wordLength`); optionally add `capacity`/`botCount` if the UI wants them. Keep zero internal fields (no `mintedAt`/`status`/`personaId`/`lifetimeMs`).

### `src/bots.ts`
- `pickPersonas(seedCount: number, n: number, openPersonaIds: ReadonlySet<string>): BotPersona[]` — walk roster from `seedCount`, skip open personas, return up to `n` distinct. `pickPersona` = `pickPersonas(...,1,...)[0] ?? null`.
- **Roster size caveat:** v1 has 7 personas. Many concurrent `4/5` rooms can exhaust it → `pickPersonas` returns fewer → that room just has a smaller `botCount` (graceful). If Yan wants frequent big rooms, grow `PERSONAS`. Don't crash, don't duplicate a persona within a room or across two open rooms.

### `src/room.ts`
- `SeedBody`: `personas: { id; name; avatar }[]` + `capacity: number` (drop singular `persona`, or accept both for one release for safety — recommend hard switch since `/seed` is server-internal and atomic with the arena change).
- `state.seed`: extend to `{ profile; personaIds: string[]; capacity: number }` (or keep `personaId` as the face + add `capacity`). H2H still keys per-persona.
- `PlayerState` (`src/types.ts`): add `nextGuessAt?: number` (epoch ms; only set on bots; self-healing default `undefined`). This is how N bots pace independently on one alarm.

### `src/arena.ts`
- Use `rollSpawn(Math.random(), Math.random())` → `{ capacity, botCount }`; `pickPersonas(seedCount, botCount, openIds)` for the room's bots; set `rec.capacity/botCount/seats`; POST `/seed` with `personas[]` + `capacity` + `wordLength` (+ keep Inc.1's rolled `wordLength`/`lifetimeMs`). The `host`/`personaIcon` on the rec = the first persona.

---

## Per-bot heartbeat (the load-bearing rework)

One DO alarm must drive **all** bots in a room, each at its own human-ish cadence.

**Model:** each bot carries `nextGuessAt`. On every alarm fire in the **playing** phase:
1. `now = Date.now()`.
2. For each `bot` with `bot.isBot && bot.status === "playing" && (bot.nextGuessAt ?? 0) <= now`:
   - compute `noobGuess(view, { mistakeRate: mistakeRateFor(wordLength, opponents) }, Math.random())` where `view = { wordLength, ownGuesses: bot.guesses }`;
   - `await this.applyGuess(bot, word)`;
   - set `bot.nextGuessAt = now + botDelay(opening=false)`.
3. `await this.persistAndBroadcast()` **once** after the batch (not per-bot — one broadcast).
4. Reschedule: `setAlarm(min over still-playing bots of nextGuessAt)`. If none playing, don't re-arm (finish flow handles end).

**Start (`runStart`):** after flipping to `playing`, for each bot set `bot.nextGuessAt = now + botDelay(opening=true)` (slower opener, ~10–20s), then `setAlarm(min nextGuessAt)`. Replace the single `scheduleBotTick()` call.

`botDelay(opening)`: keep Inc.1/v1 pacing — seeded opener ~10–20s, subsequent ~7–17s, with per-bot `Math.random()` jitter so the bots don't move in lockstep (lockstep is a tell).

**Why one alarm, not N:** a DO has a single alarm slot. Storing `nextGuessAt` per bot and always arming the soonest is the standard "min-heap on one timer" pattern and reuses the existing alarm plumbing (no new concurrency primitive). `maybeFinish()` already ends the game when **all connected players are done**, so it works unchanged once every bot eventually wins or exhausts `maxGuesses`.

> **Edge:** the `finished`-phase alarm (rematch handshake) and the `playing`-phase bot heartbeat are mutually exclusive (existing invariant) — keep them so. Lobby phase has no alarm need this increment (auto-start is instant on join).

---

## Beatability with a field of bots (don't break the magic)

Racing `capacity−1` bots is harder than 1 — more chances a bot wins first. Preserve "you can win":
- Extend Inc.1's `mistakeRateFor(length)` → `mistakeRateFor(length: number, opponents: number)`: add a small per-extra-opponent fallibility bump (e.g. `+0.05 * (opponents − 1)`, capped < 1). More bots → each fumbles a bit more, so the field stays beatable.
- Weight `CAPACITY_WEIGHTS` toward 2–3 so most joinable rooms are gentle; 4–5 are the rare "lively" ones.
- Unit-test `mistakeRateFor` monotonic in both args and bounded `[0,1)`.

Tune the exact bumps in the final step against real play (a 5-player 8-letter room should be *hard but winnable*, not hopeless).

---

## Auto-start: fill-then-go (no countdown)

The repo's existing pattern is **instant start, no ready/countdown** (an immediate GO! animation — there is no countdown/ready state today). Match it:
- On the human's `hello` to a seeded lobby: `ensureBots` until the room has `capacity` players total (the human + bots) — i.e. add `capacity − players.length` fresh distinct-persona bots — then `runStart` immediately.
- A brief ~2s "filling…" countdown is **optional polish** (would need a lobby-phase alarm branch). Spec it as a follow-up nicety, not a v2 gate.

---

## Disguise integrity (unchanged invariant, N-bot surface)

- One chokepoint: `projectPlayerForClient` strips `isBot` for every player — already N-safe.
- No `🤖 powered on` line for seeded rooms (only `/robots`). Multi-bot join must not emit any per-bot "X joined" system line that reads robotic — seeded personas join silently (mirror current behavior).
- **Test:** an N-bot room's client-facing snapshot contains `isBot` for **no** player; no seed/persona-internal field leaks.

## Fairness invariant (unchanged, load-bearing)

Every bot sees only its own `BotView` (`{ wordLength, ownGuesses }`) — never `state.word`. `solver.ts`/`noob.ts` stay structurally blind; the src-reading guards in `test/noob.test.ts` and `test/solver.test.ts` stay green. Multi-bot changes nothing here.

---

## Testing (pure-first, repo Vitest style)

- `arena-core`: `rollSpawn` honors `capacity ∈ table`, `1 ≤ botCount ≤ capacity-1`, under injected rolls; `seats` derives correctly; `SeedRec` round-trips through `apply`/`prune`/`openGames` with the new fields; `OpenGame` still omits internal fields.
- `bots`: `pickPersonas(n)` returns n distinct, skips open personas, degrades to fewer when exhausted, never duplicates within a room; `pickPersona` still the n=1 case; **multi-bot disguise** — `projectPlayerForClient` over an array of bots leaks no `isBot`.
- `noob`: `mistakeRateFor(length, opponents)` monotonic in both, bounded `[0,1)`; `noobGuess` unchanged guarantees (legal length, blindness src-guard).
- Room (where unit-testable / via existing room test harness): seeding k bots produces k `isBot` players ≤ MAX_PLAYERS; human join fills to capacity and starts; the per-bot heartbeat advances every bot to terminal and `maybeFinish` ends the game.
- Smoke (local `npm run dev`): `/api/arena/open` shows varied `seats` (`2/3`, `4/5`, …) and lengths; join a `2/3` → race 2 bots → game finishes → you can win; join a `4/5` long-word room → hard but winnable; no `isBot` in any client snapshot (check the WS payload).

---

## Deploy / migration

- **No new DO, no migration.** ARENA is at **v6** (`new_sqlite_classes: ["Arena"]`). This increment evolves `SeedRec`/`SeedBody`/`PlayerState` shapes only — use self-healing defaults (existing `load()` backfill pattern). Note: persisted v1/Inc.1 `SeedRec`s lack `capacity`/`botCount` → treat missing as `capacity: 2, botCount: 1` (the old `1/2`) so legacy rooms render sanely until they churn out.
- **Ship via `bash dev/ship.sh`** (or `/push`): tests → rebase `origin/main` → backup tag → push `HEAD:main` → **CI deploys** (`.github/workflows/deploy.yml`, watched). Never `wrangler deploy` by hand. Tier C (no migrations / money path).
- **prod-is-dev:** the Arena tab is publicly live. Keep disguise + beatability intact at every green step. Sequence so the seed-k-bots + per-bot heartbeat land before any `capacity > 2` room is mintable (otherwise a multi-bot room with a single-bot heartbeat would have frozen, never-guessing bots and never finish — see step order).

---

## Suggested build sequence (for the plan)

1. **`bots.ts` `pickPersonas`** + tests (pure; `pickPersona` becomes the n=1 case).
2. **`arena-core.ts`** `rollSpawn` + `capacity`/`botCount` on `SeedRec` + derived `seats` + legacy defaults + tests (pure; no behavior change yet — arena.ts still seeds 1/2).
3. **`noob.ts`** `mistakeRateFor(length, opponents)` + tests.
4. **`room.ts` heartbeat first (invisible safety):** add `nextGuessAt` to `PlayerState`; convert `scheduleBotTick`→per-bot scheduling and the `alarm()` playing branch to drive **all** due bots. With still only 1 bot per room this is a no-op behaviorally — verify existing single-bot rooms (incl. `/robots`) still play identically. **This must land before step 6.**
5. **`room.ts` seeding:** `SeedBody.personas[]` + `capacity`; `ensureBots` (multi); fill-then-start on human join.
6. **`arena.ts`:** `rollSpawn` + `pickPersonas` + POST `personas[]`/`capacity`; now multi-bot rooms actually mint. Verify via `/api/arena/open` (varied seats) and by joining (N-bot race finishes + winnable).
7. **Tune** `CAPACITY_WEIGHTS` + `mistakeRateFor` opponent bump against real play.

---

## Resume note (for the fresh session)

1. `git fetch origin main` → make a worktree off `origin/main` (`bash dev/start.sh living-arena-2`).
2. Read this spec + `…living-arena-v2-design.md`. **Confirm the §"product fork" (A vs B) with Yan via AskUserQuestion before planning.**
3. Run `superpowers:writing-plans` on this spec → execute task-by-task (TDD, commit per green step) → `bash dev/ship.sh` when green.
4. Increment 3 (Play-now hatch + Arena UI in-progress strip) and Phase 2 (real bot-vs-bot + spectating) remain after this.
