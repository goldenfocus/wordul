# Daily Stats Truth + Wordulers Play the WOTD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The daily stats page derives every number from the daily room roster (adding server-side `score`), and the 7 worduler personas each play the word of the day at a deterministic per-day random time, ranked inline like humans (no ledger writes).

**Architecture:** Pure cores + thin DO glue, the repo's house pattern. New pure schedule functions in `src/bots.ts`; `leaderboard-core.ts` learns `score` and ranks bots; a roster-driven view-model replaces the Science-fed one in `public/daily-stats.js`; a `POST /bots/tick` handler on the Room DO (driven by a new Cloudflare cron trigger) joins due personas, and the **existing** alarm-driven bot heartbeat plays them.

**Tech Stack:** Cloudflare Workers + Durable Objects (`wrangler.jsonc`), TypeScript, vitest. Spec: `docs/superpowers/specs/2026-06-06-daily-stats-and-worduler-wotd-design.md`.

**Worktree:** all work in `.claude/worktrees/daily-stats-bots` (branch `daily-stats-bots`). Run all commands from that directory.

**Key existing facts (verified):**
- `activeDate()` rolls at **00:00 UTC** (`src/daily-core.ts:33`); `fnv1a` deterministic hash lives right below it (`src/daily-core.ts:38`) — reuse it, don't write a new hash.
- `PlayerState.points` is required and server-maintained for every player incl. bots (`src/room.ts:1019`); gold derives from it via `goldFromPoints(player.points)` (`src/room.ts:1705`).
- The Room DO's single alarm already paces bots: `armBotHeartbeat` (`src/room.ts:1156`) → `alarm()` playing-phase branch (`src/room.ts:1195`) → `runBotPump` → `runBotTurn`. Daily rooms are **always** phase `"playing"` (async one-shot), so the alarm is free for the pump.
- `ensureBots` hard-bars the daily (`src/room.ts:1106`) — leave that guard; daily bots get their own join path.
- `scorePlayer` (`src/room.ts:1662`) computes `gold` for everyone at line ~1706, appends the game record, then early-returns for bots at ~1727 **before** setting `goldAwarded`. Bots never mint — that stays true.
- `rankedEntries` (`src/leaderboard-core.ts:39`) filters `!pl.isBot && typeof goldAwarded === "number"`. Mid-game players have no `goldAwarded`, so unfinished bots stay invisible automatically.
- Public payloads must never carry `isBot` (worduler cover rule, `src/bots.ts:73`). `LeaderEntry` is built by an explicit map that already omits it — keep it that way.

---

### Task 1: Deterministic WOTD schedule for personas (pure functions)

**Files:**
- Modify: `src/bots.ts` (add two pure functions at the bottom)
- Test: `test/bots.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `test/bots.test.ts` (note: `wotdPlayTime`/`dueWotdPersonas` added to the existing import from `../src/bots.ts`):

```ts
import { wotdPlayTime, dueWotdPersonas } from "../src/bots.ts";

describe("wotdPlayTime", () => {
  it("is stable for the same persona+date", () => {
    expect(wotdPlayTime("maya", "2026-06-06")).toEqual(wotdPlayTime("maya", "2026-06-06"));
  });

  it("yields a valid UTC hour/minute", () => {
    for (const p of PERSONAS) {
      const t = wotdPlayTime(p.id, "2026-06-06");
      expect(t.hour).toBeGreaterThanOrEqual(0);
      expect(t.hour).toBeLessThanOrEqual(23);
      expect(t.minute).toBeGreaterThanOrEqual(0);
      expect(t.minute).toBeLessThanOrEqual(59);
    }
  });

  it("varies across dates and across personas (not all identical)", () => {
    const acrossDates = new Set(
      ["2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09", "2026-06-10"]
        .map((d) => wotdPlayTime("maya", d).hour),
    );
    expect(acrossDates.size).toBeGreaterThan(1);
    const acrossBots = new Set(PERSONAS.map((p) => wotdPlayTime(p.id, "2026-06-06").hour));
    expect(acrossBots.size).toBeGreaterThan(1);
  });
});

