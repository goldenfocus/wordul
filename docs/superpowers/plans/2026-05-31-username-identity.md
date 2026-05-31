# Username Identity & Profiles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent, server-side player identity (a username, no password) with public profiles, owner-nested rooms (`/@user/<slug>`), per-user and per-room scoreboards, and baked-in discoverability (server-rendered meta/OG, global directory, sitemap, llms.txt).

**Architecture:** Pure logic (username/slug normalization, stats aggregation, scoreboard, game-record building) lives in small standalone modules, unit-tested with vitest. A new `User` Durable Object (keyed by `idFromName(username)`) stores each player's profile/stats/history and is written to by rooms on game finish. Rooms become owner-nested (`idFromName("<owner>/<slug>")`), key players by username, keep a cumulative scoreboard, and report results. The Worker fronts every request, so per-route meta/OG is injected with `HTMLRewriter`; a `DIRECTORY` KV namespace registers every user/room to power `sitemap.xml`.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects + KV, vitest, HTMLRewriter, vanilla-JS SPA.

**Spec:** `docs/superpowers/specs/2026-05-31-username-identity-design.md`

---

## ⚠️ Sacred Stops in this plan (Tier A — confirm before executing)

- **Phase D edits `wrangler.jsonc` (LIVE prod config) + adds a DO migration.** Migrations are append-only; adding `User` does not touch `Room`, but this is prod config — Yan confirms before deploy. Yan owns the deploy button.
- **Retiring `/r/<code>`** is a breaking change for any existing bare-code rooms (audience is tiny / fresh clone, so acceptable). Phase E keeps a graceful redirect.
- **`wrangler kv namespace create`** (Phase D) provisions a real KV namespace (safe, reversible).

---

## File Structure

**New — pure logic (unit-tested):**
- `src/identity.ts` — `normalizeUsername`, `isValidUsername`, `normalizeSlug`, `roomPath`.
- `src/stats.ts` — `UserStats`, `emptyStats`, `applyGame`, `appendCapped`.
- `src/scoreboard.ts` — `RoomScore`, `bumpScoreboard`.
- `src/records.ts` — `GameRecord`, `Opponent`, `GameOutcome`, `buildGameRecords`.

**New — runtime:**
- `src/user.ts` — `User` Durable Object (profile read + append + room upsert).

**New — frontend / assets:**
- `public/profile.js` — profile page fetch + render (stats, two lists).
- `public/robots.txt`, `public/llms.txt`, `public/llms-full.txt` — discoverability.
- `public/og.png` — static 1200×630 default OG image (design asset).

**Modified:**
- `src/types.ts` — username on messages, `UserProfile`, room snapshot owner/name/scoreboard, `Env`.
- `src/room.ts` — username keying, owner/name, scoreboard, finish-reporting + room registration.
- `src/worker.ts` — `/@user`, `/@user/<slug>`, `/api/user/<name>`, `/sitemap.xml`, HTMLRewriter meta, `/ws?room=`, export `User`, legacy `/r/` redirect.
- `wrangler.jsonc` + `wrangler.v2.jsonc` — `USER` DO binding + migration, `DIRECTORY` KV binding.
- `public/app.js` — username login, room create/rename, router for `/@`, share/invite, stats import.
- `public/index.html` — meta placeholders for rewriter, profile mount point.
- `public/style.css` — profile + scoreboard styles.
- `package.json` — vitest devDep + `test` script.
- `tsconfig.json` — include `test/**` (optional).

**Tests:** `test/identity.test.ts`, `test/stats.test.ts`, `test/scoreboard.test.ts`, `test/records.test.ts`.

---

## Phase A — Test setup

### Task A1: Add vitest

**Files:** Modify `package.json`; Create `vitest.config.ts`.

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`
Expected: vitest added to devDependencies.

- [ ] **Step 2: Add the test script**

In `package.json` `scripts`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Sanity-check the runner**

Run: `npx vitest run`
Expected: exits 0 with "No test files found" (or similar). Runner works.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest runner"
```

---

## Phase B — Pure logic (TDD)

### Task B1: Username & slug normalization

**Files:** Create `src/identity.ts`; Test `test/identity.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { normalizeUsername, isValidUsername, normalizeSlug, roomPath } from "../src/identity.ts";

describe("normalizeUsername", () => {
  it("lowercases and strips illegal chars", () => {
    expect(normalizeUsername("  Yan!! ")).toBe("yan");
    expect(normalizeUsername("Cool_Guy-99")).toBe("cool_guy-99");
  });
  it("trims separators from the ends and clips to 20", () => {
    expect(normalizeUsername("--yan--")).toBe("yan");
    expect(normalizeUsername("a".repeat(40))).toBe("a".repeat(20));
  });
});

describe("isValidUsername", () => {
  it("requires 3-20 normalized chars", () => {
    expect(isValidUsername("yan")).toBe(true);
    expect(isValidUsername("yo")).toBe(false);
    expect(isValidUsername("good_name-1")).toBe(true);
    expect(isValidUsername("!!")).toBe(false);
  });
});

describe("normalizeSlug", () => {
  it("allows a-z0-9- only, collapses and trims hyphens, clips to 40", () => {
    expect(normalizeSlug("Friday Night!!")).toBe("friday-night");
    expect(normalizeSlug("--happy--otter--")).toBe("happy-otter");
  });
});

describe("roomPath", () => {
  it("joins owner and slug", () => {
    expect(roomPath("yan", "friday-night")).toBe("yan/friday-night");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/identity.test.ts`
