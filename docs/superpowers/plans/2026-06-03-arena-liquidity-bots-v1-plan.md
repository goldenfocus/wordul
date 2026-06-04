# Arena Liquidity Bots v1 — Implementation Plan

## 1. Title · Magic moment · Architecture

**The one magic moment:** Open Wordul → tap **Arena** → see a game waiting (`1/2`) → join → race a beatable little character → win → see **"You vs Maya: 1–0."**

**Architecture (4 lines):**
1. A new singleton **ARENA** Durable Object owns the authoritative Open-Games index as one status-carrying record set (`minted → registered → closed`), modeled as a pure, fully-tested reducer (`arena-core.ts`) plus a thin DO wrapper (`arena.ts`); its `alarm()` keeps ~3 bot-rooms waiting and prunes ghosts.
2. The existing **ROOM** DO gains a server-to-server `POST /seed` route so a room can exist *before* any human connects: it stamps a `seed` marker, injects a persona as a silent waiting player, registers itself with ARENA, and auto-starts the instant a human joins.
3. The persona plays via `noob.ts` — a blind, fallible, slow wrapper around the sharp solver — and is disguised by a single outbound `snapshotFor` projection that strips `isBot`/`seed`, with the `🤖 powered on` chat line suppressed for seeded rooms; H2H records live on the human's USER DO keyed by the opponent's visible name.
4. The **Arena tab** (`hub.js`) is the only public entry point and flips on **last**, after disguise + noob + seeding are all in prod.

---

## 2. Sacred Stops in this plan (owner sign-off required before push)