describe("dueWotdPersonas", () => {
  const date = "2026-06-06";
  const dayStart = Date.UTC(2026, 5, 6); // 2026-06-06T00:00:00Z
  const endOfDay = dayStart + 24 * 3600_000 - 1;

  it("returns every persona by end of day, none before day start", () => {
    expect(dueWotdPersonas(date, dayStart - 1, new Set()).length).toBe(0);
    expect(dueWotdPersonas(date, endOfDay, new Set()).map((p) => p.id).sort())
      .toEqual(PERSONAS.map((p) => p.id).sort());
  });

  it("is monotonic: later in the day is a superset", () => {
    const atNoon = dueWotdPersonas(date, dayStart + 12 * 3600_000, new Set()).map((p) => p.id);
    const atEnd = dueWotdPersonas(date, endOfDay, new Set()).map((p) => p.id);
    for (const id of atNoon) expect(atEnd).toContain(id);
  });

  it("skips personas already present (idempotent re-poke)", () => {
    const all = dueWotdPersonas(date, endOfDay, new Set()).map((p) => p.id);
    const present = new Set(all.slice(0, 3));
    const again = dueWotdPersonas(date, endOfDay, present).map((p) => p.id);
    expect(again).toEqual(all.filter((id) => !present.has(id)));
    expect(dueWotdPersonas(date, endOfDay, new Set(all)).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/bots.test.ts`
Expected: FAIL — `wotdPlayTime` is not exported.

- [ ] **Step 3: Implement in `src/bots.ts`**

Add at the bottom of `src/bots.ts` (the file's header comment says "no solver/room runtime imports" — `fnv1a` is a pure hash from `daily-core.ts`, allowed):

```ts
import { fnv1a } from "./daily-core.ts";

/**
 * "Their hour": when this persona plays the word of the day. Deterministic per
 * (persona, date) — no Math.random (hibernation/replay-safe) — but different every
 * day, so the cast reads as people with routines, not cron jobs. UTC, matching
 * activeDate()'s day boundary.
 */
export function wotdPlayTime(personaId: string, date: string): { hour: number; minute: number } {
  const h = fnv1a(`wotd:${personaId}:${date}`);
  return { hour: h % 24, minute: (h >>> 5) % 60 };
}

/**
 * Which personas are due to play `date`'s word at `nowMs` and aren't already in the
 * room. Pure — the Room DO's /bots/tick is a thin caller, so idempotence is tested
 * here, not in DO glue. Catch-up by design: a room poked late joins every overdue
 * persona at once.
 */
export function dueWotdPersonas(
  date: string,
  nowMs: number,
  present: ReadonlySet<string>,
): BotPersona[] {
  const dayStart = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(dayStart) || nowMs < dayStart) return [];
  return PERSONAS.filter((p) => {
    if (present.has(p.id)) return false;
    const t = wotdPlayTime(p.id, date);
    return nowMs >= dayStart + (t.hour * 60 + t.minute) * 60_000;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/bots.test.ts`
Expected: PASS (all blocks, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/bots.ts test/bots.test.ts
git commit -m "feat(bots): deterministic per-day WOTD play time for each persona"
```

---

### Task 2: `score` on the leaderboard + bots rank inline

**Files:**
- Modify: `src/leaderboard-core.ts`
- Test: `test/leaderboard-core.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `test/leaderboard-core.test.ts` (match the file's existing fixture style; `fullDaily`/`topDaily` already imported):

```ts
describe("score + bots on the board", () => {
  const players = [
    { username: "yan", guessCount: 4, won: true, goldAwarded: 119, score: 1900 },
    { username: "maya", guessCount: 3, won: true, isBot: true, goldAwarded: 125, score: 2100 },
    { username: "mid-game", guessCount: 2, won: false, score: 800 }, // no goldAwarded → unranked
  ];

  it("ranks bots inline by the same gold-desc sort", () => {
    const view = fullDaily(players, "yan");
    expect(view.players.map((p) => p.username)).toEqual(["maya", "yan"]);
    expect(view.players[0].rank).toBe(1);
    expect(view.total).toBe(2);
  });

  it("passes score through to entries", () => {
    const view = fullDaily(players, "yan");
    expect(view.players.map((p) => p.score)).toEqual([2100, 1900]);
  });

  it("never leaks isBot on output rows (worduler cover rule)", () => {
    for (const row of fullDaily(players, "yan").players) {
      expect("isBot" in row).toBe(false);
    }
    for (const row of topDaily(players, "yan", 3).top) {
      expect("isBot" in row).toBe(false);
    }
  });

  it("still requires a confirmed goldAwarded to rank", () => {
    expect(fullDaily(players, "mid-game").youRank).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/leaderboard-core.test.ts`
Expected: FAIL — bots filtered out and `score` undefined on entries.

- [ ] **Step 3: Implement in `src/leaderboard-core.ts`**

Three edits:

1. Add `score` to `RankablePlayer` (after the `goldAwarded` line):

```ts
  goldAwarded?: number | null;
  score?: number;       // server-side game points at finish (gold derives from this)
```

2. Add `score` to `LeaderEntry`:

```ts
export type LeaderEntry = {
  username: string; gold: number; guesses: number; won: boolean; score?: number;
  resigned?: boolean; grid?: string[]; words?: string[]; durationMs?: number;
};
```

3. In `rankedEntries`, drop the bot filter and map `score` (bots now carry a computed
`goldAwarded` — Task 5 — and rank by the same sort; `isBot` is consumed here and never
copied onto the output row, preserving the cover rule):

```ts
function rankedEntries(players: RankablePlayer[]): LeaderEntry[] {
  return (players ?? [])
    .filter((pl) => pl && typeof pl.goldAwarded === "number")
    .map((pl) => ({
      username: pl.username, gold: pl.goldAwarded as number, guesses: pl.guessCount,
      won: pl.won, score: pl.score, resigned: pl.resigned, grid: pl.grid, words: pl.words,
      durationMs: pl.durationMs,
    }))
    .sort((a, b) =>
      b.gold - a.gold ||
      a.guesses - b.guesses ||
      (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
}
```

Also update the comment above the function (it still says "non-bot"): a player is RANKED
iff they have a confirmed `goldAwarded` number; bots get a computed (never minted) one.
Update the matching sentence in the `RankablePlayer` doc comment too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/leaderboard-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/leaderboard-core.ts test/leaderboard-core.test.ts
git commit -m "feat(leaderboard): expose server-side score; rank wordulers inline (cover intact)"
```

---

### Task 3: Room DO roster payload carries `score`

**Files:**
- Modify: `src/room.ts:213-221` (`toRankable` inside the `/leaderboard` GET)

- [ ] **Step 1: Add `score` to the mapping**

In `src/room.ts`, the `toRankable` arrow inside the leaderboard handler becomes:

```ts
      const toRankable = (p: PlayerState) => ({
        username: p.username,
        guessCount: p.guesses.length,
        won: p.status === "won",
        resigned: p.resigned,
        isBot: p.isBot,
        goldAwarded: p.goldAwarded,
        score: p.points,
        durationMs: durationOf(p),
      });
```

- [ ] **Step 2: Typecheck + run the room test files**

Run: `npm run typecheck && npx vitest run test/leaderboard-core.test.ts test/daily-board-unlock.test.ts test/room-core.test.ts`
Expected: PASS (pure mapping addition; no behavior change for humans).

- [ ] **Step 3: Commit**

```bash
git add src/room.ts
git commit -m "feat(room): daily roster rows carry server-side score (points)"
```

---

### Task 4: Roster-driven stats view-model

**Files:**
- Modify: `public/daily-stats.js` (replace `computeDailyStatsView` with `computeDailyStatsFromRoster`; keep `computeRosterView`)
- Test: `test/daily-stats.test.js` (replace the `computeDailyStatsView` describe block; keep `computeRosterView` tests)

- [ ] **Step 1: Write the failing tests**

In `test/daily-stats.test.js`, replace the `computeDailyStatsView` import and describe block with:

```js
import { computeDailyStatsFromRoster, computeRosterView } from "../public/daily-stats.js";

describe("computeDailyStatsFromRoster", () => {
  // Mirrors the Jun 6 screenshot bug: tiles must agree with the player list, always.
  const full = {
    players: [
      { rank: 1, username: "word", gold: 125, guesses: 3, won: true,  score: 2500, durationMs: 234000 },
      { rank: 2, username: "yan",  gold: 119, guesses: 4, won: true,  score: 2100, durationMs: 141000 },
      { rank: 3, username: "yang", gold: 119, guesses: 4, won: true,  score: 2080, durationMs: 139000 },
      { rank: 4, username: "papa", gold: 117, guesses: 4, won: true,  score: 2000, durationMs: 260000 },
      { rank: 5, username: "oops", gold: 100, guesses: 8, won: false, score: 600 },
      { rank: 6, username: "quit", gold: 0,   guesses: 2, won: false, score: 0, resigned: true },
    ],
    total: 6,
  };

  it("played = roster length; tiles can never disagree with the list", () => {
    expect(computeDailyStatsFromRoster(full).played).toBe(6);
  });

  it("solve rate over all finishers", () => {
    expect(computeDailyStatsFromRoster(full).winRate).toBe(67); // 4/6 → 66.7 → 67
  });

  it("avg guesses among solves only", () => {
    expect(computeDailyStatsFromRoster(full).avgGuesses).toBeCloseTo((3 + 4 + 4 + 4) / 4, 6);
  });

  it("avg score is the mean of roster scores", () => {
    const mean = (2500 + 2100 + 2080 + 2000 + 600 + 0) / 6;
    expect(computeDailyStatsFromRoster(full).avgScore).toBeCloseTo(mean, 6);
  });

  it("distribution counts winners by guess count", () => {
    const v = computeDailyStatsFromRoster(full);
    const at = (g) => v.distRows.find((r) => r.guesses === g)?.count ?? 0;
    expect(at(3)).toBe(1);
    expect(at(4)).toBe(3);
    expect(at(2)).toBe(0); // the resigner's 2 rows are NOT a 2-guess solve
    expect(v.maxCount).toBe(3);
  });

  it("failed = lost without resigning; resigners counted separately", () => {
    const v = computeDailyStatsFromRoster(full);
    expect(v.losses).toBe(1);
  });

  it("empty/cold day yields zeros and null averages", () => {
    const v = computeDailyStatsFromRoster(null);
    expect(v.played).toBe(0);
    expect(v.winRate).toBe(null);
    expect(v.avgGuesses).toBe(null);
    expect(v.avgScore).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/daily-stats.test.js`
Expected: FAIL — `computeDailyStatsFromRoster` not exported.

- [ ] **Step 3: Implement in `public/daily-stats.js`**

Replace `computeDailyStatsView` (and rewrite the file header comment) with:

```js
// public/daily-stats.js — pure view-models for the daily Stats page.
// EVERYTHING on the page derives from one source: the daily room's full roster
// (/api/daily/<date>/leaderboard?full=1). The Science feed still powers /feed (the
// Lab) but is no longer used here — it is day-sharded across ALL modes (rooms,
// challenges, daily) and counts rounds, not people, which made the tiles disagree
// with the player list (Jun 6 incident: "2 PLAYED" above a 4-player roster).

export function computeDailyStatsFromRoster(full) {
  const rows = (full && Array.isArray(full.players)) ? full.players : [];
  const played = rows.length;
  const wins = rows.filter((r) => r.won).length;
  const losses = rows.filter((r) => !r.won && !r.resigned).length;
  const winRate = played > 0 ? Math.round((wins / played) * 100) : null;

  // Guess distribution over SOLVES (a loser's row count is not a solve).
  let weighted = 0;
  let maxCount = 0;
  const distRows = [];
  for (let g = 1; g <= 8; g++) {
    const count = rows.filter((r) => r.won && r.guesses === g).length;
    if (count > 0) weighted += g * count;
    if (count > maxCount) maxCount = count;
    distRows.push({ guesses: g, count });
  }
  const avgGuesses = wins > 0 ? weighted / wins : null;

  const scores = rows.filter((r) => typeof r.score === "number");
  const avgScore = scores.length > 0
    ? scores.reduce((sum, r) => sum + r.score, 0) / scores.length
    : null;

  return { played, wins, losses, winRate, avgGuesses, avgScore, distRows, maxCount };
}
```

`computeRosterView` stays exactly as is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/daily-stats.test.js`
Expected: PASS (including the untouched `computeRosterView` block).

- [ ] **Step 5: Commit**

```bash
git add public/daily-stats.js test/daily-stats.test.js
git commit -m "fix(daily-stats): tiles + distribution derive from the roster, not Science"
```

---

### Task 5: Wire the stats page to the single roster fetch

**Files:**
- Modify: `public/app.js` — `showDailyStats` (~line 948), `renderDailyRoster` (~line 960), `renderDailyStatsBody` (~line 991), and the import at line 19

- [ ] **Step 1: Restructure the page to one data source**

1. Line 19 import becomes:

```js
import { computeDailyStatsFromRoster, computeRosterView } from "/daily-stats.js";
```

2. In `showDailyStats`, replace the science fetch + the two render calls (lines ~948-955):

```js
  let full = null;
  try {
    const me = getUsername();
    const res = await fetch(`/api/daily/${date}/leaderboard?full=1&username=${encodeURIComponent(me)}`);
    if (res.ok) full = await res.json();
  } catch (_) { /* offline / cold day — render the empty state */ }
  if (parseRoute().kind !== "daily-stats") return; // navigated away mid-fetch
  renderDailyStatsBody(full);
  renderDailyRoster(full);
```

3. `renderDailyRoster` becomes synchronous and takes the already-fetched payload — delete
its own fetch (keep everything from `const host = $("#dailyRoster")` down unchanged):

```js
// Paint the full ranked roster (names, gold, guesses, duration) below the aggregates.
// Same payload as the tiles — one source, no disagreement possible.
function renderDailyRoster(full) {
  const me = getUsername();
  const host = $("#dailyRoster");
  if (!host) return;
  const view = computeRosterView(full, me);
  // ... existing rendering body unchanged ...
}
```

4. `renderDailyStatsBody` consumes the roster payload:

```js
function renderDailyStatsBody(full) {
  const body = $("#dailyStatsBody");
  if (!body) return;
  const v = computeDailyStatsFromRoster(full);
  if (v.played === 0) {
    body.innerHTML = `<p class="muted daily-stats-empty">No numbers yet today — be the first to finish.</p>`;
    return;
  }
  // ... existing tile/distribution markup unchanged, fed by the new v ...
}
```

The tile markup itself is unchanged (`v.played`, `v.winRate`, `v.avgGuesses`, `v.avgScore`,
`v.distRows`, `v.maxCount`, `v.losses` all keep their names).

- [ ] **Step 2: Run the front-end test suite + typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: PASS. If any test imported `computeDailyStatsView`, it was replaced in Task 4 — a stray reference means a missed consumer; grep before moving on:

Run: `grep -rn "computeDailyStatsView" public/ test/ src/`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "fix(daily-stats): one fetch feeds tiles and roster — numbers always agree"
```

---

### Task 6: Wordulers play the daily (Room DO)

**Files:**
- Modify: `src/room.ts` — new `/bots/tick` route + handler; daily pacing in `armBotHeartbeat`/`runBotTurn`; `scorePlayer` bot branch

- [ ] **Step 1: Add the tick route**

In `Room.fetch`, directly above the `/leaderboard` GET block (`src/room.ts:203`), add:

```ts
    // Cron-driven: wordulers play the word of the day at "their hour". The worker's
    // scheduled handler pokes this every tick; dueWotdPersonas is pure + idempotent
    // (already-present personas are skipped), so re-pokes are harmless. `path` stamps
    // identity on a cold DO — without it a fresh room has path "" and can't seed.
    if (req.method === "POST" && url.pathname === "/bots/tick") {
      const path = url.searchParams.get("path") ?? "";
      if (this.state.path === "" && /^daily\/\d{4}-\d{2}-\d{2}$/.test(path)) {
        this.state.path = path;
        const [owner, slug] = path.split("/");
        this.state.owner = owner ?? "";
        this.state.slug = slug ?? "";
      }
      return this.handleWotdBotTick();
    }
```

- [ ] **Step 2: Implement the handler**

Add next to `ensureBots` (after `src/room.ts:1151`). Import `dueWotdPersonas` from `./bots.ts` (the file already imports from it):

```ts
  // Join every persona whose play time has passed and start the existing heartbeat.
  // Bots walk the REAL paths — join, solver, applyGuess, scorePlayer, leaderboard —
  // so every daily tick doubles as a beta test of the human pipeline.
  private async handleWotdBotTick(): Promise<Response> {
    await this.seedDailyIfNeeded();
    if (!this.state.isDaily || !this.state.word) {
      return Response.json({ ok: false, reason: "not seeded" }, { status: 409 });
    }
    const date = dailyDateOf(this.state.path) ?? "";
    const present = new Set(this.state.players.map((p) => p.username));
    const due = dueWotdPersonas(date, Date.now(), present);
    for (const persona of due) {
      this.state.players.push({
        username: persona.id,
        connected: true,
        guesses: [],
        status: "playing",
        isBot: true,
        ready: true,
        role: "duelist",       // inert in daily rooms
        scienceOptOut: true,   // bots stay out of the Science aggregates (spec)
        revealHints: 0,
        vowelHints: 0,
        points: 0,
        pointsSpent: 0,
      });
    }
    if (due.length > 0) {
      this.armBotHeartbeat(true); // arm nextGuessAt + the DO alarm → runBotPump plays them
      await this.persistAndBroadcast();
    }
    return Response.json({ ok: true, joined: due.map((p) => p.id) });
  }
```

- [ ] **Step 3: Daily bots use the human-ish solver + beatable pacing**

Two one-line changes so daily bots read as people, not a sharp solver:

1. `runBotTurn` (`src/room.ts:1242`): `const seeded = !!this.state.seed;` becomes

```ts
    const seeded = !!this.state.seed || this.state.isDaily; // daily bots pace like people
```

and the guess pick (`src/room.ts:1245-1247`) becomes:

```ts
    const word = seeded
      ? noobGuess(view, { mistakeRate: mistakeRateFor(this.state.wordLength, 1) }, Math.random())
      : computeNextGuess(view);
```

(`mistakeRateFor(length, 1)` = the modest solo-opponent rate; persona-differentiated skill
is a later slice per the spec.)

2. `armBotHeartbeat` (`src/room.ts:1157`): `const seeded = !!this.state.seed;` becomes

```ts
    const seeded = !!this.state.seed || this.state.isDaily;
```

- [ ] **Step 4: Bots get a computed (never minted) goldAwarded**

In `scorePlayer`, the bot early-return (`src/room.ts:1726-1730`) becomes (`gold` is already
computed above at ~1706 by the SAME formula humans get):

```ts
    // Bots never mint — no ledger write, zero economy impact — but they DO get the
    // same computed gold number so rankedEntries ranks them like any finisher.
    if (player.isBot) {
      player.scored = true;
      player.goldAwarded = gold;
      return;
    }
```

- [ ] **Step 5: Typecheck + full test run**

Run: `npm run typecheck && npx vitest run`
Expected: PASS. The daily guard in `ensureBots` (room.ts:1106) is untouched — arena/robot
paths can't leak into the daily; only the tick joins daily bots.

- [ ] **Step 6: Commit**

```bash
git add src/room.ts
git commit -m "feat(room): wordulers play the WOTD via /bots/tick — real paths, no minting"
```

---

### Task 7: Cron trigger + worker scheduled handler

**Files:**
- Modify: `src/worker.ts` (add `scheduled` to the default export at line 61)
- Modify: `wrangler.jsonc` (add `triggers`)

- [ ] **Step 1: Add the scheduled handler**

In `src/worker.ts`, the default export (`line 61`) gains a `scheduled` method alongside `fetch` (`activeDate` is already imported):

```ts
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // ... existing body unchanged ...
  },

  // Cron (wrangler.jsonc triggers): poke today's daily room so wordulers play at
  // "their hour" even on a day no human has opened the daily (the DO can't set its
  // own alarm before it exists — this tick is what creates/seeds it).
  async scheduled(_ctrl: ScheduledController, env: Env): Promise<void> {
    const date = activeDate(Date.now());
    const path = `daily/${date}`;
    const stub = env.ROOM.get(env.ROOM.idFromName(path));
    const res = await stub.fetch(`https://do/bots/tick?path=${encodeURIComponent(path)}`, { method: "POST" });
    if (!res.ok && res.status !== 409) console.error("wotd bot tick non-ok", date, res.status);
    // 409 = word not resolvable yet (e.g. Daily DO cold) — the next tick retries.
  },
};
```

- [ ] **Step 2: Add the cron trigger**

In `wrangler.jsonc`, after the `"observability"` block (keep the trailing comment block last):

```jsonc
  // Wordulers' WOTD heartbeat: every 10 minutes the worker pokes today's daily room;
  // personas whose deterministic play time has passed join and play (src/bots.ts
  // wotdPlayTime). 10-min granularity keeps "their minute" roughly honest at 144
  // free-tier invocations/day.
  "triggers": {
    "crons": ["*/10 * * * *"]
  },
```

- [ ] **Step 3: Typecheck + dry-run config**

Run: `npm run typecheck && npx wrangler deploy --dry-run`
Expected: typecheck PASS; dry-run prints the worker summary including the cron schedule, no errors. (`ScheduledController` is a global Workers type — if typecheck complains, use `_ctrl: unknown`.)

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts wrangler.jsonc
git commit -m "feat(cron): 10-min tick drives wordulers' daily play"
```

---

### Task 8: Ship + verify on prod

- [ ] **Step 1: Full gauntlet then ship**

Use the `/push` skill (it runs safe-build, check-i18n, check-pill-buttons, check-input-zoom, code-reviewer, silent-failure-hunter in parallel and blocks on failure), or `bash dev/ship.sh`. CI deploys `origin/main`.

- [ ] **Step 2: Post-deploy verification (within ~20 min of deploy)**

```bash
# Cron registered? (CLOUDFLARE_* creds: sops -d ~/golden-vault/secrets/wordul-prod.env)
npx wrangler triggers list 2>/dev/null || true   # or check dash; non-blocking

# Roster now carries score:
curl -s "https://wordul.com/api/daily/$(date -u +%F)/leaderboard?full=1&username=verify-bot" | python3 -m json.tool | head -30

# After the next 10-min tick, due personas appear (works once any persona's hour has passed):
curl -s "https://wordul.com/api/daily/$(date -u +%F)/leaderboard?full=1&username=verify-bot" | grep -oE '"username": "(maya|theo|nova|remy|juno|pax|ivy)"' || echo "no persona due/finished yet — check wotdPlayTime hours for today"
```

- [ ] **Step 3: Post-Deploy Summary** (Telegram format per global CLAUDE.md — max 5 bullets, 3 test steps, verifiable in 60s)

---

## Self-Review (done at plan time)

- **Spec coverage:** roster-driven tiles (T4-5) ✓ · score exposed server-side (T2-3) ✓ · deterministic per-day hour (T1) ✓ · cron tick + cold-start seeding (T6-7) ✓ · same gold formula, no ledger write (T6.4) ✓ · cover rule / no isBot leak (T2 test) ✓ · bots out of Science (`scienceOptOut: true`, T6.2) ✓ · replay/duration honest (existing heartbeat, real timestamps) ✓.
- **Types:** `score?: number` consistent across `RankablePlayer` → `LeaderEntry` → roster JSON → `computeDailyStatsFromRoster`. `wotdPlayTime`/`dueWotdPersonas` signatures match between T1 impl and T6 caller.
- **Known accepted risks:** persona usernames (maya…) could collide with humans wanting those names (pre-existing arena exposure); 7 bots may dominate sparse boards (spec: accepted); `scorePlayer` already appends bot game records to the USER DO — kept (embodiment + exercises real paths).