Expected: FAIL — cannot find module `../src/identity.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/identity.ts — pure identity/slug helpers (no Cloudflare deps).

const USERNAME_MAX = 20;
const SLUG_MAX = 40;

/** Lowercase, keep [a-z0-9_-], trim leading/trailing separators, clip length. */
export function normalizeUsername(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, USERNAME_MAX);
}

export function isValidUsername(input: string): boolean {
  const n = normalizeUsername(input);
  return n.length >= 3 && n.length <= USERNAME_MAX && /^[a-z0-9_-]+$/.test(n);
}

/** Room-code style: lowercase, [a-z0-9-], collapse + trim hyphens, clip. */
export function normalizeSlug(input: string): string {
  return (input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX);
}

export function roomPath(owner: string, slug: string): string {
  return `${owner}/${slug}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/identity.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/identity.ts test/identity.test.ts
git commit -m "feat: username/slug normalization helpers"
```

### Task B2: User stats aggregation

**Files:** Create `src/stats.ts`; Test `test/stats.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { emptyStats, applyGame, appendCapped } from "../src/stats.ts";

describe("applyGame", () => {
  it("counts plays, wins, streaks and guess distribution", () => {
    let s = emptyStats();
    s = applyGame(s, { result: "won", guesses: 3 });
    s = applyGame(s, { result: "won", guesses: 4 });
    expect(s).toMatchObject({
      gamesPlayed: 2, wins: 2, currentStreak: 2, bestStreak: 2,
      guessDistribution: { 3: 1, 4: 1 },
    });
  });
  it("resets current streak on a loss but keeps best", () => {
    let s = emptyStats();
    s = applyGame(s, { result: "won", guesses: 2 });
    s = applyGame(s, { result: "won", guesses: 2 });
    s = applyGame(s, { result: "lost", guesses: 8 });
    expect(s.currentStreak).toBe(0);
    expect(s.bestStreak).toBe(2);
    expect(s.gamesPlayed).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.guessDistribution[8]).toBeUndefined(); // losses don't count
  });
});