| # | Gate | Where | Why |
|---|------|-------|-----|
| **S1** | **v6 wrangler migration** `{ "tag": "v6", "new_sqlite_classes": ["Arena"] }` | Slice A (`wrangler.jsonc`) | Tier A. New DO namespace. `new_sqlite_classes` is mandatory (free plan, err 10097, dry-run won't catch it). A duplicate/wrong tag is the Mar 4 2026 version-collision incident class. The DO namespace is **permanent once created** (not cleanly reversible). |
| **S2** | **Slice D deploy depends on v6 being live** | Slice D (`POST /open`/`/close` calls into ARENA) | Tier A coupling. Must confirm `schema_migrations` shows `v6` applied (per the verify-or-die scar) before Slice D ships, or seeded rooms call a binding that doesn't exist. |
| **S3** | **`src/user.ts` `/h2h` edit (money-path-ADJACENT)** | Slice E | The gold ledger (`/ledger/append`) lives in this file and one `endsWith` shadow already broke all gold minting once. Owner must review the final routing diff and confirm the gold-mint smoke still passes. |
| **S4** | **Making the Arena tab public** | Slice F (`hub.js:47` stub → live) | The only public reachability gate. Must not ship until disguise (Slice C) + noob (Slice B) are confirmed in prod. |

Slices B (`noob.ts`), C (`bots.ts` + disguise) are **Tier C — auto-ship when the gauntlet is green.** A, D, E, F carry the gates above.

---

## 3. Pre-flight

```bash
# 1. Isolated worktree (project norm — avoids the colony shared-checkout hazard)
git fetch origin main
git worktree add .worktrees/arena-bots -b arena-bots origin/main
cd .worktrees/arena-bots

# 2. Confirm the CURRENT max migration tag — DO NOT trust this doc's "v6".
#    Read wrangler.jsonc and confirm the highest tag is v5 (Science).
grep -n '"tag"' wrangler.jsonc        # must show v1..v5; v5 = Science → next is v6

# 3. Baseline green
npx vitest run                         # must be fully green before any new code
```

**Confirmed at plan time (re-verify at execution):** `wrangler.jsonc` has `v1 Room · v2 User · v3 Challenge · v4 Daily · v5 Science` (lines 65–96), all post-Room DOs use `new_sqlite_classes`. **Next tag is `v6`.** Worker exports at `worker.ts:13` are `{ Room, User, Challenge, Daily, Science }`. `BotView = { wordLength, ownGuesses: {word,mask}[] }` (solver.ts:18). Edition ids: `default, yang, jackpot, arcade, editorial, tactile, robot` (public/editions/index.js). `module-graph.test.ts` scans **only `public/`** — it cannot see `src/`; the real blindness guard is a source-regex test (solver.test.ts:65–77).

---

## SHIP ORDER (resolves the integration + invariants review)

The blueprints were authored numbered 1–6, but two reviewers proved that **public reachability begins the moment a live seeded room exists** (a public `GET /api/arena/open` lists it + a direct URL joins it), not at the tab. So disguise and noob must land **before** any live mint. Final order:

> **A** (ARENA core+DO+migration, alarm seeding inert) → **B** (noob) → **C** (bots roster + disguise projection + chat suppression) → **D** (Room `/seed` + auto-start + activate ARENA seeding) → **E** (H2H) → **F** (Arena tab, last).

Rationale: A's `alarm()` is a verified no-op until D wires `pickPersona`+`/seed`. So A, B, C all reach prod with **zero** live seeded rooms. D is the first slice that mints a live, joinable bot room — by which point disguise (C) and noob (B) are already in prod. E keys H2H off the visible opponent name (no new wire field). F is the only public surface.

---

## Slice A — ARENA reducer + DO + v6 migration + `GET /api/arena/open` (empty)

**Objective.** Deliver the authoritative coordinator substrate: a pure, fully-tested index reducer (`arena-core.ts`) modeling `SeedRec` lifecycle, a thin DO wrapper (`arena.ts`) with `GET /open` / `POST /open` / `POST /close` / `alarm()`, the `Env.ARENA` binding, the **v6** migration, and the worker route `GET /api/arena/open`. The `alarm()` seed loop is a **verified no-op** (no `bots.ts`, no `/seed` yet) so this deploys clean with an empty Arena. Unlocks: the coordinator exists and responds correctly; it will auto-fill once Slice D activates seeding.

**Files.**

*Created:*
- `src/arena-core.ts` — pure reducer, zero CF deps.
- `src/arena.ts` — DO wrapper (imports `cloudflare:workers`, `./types.ts`, `./arena-core.ts` only).
- `test/arena-core.test.ts` — Vitest pure units.

*Modified:*
| File | Anchor | Change |
|---|---|---|
| `src/types.ts` | `interface Env` (line 26, after `SCIENCE`) | Add `ARENA: DurableObjectNamespace;` |
| `wrangler.jsonc` | `durable_objects.bindings` (lines 40–44, after Science) | Add `{ "name": "ARENA", "class_name": "Arena" }` |
| `wrangler.jsonc` | `migrations` (after v5 block, line 96) | Append the **v6** block (S1) |
| `src/worker.ts` | export line (line 13) | `export { Room, User, Challenge, Daily, Science, Arena };` + `import { Arena } from "./arena.ts";` |
| `src/worker.ts` | before `// Profile JSON API` (line 54) | Add the `GET /api/arena/open` route (exact-equality match) |

**Interfaces (canonical — all later slices import these).**

```ts
// src/arena-core.ts
export type SeedStatus = "minted" | "registered" | "closed";
export type SeedRec = {
  path: string;        // DO key form: "arena/<personaId>-<seedCount>"
  routePath: string;   // routable form: "/@arena/<personaId>-<seedCount>"  ← client navigates here
  name: string;        // room display name
  host: string;        // persona display name (looks human)
  personaId: string;   // stable key: persona uniqueness + H2H
  personaIcon: string; // human avatar (emoji)
  edition: string;     // theme id from the existing library
  wordLength: number;  // always 5 in v1
  seats: string;       // "1/2"
  mintedAt: number;    // epoch ms at mint
  status: SeedStatus;
};
export type ArenaState = { seeded: Record<string, SeedRec>; seedCount: number };
export type ArenaEvent =
  | { type: "mint";     rec: SeedRec }
  | { type: "register"; path: string }
  | { type: "close";    path: string };
// Client projection — NO internal fields (no mintedAt, status, personaId).
export type OpenGame = Pick<SeedRec,
  "routePath" | "name" | "host" | "personaIcon" | "edition" | "wordLength" | "seats">;

export const STALE_MS    = 60_000;            // minted-not-registered TTL
export const MAX_OPEN_MS  = 4 * 60 * 60 * 1000; // registered max lifetime FROM MINT
export const TARGET_OPEN = 3;
export const MAX_SEEDED   = 10;

export function emptyArenaState(): ArenaState;
export function apply(state: ArenaState, event: ArenaEvent): ArenaState;
export function prune(state: ArenaState, nowMs: number): ArenaState;
export function openGames(state: ArenaState): OpenGame[];   // status === "registered"
export function liveCount(state: ArenaState): number;        // status !== "closed"
```

> **Review fix (defect 1, integration):** `OpenGame` carries **`routePath`** (`/@arena/<persona>-<n>`), the form `parseRoute` (app.js:82, `ROOM_RE`) accepts and the worker `/ws?room=…` resolves. The DO key stays `arena/<persona>-<n>`. Slice F navigates to `game.routePath` verbatim.
> **Review fix (defect 7, mint lifetime):** `MAX_OPEN_MS` is lifetime-from-mint (not reset on register) — documented in the prune comment.

**TDD steps.**

| # | (a) Failing test — `test/arena-core.test.ts` | (b) Minimal impl | (c) Verify |
|---|---|---|---|
| A1 | `"emptyArenaState returns empty seeded + seedCount 0"` → `expect(emptyArenaState()).toEqual({ seeded:{}, seedCount:0 })` | `emptyArenaState` | `npx vitest run test/arena-core.test.ts` |
| A2 | `"apply mint inserts status=minted and bumps seedCount"` | `apply` `mint` case: insert rec, `seedCount+1` | same |
| A3 | `"apply register flips minted→registered, seedCount unchanged"` | `register` case (no-op if missing/closed) | same |
| A4 | `"apply close flips any status→closed (idempotent)"` | `close` case | same |
| A5 | `"liveCount counts minted+registered, not closed"` → expect 2 of 3 | `filter(status!=="closed").length` | same |
| A6 | `"openGames returns only registered, projected to OpenGame (no personaId/status)"` → assert `!("personaId" in g)` | filter `registered`, map to `OpenGame` incl. `routePath` | same |
| A7 | `"prune drops minted older than STALE_MS"` | `prune`: drop `minted` where `now-mintedAt>STALE_MS`; drop `registered` where `now-mintedAt>MAX_OPEN_MS`; always drop `closed` | same |
| A8 | `"prune drops registered older than MAX_OPEN_MS"` | (same prune) | same |
| A9 | `"prune keeps fresh minted (< STALE_MS)"` (boundary) | (same prune) | same |
| A10 | `"prune GCs closed immediately"` | (same prune) | same |
| A11 | **Manual smoke** — wire types/wrangler/arena.ts/worker.ts (see below) | — | `npx wrangler deploy` then `curl https://wordul.com/api/arena/open` → `[]` |

`wrangler.jsonc` v6 block (S1):
```jsonc
{
  // Arena coordinator DO. Free plan: new_sqlite_classes (NOT new_classes — err 10097;
  // dry-run won't catch it, only a real deploy does). Confirm v5 is the prior max.
  "tag": "v6",
  "new_sqlite_classes": ["Arena"]
}
```

`worker.ts` route (exact equality — avoids the `endsWith` shadow class; place before `env.ASSETS.fetch` SPA fallback):
```ts
if (url.pathname === "/api/arena/open" && req.method === "GET") {
  const stub = env.ARENA.get(env.ARENA.idFromName("arena"));
  return stub.fetch(new Request("https://do/open", { method: "GET" }));
}
```

`arena.ts` DO — **`alarm()` seed loop is a guarded no-op in this slice.** `GET /open` only prunes + ensures an alarm is pending; it does **NOT** seed (review fix, defects 6 & 10: seeding from a public GET stacks mints and could later mint a leaky room before disguise lands). Seeding is wired only in Slice D.
```ts
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import { emptyArenaState, apply, prune, openGames, type ArenaState, type SeedRec, type OpenGame } from "./arena-core.ts";

export class Arena extends DurableObject<Env> {
  private async load(): Promise<ArenaState> {
    return (await this.ctx.storage.get<ArenaState>("state")) ?? emptyArenaState();
  }
  private async save(s: ArenaState) { await this.ctx.storage.put("state", s); }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/open") {
      let s = prune(await this.load(), Date.now());
      await this.save(s);
      if ((await this.ctx.storage.getAlarm()) === null) void this.ctx.storage.setAlarm(Date.now() + 5_000);
      return Response.json(openGames(s) satisfies OpenGame[]);
    }
    if (req.method === "POST" && url.pathname === "/open") {
      const b = (await req.json().catch(() => null)) as { path?: string } | null;
      if (!b?.path) return new Response("bad request", { status: 400 });
      await this.save(apply(await this.load(), { type: "register", path: b.path }));
      return Response.json({ ok: true });
    }
    if (req.method === "POST" && url.pathname === "/close") {
      const b = (await req.json().catch(() => null)) as { path?: string } | null;
      if (!b?.path) return new Response("bad request", { status: 400 });
      await this.save(apply(await this.load(), { type: "close", path: b.path }));
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }

  // SLICE A: verified no-op (no bots.ts / no /seed yet). Slice D wires the real seed loop.
  // Wrapped so a future throw can never break GET /open.
  async alarm(): Promise<void> {
    try {
      const s = prune(await this.load(), Date.now());
      await this.save(s);
    } catch (e) { console.error("arena alarm", (e as Error).message); }
    finally { void this.ctx.storage.setAlarm(Date.now() + 60_000); }
  }
}
```

**Commit & Ship gate.** Tier verdict: **HOLD-FOR-OWNER (S1, S2)** — the v6 migration gates the whole slice. After owner approval: deploy → `curl /api/arena/open` returns `[]` → **verify-or-die**: run `./scripts/supabase-run-sql.sh` is N/A here (no Supabase); instead confirm the deploy succeeded (not dry-run) and the Arena binding resolves at runtime. Push call: **HOLD** until owner approves the migration.

**Rollback.** The v6 migration is additive and the DO has no traffic → inert. `git revert` + redeploy removes the binding/route. The DO namespace itself **persists** (flag to owner: permanent once created).

---

## Slice B — `noob.ts`: blind, fallible, slow opponent

**Objective.** Deliver `src/noob.ts`: `noobGuess(view, profile, roll)` calls the sharp solver, and when `roll < profile.mistakeRate` returns a legal, sub-optimal word that **honors confirmed greens** (a believable human slip, not insanity). Wire seeded rooms to call it (via the falsy-`seed` guard, inert until Slice D) and widen seeded pacing. Prove `noob.ts` is structurally blind in a **src-reading** test. After this, the noob mechanism is in prod and inert until a seeded room sets `state.seed`.

**Files.**

*Created:*
- `src/noob.ts` — pure. Imports: `./solver.ts` (`computeNextGuess`, `BotView`), `./wordsbysize.ts` (`WORDS_BY_SIZE`). No `room`/`user`/`daily`/`economy`/`scoreGuess`.
- `test/noob.test.ts` — units **including the blindness regex guard** (review fix below).

*Modified:*
| File | Anchor | Change |
|---|---|---|
| `src/room.ts` | top imports (line 4 area) | `import { noobGuess, NOOB } from "./noob.ts";` |
| `src/room.ts` | `alarm()` line 623 | branch on `this.state.seed`: seeded → `noobGuess(view, NOOB, Math.random())`; else `computeNextGuess(view)` |
| `src/room.ts` | `scheduleBotTick()` lines 610–611 | branch on `this.state.seed`: widen seeded delays |

> **Review fix (invariants finding #1):** the blindness guard goes in `test/noob.test.ts` (reads `../src/noob.ts`), **NOT** `module-graph.test.ts` (which only scans `public/` and is structurally incapable of seeing `src/`).
> **Review fix (invariants finding #2):** keep the `/\.word\b/` assertion; `noob.ts` must **destructure** (`const { word, mask } of guesses`) — never `.word` member access. If the regex ever fires, investigate, do not weaken it.
> **`this.state.seed`** is added by Slice D. Until then it's `undefined` → falsy → existing `computeNextGuess` path for every room. Safe to ship before D.

**Interfaces.**
```ts
// src/noob.ts
import type { BotView } from "./solver.ts";
export type NoobProfile = { mistakeRate: number };  // [0,1)
export const NOOB: NoobProfile = { mistakeRate: 0.4 };
/** roll in [0,1): tests pass fixed values; the DO passes Math.random(). Never computed here. */
export function noobGuess(view: BotView, profile: NoobProfile, roll: number): string;
```

**TDD steps.**

| # | (a) Failing test — `test/noob.test.ts` | (b) Minimal impl | (c) Verify |
|---|---|---|---|
| B1 | `"never returns a word of the wrong length"` — for wordLength 5/6/7, `noobGuess(...).length === wordLength` across several rolls | `return computeNextGuess(view)` (length guaranteed by solver fallback) | `npx vitest run test/noob.test.ts` |
| B2 | `"returns the sharp guess when roll >= mistakeRate"` — boundary `roll = NOOB.mistakeRate` and `0.99` both equal `computeNextGuess(view)` | `if (roll >= profile.mistakeRate) return computeNextGuess(view)` (note `>=`, documented) | same |
| B3 | `"returns a legal sub-optimal green-honoring word when roll < mistakeRate"` — view with green 'C'@0; `noobGuess(view,NOOB,0)` is length-5, in `WORDS_BY_SIZE[5].answers`, `[0]==='C'`, and `!== sharp` | mistake branch: build `greenMap` from `view.ownGuesses` masks; `candidates = answers.filter(honorsGreens && !== sharp)`; pick deterministically (lowest-ranked); empty → `return sharp` | same |
| B4 | `"noob.ts imports nothing answer-bearing"` (src-reading regex, mirrors solver.test.ts:65–77) — strip comments; `not.toMatch` for `from "./room"`, `from "./user"`, `from "./daily"`, `from "./economy"`, `scoreGuess`, `/\.word\b/` | file already only imports `./solver.ts` + `./wordsbysize.ts` | same |
| B5 | **Manual smoke** — `room.ts` wiring | see below | deploy; confirm `robots` room still sharp at 6–12s/4–10s (no behavior change yet, no seeded rooms exist) |

`room.ts` `alarm()` branch (line 623):
```ts
const view = { wordLength: this.state.wordLength, ownGuesses: bot.guesses };
const word = this.state.seed ? noobGuess(view, NOOB, Math.random()) : computeNextGuess(view);
```
`scheduleBotTick()` branch (lines 610–611):
```ts
const seeded = !!this.state.seed;
const base   = seeded ? (opening ? 10_000 : 7_000) : (opening ? 6_000 : 4_000);
const spread = seeded ? 10_000 : 6_000;   // seeded: 10–20s opener, 7–17s subsequent
const delay  = base + Math.floor(Math.random() * spread);
```

> **Review fix (invariants finding #8, disguise polish):** B3's "pick deterministically (lowest-ranked)" produces the strictly-worst legal word every slip — a learnable "honors greens perfectly, forgets everything else" tell. Acceptable for v1 (compounds only under prolonged study), but the executor SHOULD pick a `roll`-seeded sub-optimal candidate rather than the strict worst. Flagged, not a gate.

**Commit & Ship gate.** Tier verdict: **SHIP-WHEN-GREEN** (Tier C; new pure file + two private alarm/pacing edits, inert via falsy `seed`; no migration, no money path). Auto-push when gauntlet green.

**Rollback.** Code-only: `git revert` + `wrangler deploy`. Fully reversible.

---

## Slice C — `bots.ts` roster + `pickPersona` + disguise projection (the single enforcement point)

**Objective.** Create `src/bots.ts` (pure roster + deterministic, uniqueness-aware picker) and harden `snapshotFor` so `isBot` and the `seed` marker never reach a client — the one disguise enforcement point that makes live seeding (Slice D) safe. Also suppress the `🤖 powered on` chat line for seeded rooms. After this, the disguise is in prod **before** any live seeded room exists.

**Files.**

*Created:*
- `src/bots.ts` — pure. May type-import `PlayerState` from `./types.ts`. No `solver`/`wordsbysize`/`room` runtime imports.
- `test/bots.test.ts` — units for roster + `pickPersona` + serialized-snapshot disguise.

*Modified:*
| File | Anchor | Change |
|---|---|---|
| `src/room.ts` | `snapshotFor` lines 993–995 | route BOTH branches through `projectPlayerForClient`; add `seed: undefined` to the spread (review fix below) |
| `src/room.ts` | `ensureBot` line 601 | the `🤖 powered on` `pushSystem` must fire **only** for `isRobotRoom()`, never seeded (review fix, invariants finding #5) |

> **Review fix (defects 17 & 22, invariants finding #6,#7):** `snapshotFor` is edited **once, here**. Slice E does **NOT** re-edit it and does **NOT** add `seedPersonaId` to the wire (that field would be a perfect bot-room oracle — a stronger tell than `isBot`). The merged projection is the final shape; `seed: undefined` shadows any internal `seed` key. TypeScript won't enforce the shadow (the field isn't on `RoomSnapshot`'s declared type) — add a comment documenting the dependency.
> **Review fix (defect 18,19):** persona is injected (Slice D) with a human-looking `username` (lowercased `persona.name`, ≥3 chars to satisfy the board constraint) and `isBot: true` (kept server-side; stripped outbound). The seeded path emits **no** system line.

**Interfaces.**
```ts
// src/bots.ts
export type BotPersona = { id: string; name: string; avatar: string; edition: string; blurb: string };
export const PERSONAS: BotPersona[];  // 7, unique ids, editions ∈ {default,yang,jackpot,arcade,editorial,tactile,robot}
/** Deterministic (no Math.random). Walks the roster from seedCount, skips open personas. */
export function pickPersona(seedCount: number, openPersonaIds: ReadonlySet<string>): BotPersona | null;
/** Total omit (NOT an allowlist) so future PlayerState fields pass through. Strips isBot only. */
export function projectPlayerForClient(p: PlayerState): Omit<PlayerState, "isBot">;
```

> **Review fix (defect 14):** canonical `pickPersona` signature is `(number, ReadonlySet<string>) => BotPersona | null`. Slice D's call site is `pickPersona(seedCount, new Set(openGames(s).map(r => r.personaId)))` and **must handle `null`** (skip this tick).

**TDD steps.**

| # | (a) Failing test — `test/bots.test.ts` | (b) Minimal impl | (c) Verify |
|---|---|---|---|
| C1 | `"every persona has non-empty id/name/avatar/edition/blurb"` | author 7 personas | `npx vitest run test/bots.test.ts` |
| C2 | `"persona ids are unique"` → `new Set(ids).size === length` | (authored) | same |
| C3 | `"every persona.edition is a known edition id"` against `["default","yang","jackpot","arcade","editorial","tactile","robot"]` | (authored) | same |
| C4 | `"pickPersona is deterministic"` → same args, same result | `index = seedCount % len`, walk modulo | same |
| C5 | `"pickPersona varies across seedCounts (full roster coverage)"` → `len` distinct ids over `0..len-1` | (modulo walk) | same |
| C6 | `"pickPersona skips openPersonaIds"` | `if (open.has(p.id)) continue` | same |
| C7 | `"pickPersona returns null when all personas are open"` → `toBeNull()` | exhaust → `null` | same |
| C8 | `"snapshot strips isBot — JSON.stringify has no \"isBot\""` (test the **multiplayer** branch via the pure `projectPlayerForClient`) | `const { isBot:_, ...rest } = p; return rest;` | same |
| C9 | `"snapshot strips isBot on the DAILY single-player branch too"` (review fix, invariants #6 — add the `me`-only case) | both `snapshotFor` branches call `projectPlayerForClient` | same |
| C10 | `"bots.ts imports nothing that exposes the answer"` (src-reading; `not.toContain` `solver`/`wordsbysize`/`room`) | no runtime imports | same |
| C11 | **Manual smoke** — DevTools → WS → inspect a `robots` snapshot frame: zero `"isBot"`, the `🤖` line still appears in `robots` (labeled room) but the projection no longer leaks `isBot` | (edits above) | open `/@<you>/robots`, inspect frame |

`snapshotFor` merged projection (lines 987–996):
```ts
return {
  ...this.state,
  word: reveal ? this.state.word : null,
  story: reveal ? this.state.story : null,
  // Disguise: strip isBot per-player and the server-only seed marker. `seed: undefined`
  // must come AFTER ...this.state to shadow the internal key (Slice D adds state.seed).
  seed: undefined,
  players: this.state.isDaily
    ? (me ? [projectPlayerForClient({ ...me, guesses: [...me.guesses] })] : [])
    : this.state.players.map((p) => projectPlayerForClient({ ...p, guesses: [...p.guesses] })),
};
```
`ensureBot` line 601 — gate the announcement:
```ts
if (this.isRobotRoom()) this.pushSystem(`🤖 ${BOT_NAME} powered on — knows the basics, holds no grudges.`);
```

**Commit & Ship gate.** Tier verdict: **SHIP-WHEN-GREEN** (Tier C; pure `bots.ts` + outbound-projection edit only; gold guard at room.ts:832 untouched). **Must be in prod before Slice D.** Auto-push when green.

**Rollback.** Code-only `git revert` + redeploy. Reversible.

---

## Slice D — Room `POST /seed` + generalized `ensureBot` + auto-start + **activate ARENA seeding**

**Objective.** The keystone. Add `POST /seed` to the ROOM DO (the missing eager-room primitive), generalize `ensureBot` to inject a persona for seeded rooms, auto-start when the first human joins, report open/close to ARENA, and **activate ARENA's seed loop** (`pickPersona` → `Room /seed` → register). This is the first slice that mints a **live, joinable** bot room — and disguise (C) + noob (B) are already in prod. Magic moment from here: a human can join a warm, waiting, disguised, beatable room.

**Files.**

*Created:* none (consumes Slice A's `arena-core.ts`/`arena.ts` — review fix, defects 12/24: Slice D does **not** re-create them).

*Modified:*
| File | Anchor | Change |
|---|---|---|
| `src/types.ts` | new export + `RoomSnapshot` | Add `SeedMarker` type; add `seed?: SeedMarker` to internal `RoomSnapshot` (review fix, defect 16 — canonical shape) |
| `src/room.ts` | `fetch` line 113 | Add `endsWith("/seed")` branch **before** `/ws`; POST-only; sets path/owner/slug identically to the `/ws` block; calls `handleSeed()` |
| `src/room.ts` | `ensureBot` line 584–602 | Generalize: keep `isDaily` guard first; fire for `isRobotRoom() || this.state.seed`; accept optional persona; inject persona with `isBot:true` + human username; silent for seeded |
| `src/room.ts` | `onStart` line 465 | Extract startable core into `runStart(who, ws?)`; `onStart` becomes a thin wrapper |
| `src/room.ts` | `onHello` after line 316 | If seeded + first connected human + `phase==="lobby"` → `runStart(persona-name)`; also reject a 2nd human in a seeded room ("room full") |
| `src/room.ts` | `finishGame` after line 842 | Best-effort `ctx.waitUntil(ARENA./close).catch(console.error)` |
| `src/arena.ts` | `alarm()` | Activate the real seed loop: `pickPersona` → mint `SeedRec` (status `minted`, bump `seedCount`) → `ROOM /seed` → on 2xx `apply(register)`, on non-2xx `apply(close)` |

**Interfaces (canonical contracts).**
```ts
// src/types.ts  (review fix, defect 16 — ONE shape, imported by B, E)
export type SeedMarker = { personaId: string; profile: "noob" };
// + on RoomSnapshot (internal only; stripped outbound by Slice C):
seed?: SeedMarker;

// Room POST /seed body (review fix, defect 11 — Slice 2's shape is canonical; carries profile)
type SeedBody = {
  path: string;                 // DO-key form "arena/<personaId>-<seedCount>"
  persona: { id: string; name: string; avatar: string };
  profile: "noob";
  edition: string;
  wordLength: number;           // 5
};
// Room → ARENA POST /open body: { path }   (review fix, defect 13 — no seats; fixed at mint)
// Room → ARENA POST /close body: { path }
```

> **Review fix (defects 1,2,3 — path identity):** ARENA mints DO-key `path = "arena/<personaId>-<seedCount>"`, builds `routePath = "/@arena/<personaId>-<seedCount>"`, and calls `env.ROOM.get(env.ROOM.idFromName(path))`. `handleSeed()` sets `state.path/owner/slug` by splitting `path` **exactly as the `/ws` block does** (owner `"arena"`, slug `"<personaId>-<seedCount>"`). The client navigates to `routePath`; the worker `/ws?room=arena/<personaId>-<seedCount>` resolves `idFromName("arena/<personaId>-<seedCount>")` — byte-identical to the seeded key. **No `roomalias` entry is created for seeded paths** (so `canonical === requested`). `isValidUsername("arena")` passes (5 chars). Smoke must assert the persona is already seated on the human's join (same DO instance).
> **Review fix (defect 4 & 9 — auto-start + 2-cap):** seeded room = 1 persona (bot) + 1 human. Auto-start fires on the FIRST connected human, not `humanPlayerCount===2`. Gate: `if (this.state.seed && this.state.phase==="lobby" && this.state.players.some(p=>!p.isBot && p.connected)) await this.runStart(personaName)`. In `onHello`, reject a 2nd distinct human in a seeded room with `"room full"`.
> **Review fix (defect 5 — mint/seed order):** ONE order. ARENA: `apply(mint)` (status `minted`, bump `seedCount`) → `ROOM /seed`. On 2xx the room `POST ARENA./open` → `apply(register)`. On non-2xx ARENA `apply(close)`. `minted` is the in-flight state; `STALE_MS` GC is the crash backstop. (Slice 2's "bump only after 2xx" clause is dropped.)
> **Review fix (defect 6 — no seed from GET):** confirmed — seeding lives only in `alarm()`; `alarm()` re-reads `liveCount` before each mint inside the loop for idempotency.
> **Review fix (defect 10 — runStart guards):** `runStart(who, ws?)` owns ALL guards (`isDaily`, `phase==="playing"`, `players.length<1`, pool-empty, challenge-fetch, word-pick, player reset, `emitRoundStarted`, `scheduleBotTick`). The two `this.send(ws,{type:"error"})` calls become: if `ws` present → send error; else `console.error` + return `false`. Manual path keeps error feedback via the optional `ws`.
> **Review fix (defect 25 — bot lookup):** persona injected with `isBot:true` so `alarm()`'s `players.find(p=>p.isBot && status==="playing")` resolves and `noobGuess` runs.
> **Review fix (defect 19 — username collision):** in a seeded room, reject a human `hello` whose normalized username equals the seated persona's username.

**TDD steps.** (Pure-testable seams are thin here; the index reducer is already covered in Slice A. New pure coverage targets the seeded-path projection + a path-uniqueness assertion.)

| # | (a) Failing test | (b) Minimal impl | (c) Verify |
|---|---|---|---|
| D1 | `test/arena-core.test.ts` `"two mints at distinct seedCounts produce distinct paths"` (locks the monotonic-counter invariant — review defect 8) | seedCount embedded in path; `apply(mint)` bumps it | `npx vitest run test/arena-core.test.ts` |
| D2 | `test/room-seed.test.ts` `"projectPlayerForClient on a seeded persona omits isBot, keeps username/avatar-derived fields"` (pure, reuses Slice C helper) | (Slice C `projectPlayerForClient`) | `npx vitest run test/room-seed.test.ts` |
| D3 | **Manual smoke — seed → list → join → auto-start → beatable** | wire `handleSeed`, `runStart`, `onHello` gate, ARENA `alarm` seed loop | deploy; `curl /api/arena/open` shows a `registered` row; open its `routePath`; persona is already seated, NO `🤖` line, auto-starts on join, bot slow+beatable, no `"isBot"`/`"seed"` in WS frame |
| D4 | **Manual smoke — close on join + restock** | (above) | after join, row absent from `/open`; within a tick a fresh persona row appears |
| D5 | **Manual smoke — ghost sweep** | (prune) | seed a room, never join, confirm it drops from `/open` within `MAX_OPEN_MS` (or kill mid-wait) |

**Commit & Ship gate.** Tier verdict: **HOLD-FOR-OWNER (S2)** — depends on Slice A's v6 binding being **confirmed live** (touches the race-room critical start/finish path + activates live seeding). Before push: confirm Slices C and B are in prod; confirm v6 applied. Push call: **HOLD** until C+B confirmed in prod and owner approves activating live bot rooms.

**Rollback.** Code-only `git revert` + redeploy (the `/seed` route is additive; ARENA `alarm` reverts to the Slice-A no-op). Reversible; finished seeded DOs accumulate (known junk-record TODO).

---

## Slice E — H2H memory: `UserProfile.h2h` + USER `POST /h2h` + write-on-finish + in-room surface

**Objective.** Store and surface per-`(human, persona)` win/loss. Add `h2h` to `UserProfile`, a `POST /h2h` route on the USER DO (placed so it cannot shadow `/ledger/append`), a best-effort write from `finishGame`, and an in-room "You vs Maya N–M" label. Magic moment completion: beat Maya, return, see the standing record.

**Files.**

*Created:*
- `src/user-core.ts` — pure (mirrors `daily-core.ts`): `healProfile`, `freshProfile`, `applyH2H`. Imports `./types.ts`, `./stats.ts`, `./economy.ts` only.
- `test/user-h2h.test.ts` — pure units + the `/ledger/append` routing-regression guard.

*Modified:*
| File | Anchor | Change |
|---|---|---|
| `src/types.ts` | `UserProfile` (line 17) | Add `h2h?: Record<string, { w: number; l: number }>;` |
| `src/user.ts` | `load()` lines 11–33 | Delegate self-heal to `healProfile`; fresh-profile via `freshProfile` (adds `h2h:{}`) |
| `src/user.ts` | after `/ledger/append` (line 73), before 404 | Add `endsWith("/h2h")` route using `applyH2H` |
| `src/room.ts` | `finishGame` Promise.allSettled (line 824–840) | For each non-bot human with `this.state.seed?.personaId`, best-effort `writeH2H` |
| `public/room.js` | in-room header render | Show "You vs &lt;opponent name&gt; N–M" when history exists |

> **Review fix (defects 7,17,22, invariants #7):** Slice E does **NOT** add `seedPersonaId` to the snapshot and does **NOT** re-edit `snapshotFor` (Slice C owns it). The H2H badge keys off the **opponent's visible username** already on the wire (the persona's human-looking `username`), looked up against `profile.h2h[username]`. The persona's in-room `username` and its `BotPersona.id` are the same stable string by construction (persona injected with `username = persona.id`, displayed via `persona.name`), so `h2h[username]` resolves with no bot-only field on the wire.
> **Review fix (defect 20 — result rule):** H2H win = `state.winner === username`, else loss. With the 2-cap (Slice D) this is unambiguous (only one human + one persona finish).
> **Review fix (defect 21 — bot pollution):** the `finishGame` loop reads `this.state.players` (internal, un-stripped, `isBot` intact). Guard `!player?.isBot` keeps the persona out of any USER DO. Assert it.

**Interfaces.**
```ts
// src/user-core.ts
export function healProfile(saved: UserProfile, username: string): UserProfile; // adds h2h:{} if missing
export function freshProfile(username: string): UserProfile;                      // includes h2h:{}
export function applyH2H(h2h: Record<string,{w:number;l:number}>, personaId: string, result: "w"|"l"): void;
// USER POST /h2h body: { personaId: string; result: "w"|"l" }
// room.ts private: writeH2H(humanUsername, personaId, result): void  // ctx.waitUntil, best-effort
```

**TDD steps.**

| # | (a) Failing test — `test/user-h2h.test.ts` | (b) Minimal impl | (c) Verify |
|---|---|---|---|
| E1 | `"healProfile backfills missing h2h to {}"` | `if (!saved.h2h) saved.h2h = {}` | `npx vitest run test/user-h2h.test.ts` |
| E2 | `"applyH2H win/loss increment correct counter"` (init both to 0 first) | `applyH2H` | same |
| E3 | `"/h2h endsWith does not shadow /ledger/append (and /append cannot shadow /h2h)"` — string assertions (S3 mechanical guard; permanent) | route placed after `/ledger/append`, uses `endsWith("/h2h")` | same |
| E4 | `"healProfile preserves balances/ledger (gold path unchanged)"` | `healProfile` keeps existing self-heal branches | same |
| E5 | **Manual smoke — h2h write on finish** | `writeH2H` + `finishGame` call | beat a persona; `GET /api/user/<you>` shows `h2h.<id>.w === 1` |
| E6 | **Manual smoke — gold still mints (S3)** | (routing) | finish any race with points; `gold` balance rises; `wrangler tail` shows no error on `/ledger/append` |
| E7 | **Manual smoke — in-room "You vs Maya N–M"** | `public/room.js` header | rejoin a persona room; header shows "You vs Maya 1–0" |

USER `/h2h` route (after line 73):
```ts
if (req.method === "POST" && url.pathname.endsWith("/h2h")) {
  const { personaId, result } = (await req.json()) as { personaId: string; result: "w" | "l" };
  if (!personaId || (result !== "w" && result !== "l")) return new Response("bad request", { status: 400 });
  const profile = await this.load(username);
  applyH2H(profile.h2h!, personaId, result);
  await this.ctx.storage.put("profile", profile);
  return new Response("ok");
}
```

**Commit & Ship gate.** Tier verdict: **HOLD-FOR-OWNER (S3)** — edits `src/user.ts` (gold-ledger money-path-adjacent). Owner reviews the routing diff (order: `GET` → `/append`-with-guard → `/room` → `/ledger/append` → `/h2h` → 404) and confirms the E6 gold-mint smoke. Push call: **HOLD** for owner sign-off.

**Rollback.** Code-only `git revert` + redeploy. `h2h` is additive + self-healing; reversible.

---

## Slice F — Arena tab goes LIVE (ships LAST)

**Objective.** Replace the `PANELS.arena` stub (`hub.js:47`) with a live panel: fetch `GET /api/arena/open`, render each `OpenGame` as a glass row (no pills), tap-to-join via a new `onJoin` callback, an 8s poll while the tab is active, and explicit loading/empty/error states. This is the **only public entry** (S4) and ships only after B+C+D+E are in prod.

**Files.**

*Modified:*
| File | Anchor | Change |
|---|---|---|
| `public/hub.js` | `PANELS.arena` line 47 | replace stub with `renderArena()`; add module state + exported pure helpers + private `renderArena`/`wireArena`/`fetchArena`/`stopArenaPoll`; clear poll on tab switch |
| `public/app.js` | `renderHomeIdentity` cbs (line 151–162, alongside `onPlay`) | add `onJoin: (routePath) => navigate(routePath)` (review fix, Slice 6 Risk 1) |
| `public/app.js` | `leaveRoom` / route teardown for `kind:"home"` | call `stopArenaPoll()` (review fix, defect 27 — poll-leak guard) |
| `public/style.css` | after hub section (~line 2283) | `.arena-list`, `.arena-row`(+`:hover`), `.arena-row-avatar/body/meta/seats`, `.arena-state` |

*Created:*
- `test/arena-panel.test.js` — units for the two pure helpers.

**Interfaces.**
```js
// public/hub.js (exported pure)
export function arenaRowProps(game) // → { routePath, avatar, host, wordLength, seats, editionTint }
export function arenaEmptyState(games, isError) // games===null→loading; isError→error; []→empty; else list
```

> **Review fix (defect 1):** the row's join target is `game.routePath` (`/@arena/<persona>-<n>`), passed verbatim to `onJoin` → `navigate`. `parseRoute` (app.js:82) accepts it.
> **Review fix (defect 27):** `stopArenaPoll` is wired into app.js route teardown (leaving `kind:"home"`), not just a defensive DOM check — tapping a row calls `navigate`, which does not call `setTab`.
> **Review fix (defect 14, Slice 6 Risk 3):** a row that 404s/full on join is handled by existing room WS logic; the panel re-fetches on next poll. No dead end.
> H2H is **not** shown on the arena row in v1 (accepted soft tell, spec §Disguise) — only in-room (Slice E).

**TDD steps.**

| # | (a) Failing test — `test/arena-panel.test.js` | (b) Minimal impl | (c) Verify |
|---|---|---|---|
| F1 | `"arenaRowProps maps OpenGame to row props"` → `toMatchObject({ routePath, avatar: personaIcon, host, wordLength, seats })` | `arenaRowProps` | `npx vitest run test/arena-panel.test.js` |
| F2 | `"arenaEmptyState identifies loading/empty/error/list"` | `arenaEmptyState` | same |
| F3 | `"public/ module graph still whole"` (existing) — hub.js adds no new file imports | helpers inline; `onJoin` via callback (no import) | `npx vitest run test/module-graph.test.ts` |
| F4 | **Manual smoke — full magic moment** | `renderArena`/`wireArena`/`fetchArena`/`stopArenaPoll` + app.js wiring + CSS | see §6 |

**Commit & Ship gate.** Tier verdict: **SHIP-WHEN-GREEN, STRICTLY LAST (S4)** — only `hub.js`/`style.css`/`app.js` callback wiring + test; no server/migration/money touch. Push only after B, C, D, E confirmed in prod. Auto-push when green + owner-acknowledged that the feature is going public.

**Rollback.** Code-only `git revert` + redeploy → tab reverts to stub; feature becomes unreachable but seeded rooms keep working. Reversible.

---

## 5. Cross-Cutting Invariants checklist (run BEFORE the tab goes public — gate on Slice F)

- [ ] **Blindness proven by a src-reading test.** `npx vitest run test/noob.test.ts` passes the regex guard (`not.toMatch` for `./room`, `./user`, `./daily`, `./economy`, `scoreGuess`, `/\.word\b/`). Confirm `module-graph.test.ts` was **not** relied on for `src/` blindness.
- [ ] **`solver.ts` blindness still green** — `npx vitest run test/solver.test.ts` (the sacred test untouched).
- [ ] **No `isBot` on the wire** — DevTools → WS → any seeded-room snapshot frame: `JSON.stringify` contains no `"isBot"` (both multiplayer and daily branches covered by C8/C9).
- [ ] **No `seed`/`seedPersonaId` on the wire** — frame contains no `"seed"` key and no bot-only persona-id field (the oracle Slice E deliberately avoids).
- [ ] **No robot chat line** — seeded room chat history shows no `🤖 … powered on`; persona join is silent (or a normal "X joined").
- [ ] **Persona names/avatars are human** — every row + in-room player reads as a person; `clanker` appears only in the labeled `/robots` room.
- [ ] **Noob is beatable** — a human can win; bot makes visible slips and paces at 10–20s/7–17s.
- [ ] **Index never lies** — a seeded-then-killed room drops from `/api/arena/open` within `MAX_OPEN_MS`; a joined row disappears immediately (close-on-join).
- [ ] **2-cap holds** — a 2nd human cannot join a seeded room (gets "room full").
- [ ] **Gold still mints** — finish a race with points → `gold` balance rises; `/ledger/append` un-shadowed (E3 guard green).
- [ ] **v6 applied** — deploy succeeded for real (not dry-run); Arena binding resolves at runtime.

---

## 6. Final end-to-end smoke (the magic moment) + Open questions

**End-to-end smoke (after Slice F, all of A–F in prod):**
1. `curl https://wordul.com/api/arena/open` → non-empty `OpenGame[]` with a persona `host`/`personaIcon` and `routePath` like `/@arena/maya-3`.
2. Open wordul.com → tap **Arena** → a glass row shows avatar + name + `1/2 waiting` (never blank).
3. Tap the row → navigates to `routePath` → WS connects to the **same** DO that was seeded (persona already seated) → auto-starts.
4. DevTools WS frame: no `"isBot"`, no `"seed"`, no robot chat line.
5. Play and beat the noob → in-room header shows "You vs Maya 1–0".
6. Return to Arena → joined row gone; a fresh persona row has restocked.
7. Two tabs race the same row → 2nd gets "room full", panel re-fetches on next poll (no dead end).
8. Kill network → error state (not blank); restore → poll recovers.

**Open questions for the owner:**
1. **S1/S2:** Approve the v6 `new_sqlite_classes: ["Arena"]` migration? (Permanent DO namespace once created.)
2. **S3:** Approve the `src/user.ts` `/h2h` routing diff after reviewing it, given the money-path adjacency?
3. **S4:** Confirm flipping the Arena tab public in Slice F (the feature becomes reachable to all users).
4. **Roster:** Approve 7 persona names/avatars/editions, or supply your own cast? (Editions available: default, yang, jackpot, arcade, editorial, tactile, robot.)
5. **Noob feel:** Is `mistakeRate = 0.4` + 10–20s/7–17s pacing the right "beatable but not insultingly easy" target, or tune after live play?
6. **Soft tell (accepted in spec):** OK to ship the v1 "You vs Maya" record knowing a savvy user could infer bot-ness from it (human-human H2H is the v2 closer)?

**Relevant files:** spec `/Users/vibeyang/wordle/docs/superpowers/specs/2026-06-02-arena-liquidity-bots-design.md`; `/Users/vibeyang/wordle/wrangler.jsonc` (v5=Science, next v6); `/Users/vibeyang/wordle/src/{worker.ts,user.ts,room.ts,types.ts,solver.ts}`; `/Users/vibeyang/wordle/public/{app.js,hub.js,editions/index.js}`; `/Users/vibeyang/wordle/test/{solver.test.ts,module-graph.test.ts}`.