describe("appendCapped", () => {
  it("prepends most-recent and drops oldest beyond cap", () => {
    const out = appendCapped([3, 2, 1], 4, 3);
    expect(out).toEqual([4, 3, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/stats.test.ts`
Expected: FAIL — cannot find module `../src/stats.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/stats.ts — pure per-user stats aggregation (no Cloudflare deps).

export type GameOutcome = "won" | "lost";

export type UserStats = {
  gamesPlayed: number;
  wins: number;
  currentStreak: number;
  bestStreak: number;
  guessDistribution: Record<number, number>;
};

export function emptyStats(): UserStats {
  return { gamesPlayed: 0, wins: 0, currentStreak: 0, bestStreak: 0, guessDistribution: {} };
}

export function applyGame(stats: UserStats, outcome: { result: GameOutcome; guesses: number }): UserStats {
  const next: UserStats = {
    ...stats,
    guessDistribution: { ...stats.guessDistribution },
  };
  next.gamesPlayed += 1;
  if (outcome.result === "won") {
    next.wins += 1;
    next.currentStreak += 1;
    next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
    const g = outcome.guesses;
    next.guessDistribution[g] = (next.guessDistribution[g] ?? 0) + 1;
  } else {
    next.currentStreak = 0;
  }
  return next;
}

/** Prepend `item`, keep at most `cap` (most-recent-first). */
export function appendCapped<T>(list: T[], item: T, cap: number): T[] {
  return [item, ...list].slice(0, cap);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/stats.ts test/stats.test.ts
git commit -m "feat: per-user stats aggregation"
```

### Task B3: Per-room scoreboard

**Files:** Create `src/scoreboard.ts`; Test `test/scoreboard.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { bumpScoreboard } from "../src/scoreboard.ts";

describe("bumpScoreboard", () => {
  it("adds entries, increments played for all and wins for the winner", () => {
    let b = bumpScoreboard([], { winner: "yan", participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 1, played: 1 },
      { username: "bob", wins: 0, played: 1 },
    ]);
    b = bumpScoreboard(b, { winner: "bob", participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 1, played: 2 },
      { username: "bob", wins: 1, played: 2 },
    ]);
  });
  it("handles a round nobody won", () => {
    const b = bumpScoreboard([], { winner: null, participants: ["yan"] });
    expect(b).toEqual([{ username: "yan", wins: 0, played: 1 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scoreboard.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/scoreboard.ts — pure per-room cumulative tally (no Cloudflare deps).

export type RoomScore = { username: string; wins: number; played: number };

export function bumpScoreboard(
  board: RoomScore[],
  round: { winner: string | null; participants: string[] },
): RoomScore[] {
  const map = new Map(board.map((e) => [e.username, { ...e }]));
  for (const u of round.participants) {
    const e = map.get(u) ?? { username: u, wins: 0, played: 0 };
    e.played += 1;
    if (round.winner === u) e.wins += 1;
    map.set(u, e);
  }
  return [...map.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scoreboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scoreboard.ts test/scoreboard.test.ts
git commit -m "feat: per-room scoreboard tally"
```

### Task B4: Build personalized game records

**Files:** Create `src/records.ts`; Test `test/records.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildGameRecords } from "../src/records.ts";

describe("buildGameRecords", () => {
  it("builds one personalized record per player with the others as opponents", () => {
    const recs = buildGameRecords({
      roomPath: "yan/friday-night",
      word: "CRANE",
      wordLength: 5,
      finishedAt: 1000,
      players: [
        { username: "yan", status: "won", guesses: 3 },
        { username: "bob", status: "lost", guesses: 6 },
      ],
    });
    expect(recs.yan).toEqual({
      roomPath: "yan/friday-night", word: "CRANE", wordLength: 5, finishedAt: 1000,
      result: "won", guesses: 3,
      opponents: [{ username: "bob", result: "lost", guesses: 6 }],
    });
    expect(recs.bob.result).toBe("lost");
    expect(recs.bob.opponents).toEqual([{ username: "yan", result: "won", guesses: 3 }]);
  });
  it("treats a still-playing status as a loss at finish", () => {
    const recs = buildGameRecords({
      roomPath: "yan/x", word: "PLAID", wordLength: 5, finishedAt: 1,
      players: [{ username: "yan", status: "playing", guesses: 2 }],
    });
    expect(recs.yan.result).toBe("lost");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/records.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/records.ts — pure: turn a finished room into one record per player.

export type GameOutcome = "won" | "lost";
export type Opponent = { username: string; result: GameOutcome; guesses: number };

export type GameRecord = {
  roomPath: string;
  finishedAt: number;
  wordLength: number;
  word: string;
  result: GameOutcome;
  guesses: number;
  opponents: Opponent[];
};

type FinishedPlayer = { username: string; status: "won" | "lost" | "playing"; guesses: number };

const outcome = (s: FinishedPlayer["status"]): GameOutcome => (s === "won" ? "won" : "lost");

export function buildGameRecords(params: {
  roomPath: string;
  word: string;
  wordLength: number;
  finishedAt: number;
  players: FinishedPlayer[];
}): Record<string, GameRecord> {
  const { roomPath, word, wordLength, finishedAt, players } = params;
  const out: Record<string, GameRecord> = {};
  for (const p of players) {
    out[p.username] = {
      roomPath, word, wordLength, finishedAt,
      result: outcome(p.status),
      guesses: p.guesses,
      opponents: players
        .filter((o) => o.username !== p.username)
        .map((o) => ({ username: o.username, result: outcome(o.status), guesses: o.guesses })),
    };
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/records.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/records.ts test/records.test.ts
git commit -m "feat: build personalized game records"
```

---

## Phase C — User Durable Object

### Task C1: Shared types

**Files:** Modify `src/types.ts`.

- [ ] **Step 1: Add profile + room types and update messages**

Add to `src/types.ts` (keep existing content; import the pure types so there's one source of truth):

```ts
import type { UserStats } from "./stats.ts";
import type { GameRecord } from "./records.ts";
import type { RoomScore } from "./scoreboard.ts";

export type OwnedRoom = { slug: string; name: string; lastPlayedAt: number };

export type UserProfile = {
  username: string;
  createdAt: number;
  stats: UserStats;
  games: GameRecord[];     // most-recent-first, capped
  ownedRooms: OwnedRoom[];
};
```

In `Env`, add the new bindings:

```ts
export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  DIRECTORY: KVNamespace;
}
```

In `PlayerState`, rename identity to username (replacing `id`/`nickname` usage going forward) — keep `nickname` removed and add:

```ts
export type PlayerState = {
  username: string;
  connected: boolean;
  guesses: GuessRow[];
  status: "playing" | "won" | "lost";
};
```

In `RoomSnapshot`, replace `hostId` with owner/name + scoreboard:

```ts
export type RoomSnapshot = {
  path: string;            // "<owner>/<slug>"
  owner: string;           // owner username
  name: string;            // display name (renameable)
  phase: RoomPhase;
  players: PlayerState[];
  word: string | null;
  winner: string | null;   // winner username
  startedAt: number | null;
  finishedAt: number | null;
  round: number;
  chat: ChatEntry[];
  wordLength: number;
  maxGuesses: number;
  scoreboard: RoomScore[];
};
```

Update `ClientMessage` `hello` and add a rename message:

```ts
export type ClientMessage =
  | { type: "hello"; username: string; wordLength?: number }
  | { type: "start" }
  | { type: "guess"; word: string }
  | { type: "rematch" }
  | { type: "chat"; text: string }
  | { type: "set_length"; wordLength: number }
  | { type: "rename"; name: string }
  | { type: "ping" };
```

- [ ] **Step 2: Typecheck (expected to fail in room.ts — fixed in Phase F)**

Run: `npm run typecheck`
Expected: errors only in `src/room.ts`/`src/worker.ts` referencing old fields. That's fine; later phases fix them. Confirm no errors in `types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: profile + owner-nested room types"
```

### Task C2: User DO

**Files:** Create `src/user.ts`.

- [ ] **Step 1: Implement the User DO**

```ts
// src/user.ts — one Durable Object per username; holds profile, stats, history.
import { DurableObject } from "cloudflare:workers";
import type { Env, UserProfile, OwnedRoom } from "./types.ts";
import { emptyStats, applyGame, appendCapped } from "./stats.ts";
import type { GameRecord } from "./records.ts";

const HISTORY_CAP = 100;
const ROOMS_CAP = 100;

export class User extends DurableObject<Env> {
  private async load(username: string): Promise<UserProfile> {
    const saved = await this.ctx.storage.get<UserProfile>("profile");
    if (saved) return saved;
    return { username, createdAt: Date.now(), stats: emptyStats(), games: [], ownedRooms: [] };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const username = url.searchParams.get("username") ?? "";

    if (req.method === "GET") {
      const profile = await this.load(username);
      return Response.json(profile);
    }

    if (req.method === "POST" && url.pathname.endsWith("/append")) {
      const record = (await req.json()) as GameRecord;
      const profile = await this.load(username);
      profile.stats = applyGame(profile.stats, { result: record.result, guesses: record.guesses });
      profile.games = appendCapped(profile.games, record, HISTORY_CAP);
      await this.ctx.storage.put("profile", profile);
      return new Response("ok");
    }

    if (req.method === "POST" && url.pathname.endsWith("/room")) {
      const room = (await req.json()) as OwnedRoom;
      const profile = await this.load(username);
      const others = profile.ownedRooms.filter((r) => r.slug !== room.slug);
      profile.ownedRooms = [room, ...others].slice(0, ROOMS_CAP);
      await this.ctx.storage.put("profile", profile);
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors in `user.ts` (pre-existing room.ts errors remain until Phase F).

- [ ] **Step 3: Commit**

```bash
git add src/user.ts
git commit -m "feat: User durable object (profile/stats/history)"
```

---

## Phase D — Wrangler wiring ⚠️ (Sacred Stop)

### Task D1: Provision the DIRECTORY KV namespace

**Files:** none (CLI).

- [ ] **Step 1: Create the KV namespace**

Run: `npx wrangler kv namespace create DIRECTORY`
Expected: prints an `id` (and the suggested binding block). Copy the `id`.

- [ ] **Step 2: (optional) preview namespace for `wrangler dev`**

Run: `npx wrangler kv namespace create DIRECTORY --preview`
Expected: prints a `preview_id`. Copy it.

### Task D2: Bindings + migration in prod config

**Files:** Modify `wrangler.jsonc`.

- [ ] **Step 1: Add USER DO binding** under `durable_objects.bindings` (alongside ROOM):

```jsonc
{ "name": "USER", "class_name": "User" }
```

- [ ] **Step 2: Append a migration tag** (prod uses `new_classes` to match the KV-style storage API the User DO uses):

```jsonc
"migrations": [
  { "tag": "v1", "new_classes": ["Room"] },
  { "tag": "v2", "new_classes": ["User"] }
]
```

- [ ] **Step 3: Add the KV binding** (top level), using the id from D1:

```jsonc
"kv_namespaces": [
  { "binding": "DIRECTORY", "id": "<id-from-D1>", "preview_id": "<preview_id-from-D1>" }
]
```

- [ ] **Step 4: Commit**

```bash
git add wrangler.jsonc
git commit -m "chore: bind User DO + DIRECTORY KV (prod), migration v2"
```

### Task D3: Mirror into the v2 side-by-side config

**Files:** Modify `wrangler.v2.jsonc`.

- [ ] **Step 1:** Add the same `USER` DO binding and `DIRECTORY` KV binding, but the migration uses **`new_sqlite_classes`** (the v2 worker is SQLite-backed):

```jsonc
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["Room"] },
  { "tag": "v2", "new_sqlite_classes": ["User"] }
]
```

(KV binding may reuse the same namespace id, or create a separate one — reuse is fine for testing.)

- [ ] **Step 2: Commit**

```bash
git add wrangler.v2.jsonc
git commit -m "chore: bind User DO + DIRECTORY KV (v2 config)"
```

---

## Phase E — Worker routing & meta

### Task E1: Export User, route `/ws?room=`, retire `/r/`

**Files:** Modify `src/worker.ts`.

- [ ] **Step 1: Replace worker.ts body** with owner-nested routing:

```ts
import { Room } from "./room.ts";
import { User } from "./user.ts";
import type { Env } from "./types.ts";
import { normalizeUsername, normalizeSlug, isValidUsername } from "./identity.ts";
export { Room, User };

const PROFILE_RE = /^\/@([a-z0-9_-]{3,20})$/;
const ROOM_RE = /^\/@([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Room WebSocket: /ws?room=<owner>/<slug>
    if (url.pathname === "/ws") {
      const raw = url.searchParams.get("room") ?? "";
      const [ownerRaw, slugRaw] = raw.split("/");
      const owner = normalizeUsername(ownerRaw ?? "");
      const slug = normalizeSlug(slugRaw ?? "");
      if (!isValidUsername(owner) || slug.length < 1) {
        return new Response("invalid room", { status: 400 });
      }
      const path = `${owner}/${slug}`;
      const stub = env.ROOM.get(env.ROOM.idFromName(path));
      const upstream = new URL(req.url);
      upstream.searchParams.set("room", path);
      return stub.fetch(new Request(upstream.toString(), req));
    }

    // Profile JSON API: /api/user/<name>
    if (url.pathname.startsWith("/api/user/")) {
      const name = normalizeUsername(decodeURIComponent(url.pathname.slice("/api/user/".length)));
      if (!isValidUsername(name)) return new Response("bad username", { status: 400 });
      const stub = env.USER.get(env.USER.idFromName(name));
      return stub.fetch(new Request(`https://do/?username=${name}`, { method: "GET" }));
    }

    // Sitemap from the directory.
    if (url.pathname === "/sitemap.xml") {
      return sitemap(env, url.origin);
    }

    // Legacy redirect: /r/<code> -> home (rooms are owner-nested now).
    if (url.pathname.startsWith("/r/")) {
      return Response.redirect(url.origin + "/", 301);
    }

    // Profile + room pages: serve SPA shell with per-route meta injected.
    const profileMatch = url.pathname.match(PROFILE_RE);
    const roomMatch = url.pathname.match(ROOM_RE);
    if (profileMatch || roomMatch) {
      return injectMeta(req, env, url, profileMatch, roomMatch);
    }

    // Everything else: static asset.
    return env.ASSETS.fetch(req);
  },
};
```

- [ ] **Step 2: Add the `sitemap` helper** (same file, below `export default`):

```ts
async function sitemap(env: Env, origin: string): Promise<Response> {
  const urls: string[] = [origin + "/"];
  let cursor: string | undefined;
  do {
    const page = await env.DIRECTORY.list({ limit: 1000, cursor });
    for (const k of page.keys) {
      if (k.name.startsWith("user:")) urls.push(`${origin}/@${k.name.slice(5)}`);
      else if (k.name.startsWith("room:")) urls.push(`${origin}/@${k.name.slice(5)}`);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml" } });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: errors remain only where `injectMeta` is undefined (added next) and in `room.ts` (Phase F).

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat: owner-nested routing, sitemap, /r redirect, export User"
```

### Task E2: Per-route meta injection (HTMLRewriter)

**Files:** Modify `src/worker.ts` (add `injectMeta`); Modify `public/index.html`.

- [ ] **Step 1: Add identifiable meta tags to `public/index.html` `<head>`** so the rewriter can target them:

```html
<title data-meta="title">Wordle Race — race your friends on the same Wordle</title>
<meta name="description" data-meta="description" content="Race your friends on the same Wordle. Pick a username, get a profile, keep score across games." />
<link rel="canonical" data-meta="canonical" href="https://wordle.goldenfoc.us/" />
<meta property="og:title" data-meta="og:title" content="Wordle Race" />
<meta property="og:description" data-meta="og:description" content="Race your friends on the same Wordle." />
<meta property="og:image" content="/og.png" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#121213" />
```

- [ ] **Step 2: Add `injectMeta` to `src/worker.ts`:**

```ts
async function injectMeta(
  req: Request,
  env: Env,
  url: URL,
  profileMatch: RegExpMatchArray | null,
  roomMatch: RegExpMatchArray | null,
): Promise<Response> {
  let title = "Wordle Race";
  let description = "Race your friends on the same Wordle.";

  if (roomMatch) {
    const [, owner, slug] = roomMatch;
    title = `${slug.replace(/-/g, " ")} — a Wordle Race room by ${owner}`;
    description = `Join ${owner}'s Wordle Race room and race on the same word.`;
  } else if (profileMatch) {
    const [, name] = profileMatch;
    const res = await env.USER.get(env.USER.idFromName(name)).fetch(`https://do/?username=${name}`);
    const p = (await res.json()) as { stats?: { wins?: number; bestStreak?: number } };
    const wins = p.stats?.wins ?? 0;
    const streak = p.stats?.bestStreak ?? 0;
    title = `${name} on Wordle Race — ${wins} wins, best streak ${streak}`;
    description = `${name}'s Wordle Race profile: ${wins} wins, best streak ${streak}.`;
  }

  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  const canonical = url.origin + url.pathname;
  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(title))
    .on('[data-meta="og:title"]', new AttrSetter("content", title))
    .on('[data-meta="description"]', new AttrSetter("content", description))
    .on('[data-meta="og:description"]', new AttrSetter("content", description))
    .on('[data-meta="canonical"]', new AttrSetter("href", canonical))
    .transform(shell);
}

class TextSetter {
  constructor(private text: string) {}
  element(el: Element) { el.setInnerContent(this.text); }
}
class AttrSetter {
  constructor(private attr: string, private value: string) {}
  element(el: Element) { el.setAttribute(this.attr, this.value); }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: only `room.ts` errors remain (fixed in Phase F).

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts public/index.html
git commit -m "feat: per-route meta/OG injection via HTMLRewriter"
```

---

## Phase F — Room DO changes

### Task F1: Username keying, owner/name, scoreboard, reporting

**Files:** Modify `src/room.ts`.

- [ ] **Step 1: Update imports + Env + state shape.** Replace the top of `src/room.ts`:

```ts
import { DurableObject } from "cloudflare:workers";
import { WORDS_BY_SIZE, isSupportedSize } from "./wordsbysize.ts";
import { scoreGuess } from "./color.ts";
import { bumpScoreboard } from "./scoreboard.ts";
import { buildGameRecords } from "./records.ts";
import type { ChatEntry, ClientMessage, Env, PlayerState, RoomSnapshot, ServerMessage } from "./types.ts";
```

- [ ] **Step 2: Change the class generic + initial state** to the new snapshot (owner/name/scoreboard, username keying). Replace the `extends DurableObject<Env>` line and the constructor's `this.state = {...}` block:

```ts
export class Room extends DurableObject<Env> {
  private state: RoomSnapshot;
  private chatThrottle = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = {
      path: "", owner: "", name: "",
      phase: "lobby", players: [], word: null, winner: null,
      startedAt: null, finishedAt: null, round: 0, chat: [],
      wordLength: DEFAULT_LENGTH, maxGuesses: guessesFor(DEFAULT_LENGTH),
      scoreboard: [],
    };
    ctx.blockConcurrencyWhile(async () => {
      const restored = await ctx.storage.get<RoomSnapshot>("state");
      if (restored) {
        if (!Array.isArray(restored.chat)) restored.chat = [];
        if (!Array.isArray(restored.scoreboard)) restored.scoreboard = [];
        if (!restored.wordLength) restored.wordLength = DEFAULT_LENGTH;
        if (!restored.maxGuesses) restored.maxGuesses = guessesFor(restored.wordLength);
        this.state = restored;
      }
    });
  }
```

- [ ] **Step 3: Stamp path/owner/name in `fetch`** from the `room` param. Replace the `fetch` body:

```ts
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/ws")) {
      const path = url.searchParams.get("room") ?? "";
      if (this.state.path === "") {
        this.state.path = path;
        const [owner, slug] = path.split("/");
        this.state.owner = owner ?? "";
        if (!this.state.name) this.state.name = (slug ?? "").replace(/-/g, " ");
      }
      return this.handleUpgrade(req);
    }
    return new Response("not found", { status: 404 });
  }
```

- [ ] **Step 4: Rework `pidFor` → `userFor`** (attachment now stores username):

```ts
  private userFor(ws: WebSocket): string | null {
    try {
      const a = ws.deserializeAttachment() as { username?: string } | null;
      return a?.username ?? null;
    } catch { return null; }
  }
```

Replace all `this.pidFor(ws)` calls with `this.userFor(ws)`, and all `p.id` with `p.username`, and `this.state.hostId`/`winnerId` with `this.state.owner` checks / `this.state.winner`. (Control is shared, so `start`/`set_length`/`rematch`/`rename` no longer gate on owner — anyone present may drive; drop the host check, keep the phase checks.)

- [ ] **Step 5: Rewrite `onHello`** to key by username and register the room:

```ts
  private async onHello(ws: WebSocket, usernameRaw: string, wordLength?: number): Promise<void> {
    const username = (usernameRaw ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
    if (username.length < 3) { this.send(ws, { type: "error", message: "bad username" }); return; }
    ws.serializeAttachment({ username });

    const existing = this.state.players.find((p) => p.username === username);
    if (existing) {
      const wasOffline = !existing.connected;
      existing.connected = true;
      if (wasOffline) this.pushSystem(`${username} reconnected`);
    } else {
      if (this.state.players.length >= MAX_PLAYERS) { this.send(ws, { type: "error", message: "room full" }); return; }
      this.state.players.push({ username, connected: true, guesses: [], status: "playing" });
      if (wordLength != null && isSupportedSize(wordLength) && this.state.phase === "lobby" && this.state.round === 0) {
        this.state.wordLength = wordLength;
        this.state.maxGuesses = guessesFor(wordLength);
      }
      this.pushSystem(`${username} joined`);
    }

    // Register the room under its owner (directory + owner profile) — best effort.
    if (username === this.state.owner) {
      void this.registerRoom();
    }
    await this.persistAndBroadcast();
  }

  private async registerRoom(): Promise<void> {
    const [owner, slug] = this.state.path.split("/");
    if (!owner || !slug) return;
    try {
      await this.env.DIRECTORY.put(`room:${this.state.path}`, JSON.stringify({ name: this.state.name }));
      await this.env.USER.get(this.env.USER.idFromName(owner)).fetch("https://do/room", {
        method: "POST",
        body: JSON.stringify({ slug, name: this.state.name, lastPlayedAt: Date.now() }),
      });
    } catch (e) {
      console.error("registerRoom failed", this.state.path, (e as Error).message);
    }
  }
```

- [ ] **Step 6: Add `onRename`** and wire it in `handle`:

```ts
  private async onRename(ws: WebSocket, nameRaw: string): Promise<void> {
    const name = (nameRaw ?? "").replace(/[\x00-\x1f\x7f<>]/g, "").trim().slice(0, 40);
    if (!name) return;
    this.state.name = name;
    this.pushSystem(`Room renamed to “${name}”`);
    void this.registerRoom();
    await this.persistAndBroadcast();
  }
```

In `handle`, add: `case "rename": return this.onRename(ws, msg.name);` and update `case "hello": return this.onHello(ws, msg.username, msg.wordLength);`.

- [ ] **Step 7: On finish, bump scoreboard + report to User DOs.** In `onGuess` (and anywhere `phase` becomes `"finished"`), after setting `finishedAt`, add a call to a new `finishGame()`; implement it:

```ts
  private async finishGame(): Promise<void> {
    this.state.scoreboard = bumpScoreboard(this.state.scoreboard, {
      winner: this.state.winner,
      participants: this.state.players.map((p) => p.username),
    });
    const records = buildGameRecords({
      roomPath: this.state.path,
      word: this.state.word ?? "",
      wordLength: this.state.wordLength,
      finishedAt: this.state.finishedAt ?? Date.now(),
      players: this.state.players.map((p) => ({ username: p.username, status: p.status, guesses: p.guesses.length })),
    });
    for (const [username, record] of Object.entries(records)) {
      try {
        await this.env.USER.get(this.env.USER.idFromName(username)).fetch("https://do/append", {
          method: "POST",
          body: JSON.stringify(record),
        });
      } catch (e) {
        console.error("report failed", username, (e as Error).message); // best-effort; never block finish
      }
    }
  }
```

Update the finish branch in `onGuess` to use `this.state.winner` (username) and call `await this.finishGame();` before `persistAndBroadcast()`.

- [ ] **Step 8: Update `snapshotFor`** — it already spreads `this.state`; just ensure it maps `players` by `username` (no `id`). No `winnerId` leakage; `winner` is a username and safe to expose.

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: PASS (zero errors).

- [ ] **Step 10: Run all unit tests**

Run: `npm test`
Expected: PASS (Phase B suites green).

- [ ] **Step 11: Commit**

```bash
git add src/room.ts src/types.ts
git commit -m "feat: username-keyed rooms, owner/name, scoreboard, finish reporting"
```

---

## Phase G — Frontend

### Task G1: Username login (replace nickname)

**Files:** Modify `public/app.js`.

- [ ] **Step 1: Replace the identity helpers.** Find the `LS` object and `getNickname`/`setNickname` (around `public/app.js:6` and `:56-59`). Replace nickname storage with username, and store a cookie cache too:

```js
const LS = {
  username: "wr.username",
  // ...keep stats/settings/preferredLength keys...
};
function getUsername() { return localStorage.getItem(LS.username) || ""; }
function setUsername(u) {
  const clean = (u || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
  localStorage.setItem(LS.username, clean);
  document.cookie = `wr_user=${clean}; path=/; max-age=31536000; samesite=lax`;
  return clean;
}
function clearUsername() {
  localStorage.removeItem(LS.username);
  document.cookie = "wr_user=; path=/; max-age=0";
}
```

Remove the old random `playerId` generation (it's replaced by username). Update the home create/join handlers (around `:122-178`) to read/validate a **username** (min 3 chars) instead of a nickname, then proceed.

- [ ] **Step 2: Build the room path on create.** In the create handler (around `:135`), replace `generateRoomCode()` room URL with an owner-nested path:

```js
import { generateRoomCode } from "/codes.js";
const username = setUsername(input.value);
if (username.length < 3) { input.focus(); return; }
const slug = generateRoomCode();              // auto fallback name
history.pushState(null, "", `/@${username}/${slug}`);
showRoom(username, slug);
```

- [ ] **Step 3: Parse the new room/profile routes.** Replace the `parseRoomFromPath` regex (around `:98`) with:

```js
const PROFILE_RE = /^\/@([a-z0-9_-]{3,20})$/;
const ROOM_RE = /^\/@([a-z0-9_-]{3,20})\/([a-z0-9-]{1,40})$/;
function parseRoute() {
  const room = location.pathname.match(ROOM_RE);
  if (room) return { kind: "room", owner: room[1], slug: room[2] };
  const prof = location.pathname.match(PROFILE_RE);
  if (prof) return { kind: "profile", username: prof[1] };
  return { kind: "home" };
}
```

Update the initial router (bottom of file) to dispatch: `home` → home screen, `room` → `showRoom(owner, slug)`, `profile` → `showProfile(username)` (Task G3).

- [ ] **Step 4: Update the WS connect** (around `:348-361`) to use the room param and username hello:

```js
const url = `${proto}//${location.host}/ws?room=${encodeURIComponent(game.owner + "/" + game.slug)}`;
// ...
ws.send(JSON.stringify({ type: "hello", username: getUsername(), wordLength: getPreferredLength() }));
```

Update `showRoom(code)` → `showRoom(owner, slug)` and set `game.owner`, `game.slug`, `game.path = owner + "/" + slug`. Replace uses of `game.myId`/`p.id` with `getUsername()`/`p.username`. Replace `winnerId` reads with `winner`.

- [ ] **Step 5: Typecheck-ish (load it).**

Run: `npm run dev` then open `http://localhost:8787/`, create a room, confirm the URL is `/@<you>/<slug>` and you can guess. (Stop dev after.)
Expected: room loads, guesses work.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(ui): username login + owner-nested room routing"
```

### Task G2: Room header — name, rename, scoreboard, share/invite

**Files:** Modify `public/app.js`, `public/index.html`, `public/style.css`.

- [ ] **Step 1: Render the room name + owner + a rename affordance** (owner-only inline edit) in the room header where `#roomCode` was shown (around `:219`). On rename submit: `ws.send(JSON.stringify({ type: "rename", name }))`.

- [ ] **Step 2: Render the per-room scoreboard** from `snapshot.scoreboard` (sorted by wins desc) in the room view, near the player list.

- [ ] **Step 3: Wire the invite/share** (around `:220-228`). Share the canonical room URL with nice copy:

```js
const inviteUrl = `${location.origin}/@${game.owner}/${game.slug}`;
const shareData = { title: `Wordle Race — ${game.name || game.slug}`,
  text: `Race me on Wordle in ${game.owner}'s room!`, url: inviteUrl };
if (navigator.share) navigator.share(shareData).catch(() => {});
else navigator.clipboard.writeText(inviteUrl);
```

- [ ] **Step 4: Verify in dev** — create a room in one tab, open the invite URL in a second tab (enter a different username), confirm both appear and the scoreboard updates after a round.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/index.html public/style.css
git commit -m "feat(ui): room name/rename, scoreboard, share/invite"
```

### Task G3: Profile page

**Files:** Create `public/profile.js`; Modify `public/app.js`, `public/index.html`, `public/style.css`.

- [ ] **Step 1: Implement `public/profile.js`:**

```js
// Fetch + render a public profile at /@username.
export async function renderProfile(username, mountEl) {
  const res = await fetch(`/api/user/${encodeURIComponent(username)}`);
  const p = await res.json();
  const s = p.stats || {};
  const winRate = s.gamesPlayed ? Math.round((s.wins / s.gamesPlayed) * 100) : 0;
  const rooms = (p.ownedRooms || [])
    .map((r) => `<li><a href="/@${username}/${r.slug}">${escapeHtml(r.name || r.slug)}</a></li>`).join("");
  const games = (p.games || [])
    .map((g) => `<li><a href="/@${escapeHtml(g.roomPath)}">${g.result === "won" ? "✅" : "❌"} ${escapeHtml(g.word)} · ${Number(g.guesses) || 0} guesses</a></li>`).join("");
  mountEl.innerHTML = `
    <h1>@${escapeHtml(username)}</h1>
    <div class="stats">
      <span>${s.gamesPlayed || 0} games</span>
      <span>${s.wins || 0} wins</span>
      <span>${winRate}% win rate</span>
      <span>🔥 ${s.currentStreak || 0} streak (best ${s.bestStreak || 0})</span>
    </div>
    <h2>Rooms</h2><ul>${rooms || "<li>No rooms yet</li>"}</ul>
    <h2>Recent games</h2><ul>${games || "<li>No games yet</li>"}</ul>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
```

> **XSS / security:** `renderProfile` builds HTML via `innerHTML`, so **every** user-controlled value (username, room name, `roomPath`, word) MUST pass through `escapeHtml`, and numeric fields through `Number(...)`. This is defense-in-depth: the server already strips `<>`/control chars from usernames and room names at the boundary (see `room.ts` `onHello`/`onRename`), so the client escaping is the second layer. Do not interpolate any raw profile field into markup. (If the renderer grows, switch to `textContent`/DOM nodes or add DOMPurify.)

- [ ] **Step 2: Add a profile mount + `showProfile` in `app.js`:**

```js
import { renderProfile } from "/profile.js";
function showProfile(username) {
  document.title = `@${username} — Wordle Race`;
  mount("tpl-profile");                       // a template with <div id="profileMount">
  renderProfile(username, document.getElementById("profileMount"));
}
```

Add a `tpl-profile` `<template>` with `<div id="profileMount"></div>` to `public/index.html`, and link to `/@${getUsername()}` from the home/room header.

- [ ] **Step 3: Verify** — play a game, then open `/@<you>`; confirm stats + the game + the room appear.

- [ ] **Step 4: Commit**

```bash
git add public/profile.js public/app.js public/index.html public/style.css
git commit -m "feat(ui): public profile page (stats, rooms, recent games)"
```

### Task G4: One-time device-stats import

**Files:** Modify `public/app.js`.

- [ ] **Step 1: On first username claim, fold local stats into the server profile** (guarded so it runs once):

```js
async function importLocalStatsOnce(username) {
  if (localStorage.getItem("wr.imported." + username)) return;
  const raw = localStorage.getItem("wr.stats");
  localStorage.setItem("wr.imported." + username, "1");
  if (!raw) return;
  try {
    await fetch(`/api/user/${username}/import`, { method: "POST", body: raw });
  } catch (e) { console.error("import failed", e); }
}
```

> NOTE: this needs a matching worker route + User DO `/import` endpoint that converts the old localStorage stats shape into `applyGame` calls (or sets aggregate fields directly). If the legacy stats shape can't be cleanly mapped, ship without import and just start fresh — confirm with Yan. (Default per spec: import ON.)

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "feat(ui): one-time device stats import on first claim"
```

---

## Phase H — Discoverability assets

### Task H1: Static crawler + AI files

**Files:** Create `public/robots.txt`, `public/llms.txt`, `public/llms-full.txt`, `public/og.png`.

- [ ] **Step 1: `public/robots.txt`:**

```
User-agent: *
Allow: /
Sitemap: https://wordle.goldenfoc.us/sitemap.xml
```

- [ ] **Step 2: `public/llms.txt`** (concise):

```
# Wordle Race
Race your friends on the same Wordle. Pick a username (no password), get a public profile, and keep score across games.

## How it works
- Pick a username -> you are recognized anywhere by typing it.
- Create a room at /@<username>/<room-name> and share the link to invite friends.
- Everyone races the same word; first to solve wins. Rooms keep a running scoreboard.

## URLs
- Profile + stats: /@<username>
- Room: /@<username>/<room-name>
- Profile JSON API: /api/user/<username>
```

- [ ] **Step 3: `public/llms-full.txt`** — same as llms.txt plus a "Stats" section (games played, wins, win-rate, current/best streak, guess distribution) and a note that profile JSON is machine-readable and cite-able.

- [ ] **Step 4: Add `public/og.png`** — a 1200×630 branded default share image (design asset; drop the file in). If none is ready, reuse an existing logo asset and note it for replacement.

- [ ] **Step 5: Add JSON-LD to `public/index.html`** (`WebApplication` + a small `FAQPage`) in a `<script type="application/ld+json">` block.

- [ ] **Step 6: Commit**

```bash
git add public/robots.txt public/llms.txt public/llms-full.txt public/og.png public/index.html
git commit -m "feat: discoverability — robots, llms.txt, og, JSON-LD"
```

---

## Phase I — Verify & ship

### Task I1: Full local verification

- [ ] **Step 1: Tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green, zero type errors.

- [ ] **Step 2: Local dev smoke**

Run: `npm run dev`, then in the browser:
- Create a room → URL is `/@you/<slug>`, play and win a round.
- Open the invite link in incognito as `bob`, play a round → scoreboard shows both.
- Open `/@you` → stats + room + recent game present.
- `curl localhost:8787/sitemap.xml` → lists `/@you` and `/@you/<slug>`.
- `curl localhost:8787/@you` → HTML `<title>` contains "you on Wordle Race".

### Task I2: Ship (Yan's deploy button) ⚠️

- [ ] **Step 1: Confirm with Yan** — prod config + DO migration are Tier A. Get the go.

- [ ] **Step 2: Deploy**

Run: `npm run deploy`
Expected: wrangler applies migration `v2` (new `User` class) and the `DIRECTORY` KV binding; deploy succeeds.

- [ ] **Step 3: Post-deploy smoke (prod)** — repeat I1 Step 2 against the live URL; confirm meta tags via "View Source" on `/@you`.

- [ ] **Step 4: Post-Deploy Summary** — per CLAUDE.md format.

---

## Self-Review

**Spec coverage:**
- Identity (username, no password, cookie cache, cross-device resume) → B1, C1, F1(onHello keys by username), G1. ✓
- `/@username` profile, public → E2, G3. ✓
- Nested rooms `/@owner/<slug>`, `/r/` retired, DO keyed by owner/slug → E1, F1. ✓
- Room naming + rename → F1(onRename), G2. ✓
- Two scoreboards (profile stats + room tally) → B2, B3, C2, F1. ✓
- User DO + finish reporting → C2, F1(finishGame). ✓
- Directory KV + sitemap → D1/D2, E1(sitemap), F1(registerRoom). ✓
- Per-route meta/OG/canonical + JSON-LD → E2, H1. ✓
- llms.txt/full, robots, static OG → H1. ✓
- Share/invite core surface → G2. ✓
- Import device stats → G4 (flagged: needs `/import` endpoint or skip — confirm with Yan).

**Placeholder scan:** One conscious open item — the stats `/import` endpoint (G4) depends on the legacy localStorage stats shape, which isn't defined in the spec; flagged with a fallback (ship without import). All other steps contain concrete code.

**Type consistency:** `username` (not `id`/`nickname`), `winner` (not `winnerId`), `path`/`owner`/`name` on snapshot, `scoreboard: RoomScore[]`, `GameRecord`/`UserProfile` shapes are consistent across `types.ts`, `user.ts`, `room.ts`, `worker.ts`, and tests.

**Known follow-ups (not blockers):** dynamic OG images, public browse/leaderboard pages (phased per spec); G4 import endpoint detail.
