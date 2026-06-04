# Daily swappable player cards + solve duration + full roster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-player solve duration; let the post-play home card swap its featured card to any leaderboard player (letters never leave your browser); and add a full ranked player roster at the bottom of the Today's stats page.

**Architecture:** Capture two per-player timestamps in the daily Room DO (`firstGuessAt`, `finishedAt`) → duration. Surface `durationMs` (and, for the home card, a letterless color `grid`) through the existing `topDaily` leaderboard payload, plus a new `fullDaily` variant for the complete roster. The home card (`daily-card.js`) gains a swappable featured region; the stats page (`app.js`) appends a lean ranked list.

**Tech Stack:** Cloudflare Workers + Durable Objects (TypeScript), vanilla JS frontend (no framework), vitest for pure-module tests.

**Worktree:** `/Users/theoutsider/wordul/.claude/worktrees/daily-cards-swap` (branch `daily-cards-swap`). Run all commands from there.

**Spec:** `docs/superpowers/specs/2026-06-04-daily-swappable-cards-design.md`

**Verification tooling:** `npm test` (vitest), `npm run typecheck`, `npm run dev` + the `/browse` skill for visual checks. Never `wrangler deploy` by hand.

---

## Phase A — Backend: solve duration (v1)

### Task A1: Add per-player timestamp fields to `PlayerState`

**Files:**
- Modify: `src/types.ts` (PlayerState, ~line 40-57)

- [ ] **Step 1: Add the two optional fields**

In `src/types.ts`, inside `export type PlayerState = { … }`, add after the
`resigned?: boolean;` line:

```ts
  resigned?: boolean;      // gave up (vs ran out of guesses) — both land status "lost"
  firstGuessAt?: number;   // daily: epoch ms of this player's first guess (start of solve clock)
  finishedAt?: number;     // daily: epoch ms this player finished (won/lost/resigned) — solve clock end
  nextGuessAt?: number;    // bot-only: epoch ms this bot is next due to guess (per-bot heartbeat, Inc.2)
```

(The `resigned?` and `nextGuessAt?` lines already exist — insert the two new lines between them.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages yet; optional fields are additive).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(daily): add per-player firstGuessAt/finishedAt to PlayerState"
```

---

### Task A2: Stamp the timestamps in the Room DO

**Files:**
- Modify: `src/room.ts` `applyGuess` (~line 861) and `onResign` (~line 1094)

- [ ] **Step 1: Stamp `firstGuessAt` on the first guess**

In `applyGuess`, find:

```ts
    player.guesses.push({ word, mask });
    player.points = pointsEarned(player.guesses, this.state.maxGuesses) - player.pointsSpent;
```

Insert between those two lines:

```ts
    player.guesses.push({ word, mask });
    if (player.firstGuessAt == null) player.firstGuessAt = now;
    player.points = pointsEarned(player.guesses, this.state.maxGuesses) - player.pointsSpent;
```

- [ ] **Step 2: Stamp `finishedAt` on the win/lose transition**

Still in `applyGuess`, find:

```ts
    if (priorStatus === "playing" && player.status !== "playing") {
      this.emitPlayerFinished(player, player.status === "won" ? "won" : "lost", now);
    }
```

Replace with:

```ts
    if (priorStatus === "playing" && player.status !== "playing") {
      player.finishedAt = now;
      this.emitPlayerFinished(player, player.status === "won" ? "won" : "lost", now);
    }
```

- [ ] **Step 3: Stamp `finishedAt` on resign**

In `onResign`, find:

```ts
    player.resigned = true;
    player.points = 0;
```

Replace with:

```ts
    player.resigned = true;
    player.points = 0;
    player.finishedAt = Date.now();
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts
git commit -m "feat(daily): stamp firstGuessAt/finishedAt as players guess, win, lose, resign"
```

---

### Task A3: Thread `grid` + `durationMs` through `leaderboard-core`

**Files:**
- Modify: `src/leaderboard-core.ts`
- Test: `test/leaderboard-core.test.ts`

- [ ] **Step 1: Write failing tests for the new passthrough fields**

Append to `test/leaderboard-core.test.ts`, inside the `describe("topDaily", …)` block
(before its closing `});`):

```ts
  it("carries grid and durationMs through into top entries", () => {
    const players: RankablePlayer[] = [
      { username: "ava", guessCount: 2, won: true, goldAwarded: 1240, grid: ["ggggg"], durationMs: 134000 },
    ];
    const { top } = topDaily(players, "ava", 3);
    expect(top[0].grid).toEqual(["ggggg"]);
    expect(top[0].durationMs).toBe(134000);
  });

  it("leaves grid/durationMs undefined when not provided", () => {
    const { top } = topDaily([p("ava", 1240, 2)], "ava", 3);
    expect(top[0].grid).toBeUndefined();
    expect(top[0].durationMs).toBeUndefined();
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npm test -- leaderboard-core`
Expected: FAIL — `top[0].grid` / `durationMs` are `undefined` because the type/map don't carry them yet (the first test fails its `toEqual`).

- [ ] **Step 3: Extend the types and factor a shared ranker**

In `src/leaderboard-core.ts`, replace the `RankablePlayer` and `LeaderEntry` type
declarations and the `topDaily` function with:

```ts
export type RankablePlayer = {
  username: string;
  guessCount: number;
  won: boolean;
  resigned?: boolean;   // gave up (vs ran out of guesses) — drives the 💀 board marker
  isBot?: boolean;
  goldAwarded?: number | null;
  grid?: string[];      // letterless color rows ("g"/"y"/"x") — home card's swappable card
  durationMs?: number;  // first guess → finish; omitted when unknown
};

export type LeaderEntry = {
  username: string; gold: number; guesses: number; won: boolean;
  resigned?: boolean; grid?: string[]; durationMs?: number;
};
export type LeaderboardView = {
  top: LeaderEntry[];                            // top N by gold desc, then fewer guesses
  you: (LeaderEntry & { rank: number }) | null;  // caller's row + 1-based rank, ONLY when outside top N
  total: number;                                 // count of ranked players
};

function clampN(n: number): number {
  const v = Math.floor(n);
  if (!Number.isFinite(v) || v <= 0) return 3;
  return Math.min(10, v);
}

// Shared filter + sort + map. A player is RANKED iff non-bot with a confirmed mint
// (goldAwarded is a number). Sort: gold desc → fewer guesses → username asc.
function rankedEntries(players: RankablePlayer[]): LeaderEntry[] {
  return (players ?? [])
    .filter((pl) => pl && !pl.isBot && typeof pl.goldAwarded === "number")
    .map((pl) => ({
      username: pl.username, gold: pl.goldAwarded as number, guesses: pl.guessCount,
      won: pl.won, resigned: pl.resigned, grid: pl.grid, durationMs: pl.durationMs,
    }))
    .sort((a, b) =>
      b.gold - a.gold ||
      a.guesses - b.guesses ||
      (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
}

export function topDaily(players: RankablePlayer[], username: string, n: number): LeaderboardView {
  const ranked = rankedEntries(players);
  const size = clampN(n);
  const top = ranked.slice(0, size);
  const meIdx = ranked.findIndex((e) => e.username === username);
  const you = meIdx >= size ? { ...ranked[meIdx], rank: meIdx + 1 } : null;
  return { top, you, total: ranked.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- leaderboard-core`
Expected: PASS (the two new tests + all existing topDaily tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/leaderboard-core.ts test/leaderboard-core.test.ts
git commit -m "feat(daily): carry grid + durationMs through leaderboard ranking"
```

---

### Task A4: Map `grid` + `durationMs` in the Room DO `/leaderboard` handler

**Files:**
- Modify: `src/room.ts` GET `/leaderboard` handler (~line 194)

- [ ] **Step 1: Replace the handler body to compute duration + grid**

In `src/room.ts`, find:

```ts
    if (req.method === "GET" && url.pathname.endsWith("/leaderboard")) {
      const username = (url.searchParams.get("username") ?? "").toLowerCase().trim();
      const n = Number(url.searchParams.get("n") ?? "3");
      const players = this.state.players.map((p) => ({
        username: p.username,
        guessCount: p.guesses.length,
        won: p.status === "won",
        resigned: p.resigned,
        isBot: p.isBot,
        goldAwarded: p.goldAwarded,
      }));
      return Response.json(topDaily(players, username, n));
    }
```

Replace with:

```ts
    if (req.method === "GET" && url.pathname.endsWith("/leaderboard")) {
      const username = (url.searchParams.get("username") ?? "").toLowerCase().trim();
      const n = Number(url.searchParams.get("n") ?? "3");
      const durationOf = (p: PlayerState) =>
        p.firstGuessAt != null && p.finishedAt != null
          ? Math.max(0, p.finishedAt - p.firstGuessAt)
          : undefined;
      const players = this.state.players.map((p) => ({
        username: p.username,
        guessCount: p.guesses.length,
        won: p.status === "won",
        resigned: p.resigned,
        isBot: p.isBot,
        goldAwarded: p.goldAwarded,
        grid: encodeSolveGrid(p.guesses),
        durationMs: durationOf(p),
      }));
      return Response.json(topDaily(players, username, n));
    }
```

(`encodeSolveGrid` is already imported in `room.ts`; `PlayerState` is already imported.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/room.ts
git commit -m "feat(daily): leaderboard payload includes grid + durationMs per entry"
```

---

## Phase B — Frontend: swappable featured card on the home (v1)

### Task B1: Add `fmtDuration` + featured-card render to `daily-card.js`

**Files:**
- Modify: `public/daily-card.js`

- [ ] **Step 1: Add the `fmtDuration` helper (exported for reuse on the stats page)**

In `public/daily-card.js`, add near the top (after the `escAttr` helper, ~line 10):

```js
// Format a solve duration. null/undefined → "" (caller omits the chip). A genuine
// sub-second solve reads "<1s" rather than a confusing "0s".
export function fmtDuration(ms) {
  if (ms == null) return "";
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}
```

- [ ] **Step 2: Export `goldValue` for the stats page roster**

In `public/daily-card.js`, change:

```js
function goldValue(n) { return `${Number(n).toLocaleString()}${COIN}`; }
```

to:

```js
export function goldValue(n) { return `${Number(n).toLocaleString()}${COIN}`; }
```

- [ ] **Step 3: Add the featured-card renderer**

In `public/daily-card.js`, add directly after the `renderStamp` function (~line 58):

```js
// The featured card at the top of the post-play recap. For YOU, render your stamp WITH
// letters (from this browser's own solve) + a "Solved in N · 2m 14s" caption. For anyone
// else, render their color grid with NO letters + an "@name · #rank · gold · in N · time"
// stat line. Letters are never passed for another player.
function renderFeaturedCard(entry, { isYou, yourWords, rank }) {
  const won = !!entry.won;
  const grid = renderStamp(entry.grid, isYou ? yourWords : undefined);
  const dur = fmtDuration(entry.durationMs);
  if (isYou) {
    const verb = won ? `Solved in ${entry.guesses}` : "Missed today";
    const cap = dur ? `${verb} · ${dur}` : verb;
    return `${grid}<div class="daily-featured-cap">${cap}</div>`;
  }
  const u = escAttr(entry.username);
  const bits = [
    `<a class="daily-featured-name" href="/@${u}" data-profile="${u}">@${u}</a>`,
    `<span class="daily-featured-rank">#${rank}</span>`,
    `<span class="daily-featured-gold">${goldValue(entry.gold)}</span>`,
    `<span class="daily-featured-guesses">${won ? `in ${entry.guesses}` : "missed"}</span>`,
  ];
  if (dur) bits.push(`<span class="daily-featured-time">${dur}</span>`);
  return `${grid}<div class="daily-featured-cap is-other">${bits.join("")}</div>`;
}
```

- [ ] **Step 4: Typecheck (JS is unchecked, but keep the suite green)**

Run: `npm test`
Expected: PASS (no behavior changed yet; this just confirms nothing broke on import).

- [ ] **Step 5: Commit**

```bash
git add public/daily-card.js
git commit -m "feat(daily): fmtDuration + featured-card renderer (you with letters, others letterless)"
```

---

### Task B2: Wire the swap — featured region + row clicks

**Files:**
- Modify: `public/daily-card.js` `renderDailyCard` result branch (~line 127) and `wireDailyCard` result branch (~line 174)

- [ ] **Step 1: Wrap the hero in a swappable featured region**

In `renderDailyCard`'s `if (result) { … }` branch, `won` and `caption` are defined on
the two lines above. Replace everything from the existing `const stamp = renderStamp(...)`
line (~138) through the end of the `return \`<article …>\`;` statement with:

```js
    const stamp = renderStamp(result.solveGrid, result.solveWords);
    // Featured card region — JS fills it (defaults to your own card) once wired. The
    // immediate render shows your stamp so the recap never flashes empty.
    const heroInner = stamp
      ? `<div class="daily-stamp-hero ${won ? "is-won" : "is-lost"}" role="img" aria-label="${caption}">${stamp}</div>`
      : `<div class="daily-result ${won ? "is-won" : "is-lost"}">
        <span class="daily-result-mark" aria-hidden="true">${won ? GLYPH.check : GLYPH.cross}</span>
        <span class="daily-result-text">${caption}</span>
      </div>`;
    return `<article class="daily-card daily-done" data-theme="${themeId}">
      <div class="daily-featured" id="dailyFeatured">${heroInner}</div>
      <section class="daily-top" id="dailyTop" hidden aria-label="Today's top players"></section>
      <div class="daily-next">
        <span class="daily-next-label">Next Wordul in</span>
        <span class="daily-countdown" id="dailyCountdown">—</span>
      </div>
      <button id="dailySeeAll" class="daily-seeall" type="button" aria-label="See today's stats and everyone who played">
        Today's stats<span class="daily-chev" aria-hidden="true">›</span>
      </button>
    </article>`;
```

(This keeps the existing `caption`, `won`, and the fallback path; it only renames the
hero wrapper to `#dailyFeatured` and `.daily-stamp-hero`.)

- [ ] **Step 2: Add swap wiring in `wireDailyCard`**

In `wireDailyCard`, inside `if (result) { … }`, find the leaderboard block:

```js
        if (board && html) {
          board.innerHTML = html;
          board.hidden = false;
          if (onProfile) {
            board.querySelectorAll("a[data-profile]").forEach((a) => {
              a.addEventListener("click", (e) => { e.preventDefault(); onProfile(a.getAttribute("data-profile")); });
            });
          }
```

Replace that block with:

```js
        if (board && html) {
          board.innerHTML = html;
          board.hidden = false;
          // Index every visible entry by username so a row tap can re-feature it.
          const entries = new Map();
          (view.top || []).forEach((e, i) => entries.set(e.username, { entry: e, rank: i + 1 }));
          if (view.you) entries.set(view.you.username, { entry: view.you, rank: view.you.rank });
          const featured = document.getElementById("dailyFeatured");
          const rows = Array.from(board.querySelectorAll(".daily-top-row"));
          const myWords = (result && result.solveWords) || undefined;
          const setFeatured = (name) => {
            const hit = entries.get(name);
            if (!hit || !featured) return;
            const isYou = name === username;
            featured.innerHTML = renderFeaturedCard(hit.entry, { isYou, yourWords: myWords, rank: hit.rank });
            rows.forEach((r) => r.classList.toggle("is-selected", r.getAttribute("data-user") === name));
            // A featured "other" card's @name still navigates to their profile.
            if (!isYou && onProfile) {
              const a = featured.querySelector("a[data-profile]");
              if (a) a.addEventListener("click", (e) => { e.preventDefault(); onProfile(a.getAttribute("data-profile")); });
            }
          };
          // Row taps swap the featured card; the inner @name link still opens the profile.
          rows.forEach((row) => {
            const name = row.getAttribute("data-user");
            row.addEventListener("click", () => setFeatured(name));
            const a = row.querySelector("a[data-profile]");
            if (a) a.addEventListener("click", (e) => {
              e.preventDefault(); e.stopPropagation();
              if (onProfile) onProfile(a.getAttribute("data-profile"));
            });
          });
          // Default the featured card to you, and mark your row selected.
          if (entries.has(username)) setFeatured(username);
```

- [ ] **Step 3: Tag each leaderboard row with its username**

The swap wiring reads `data-user` off each row. In `renderLeaderboard`, find the row
template's opening `<li …>` (the function `row(entry, rank, opts)`):

```js
    return `<li class="daily-top-row${mine ? " is-you" : ""}${opts.pinned ? " is-pinned" : ""}">
```

Replace with:

```js
    return `<li class="daily-top-row${mine ? " is-you" : ""}${opts.pinned ? " is-pinned" : ""}" data-user="${u}">
```

- [ ] **Step 4: Verify the suite still passes + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Run: `npm run dev` (in the worktree). Then use the `/browse` skill:
1. Open the dev URL, set a username, play + finish today's daily so the recap shows.
2. Confirm the featured card shows your stamp **with letters** and a `Solved in N · <time>` caption (time fills in when the leaderboard resolves).
3. Tap another player's row → featured swaps to their **letterless** color grid + `@name · #rank · gold · in N · time`; that row gets the selected highlight.
4. Tap your own row → returns to your card.
5. Tap an `@username` (in a row or on a featured "other" card) → navigates to `/@name`, does **not** swap.

Capture a before/after screenshot for the PR.

- [ ] **Step 6: Commit**

```bash
git add public/daily-card.js
git commit -m "feat(daily): tap a leaderboard row to swap the featured card; @name still opens profile"
```

---

### Task B3: Styles for the featured card + selected row

**Files:**
- Modify: `public/style.css` (near the daily leaderboard styles, ~line 2710-2736)

- [ ] **Step 1: Add the featured-card + selected-row styles**

In `public/style.css`, after the `.daily-result-hero` rules (~line 2711) add:

```css
/* Featured card region — swappable hero for the post-play recap. */
.daily-featured { display: flex; flex-direction: column; align-items: center; gap: .35rem; padding: .35rem 0 .25rem; }
.daily-stamp-hero { display: flex; justify-content: center; }
.daily-stamp-hero.is-lost { opacity: .92; }
.daily-featured-cap { color: var(--muted); font-size: .9em; text-align: center; }
.daily-featured-cap.is-other { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: .5rem; }
.daily-featured-name { color: var(--fg); text-decoration: none; font-weight: 600; }
.daily-featured-name:hover { text-decoration: underline; }
.daily-featured-rank { font-variant-numeric: tabular-nums; }
.daily-featured-gold { color: #f0c14b; font-variant-numeric: tabular-nums; display: inline-flex; align-items: center; font-weight: 600; }
.daily-featured-guesses, .daily-featured-time { font-variant-numeric: tabular-nums; }
```

- [ ] **Step 2: Make leaderboard rows read as tappable + show selection**

Find:

```css
.daily-top-row.is-you { outline: 1px solid var(--accent); }
```

Replace with:

```css
.daily-top-row { cursor: pointer; }
.daily-top-row.is-you { outline: 1px solid var(--accent); }
.daily-top-row.is-selected { background: color-mix(in oklab, var(--accent) 14%, var(--bg-card)); }
```

- [ ] **Step 3: Manual verification**

With `npm run dev` running, re-check via `/browse`: rows show a pointer cursor; the
selected row has a subtle accent fill; the featured "other" stat line is centered and legible.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "style(daily): featured-card region + selected leaderboard row"
```

---

## Phase C — Backend: full roster endpoint (v2)

### Task C1: Add `fullDaily` to `leaderboard-core`

**Files:**
- Modify: `src/leaderboard-core.ts`
- Test: `test/leaderboard-core.test.ts`

- [ ] **Step 1: Write failing tests for `fullDaily`**

Append to `test/leaderboard-core.test.ts` (after the `describe("topDaily", …)` block):

```ts
describe("fullDaily", () => {
  it("returns every ranked player with a 1-based rank, sorted like topDaily", () => {
    const players = [
      p("ava", 1240, 2), p("bao", 1090, 3), p("cy", 980, 3),
      p("dot", 700, 4), p("me", 540, 4),
    ];
    const view = fullDaily(players, "me");
    expect(view.players.map((e) => e.username)).toEqual(["ava", "bao", "cy", "dot", "me"]);
    expect(view.players.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(view.total).toBe(5);
    expect(view.youRank).toBe(5);
  });

  it("excludes bots and unscored players, and reports youRank null when unranked", () => {
    const players: RankablePlayer[] = [
      p("ava", 1240, 2),
      { username: "clanker", guessCount: 2, won: true, goldAwarded: 9999, isBot: true },
      { username: "still", guessCount: 1, won: false, goldAwarded: undefined },
    ];
    const view = fullDaily(players, "ghost");
    expect(view.players.map((e) => e.username)).toEqual(["ava"]);
    expect(view.total).toBe(1);
    expect(view.youRank).toBeNull();
  });

  it("carries durationMs through (grid is left to the caller and may be absent)", () => {
    const players: RankablePlayer[] = [
      { username: "ava", guessCount: 2, won: true, goldAwarded: 1240, durationMs: 95000 },
    ];
    const view = fullDaily(players, "ava");
    expect(view.players[0].durationMs).toBe(95000);
    expect(view.players[0].grid).toBeUndefined();
  });
});
```

- [ ] **Step 2: Add the `fullDaily` import to the test file**

At the top of `test/leaderboard-core.test.ts`, change:

```ts
import { topDaily, type RankablePlayer } from "../src/leaderboard-core.ts";
```

to:

```ts
import { topDaily, fullDaily, type RankablePlayer } from "../src/leaderboard-core.ts";
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- leaderboard-core`
Expected: FAIL — `fullDaily` is not exported yet.

- [ ] **Step 4: Implement `fullDaily`**

In `src/leaderboard-core.ts`, append after `topDaily`:

```ts
// A single ranked entry with its 1-based rank — the full-roster row shape.
export type RosterEntry = LeaderEntry & { rank: number };
export type FullLeaderboardView = {
  players: RosterEntry[];      // ALL ranked players, sorted, each with a 1-based rank
  youRank: number | null;      // caller's rank if ranked, else null
  total: number;
};

// The complete daily roster for the stats page. Same filter/sort as topDaily, but
// returns every ranked player (topDaily caps at 10). Callers that want a lean payload
// simply don't supply `grid` on the input.
export function fullDaily(players: RankablePlayer[], username: string): FullLeaderboardView {
  const ranked = rankedEntries(players);
  const withRank: RosterEntry[] = ranked.map((e, i) => ({ ...e, rank: i + 1 }));
  const meIdx = ranked.findIndex((e) => e.username === username);
  return { players: withRank, youRank: meIdx >= 0 ? meIdx + 1 : null, total: ranked.length };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test -- leaderboard-core`
Expected: PASS (all topDaily + fullDaily tests green).

- [ ] **Step 6: Commit**

```bash
git add src/leaderboard-core.ts test/leaderboard-core.test.ts
git commit -m "feat(daily): fullDaily — complete ranked roster with per-player rank"
```

---

### Task C2: Serve the full roster from the Room DO + worker route

**Files:**
- Modify: `src/room.ts` `/leaderboard` handler (~line 194) and its `leaderboard-core` import (~line 13)
- Modify: `src/worker.ts` daily-leaderboard route (~line 91)

- [ ] **Step 1: Import `fullDaily` in `room.ts`**

In `src/room.ts`, change:

```ts
import { topDaily } from "./leaderboard-core.ts";
```

to:

```ts
import { topDaily, fullDaily } from "./leaderboard-core.ts";
```

- [ ] **Step 2: Branch the handler on `?full=1` (lean: duration but no grid)**

In `src/room.ts`, replace the `/leaderboard` handler (the version from Task A4) with:

```ts
    if (req.method === "GET" && url.pathname.endsWith("/leaderboard")) {
      const username = (url.searchParams.get("username") ?? "").toLowerCase().trim();
      const full = url.searchParams.get("full") === "1";
      const durationOf = (p: PlayerState) =>
        p.firstGuessAt != null && p.finishedAt != null
          ? Math.max(0, p.finishedAt - p.firstGuessAt)
          : undefined;
      if (full) {
        // Lean roster: every ranked player with duration, but NO grid (scales to hundreds).
        const players = this.state.players.map((p) => ({
          username: p.username,
          guessCount: p.guesses.length,
          won: p.status === "won",
          resigned: p.resigned,
          isBot: p.isBot,
          goldAwarded: p.goldAwarded,
          durationMs: durationOf(p),
        }));
        return Response.json(fullDaily(players, username));
      }
      const n = Number(url.searchParams.get("n") ?? "3");
      const players = this.state.players.map((p) => ({
        username: p.username,
        guessCount: p.guesses.length,
        won: p.status === "won",
        resigned: p.resigned,
        isBot: p.isBot,
        goldAwarded: p.goldAwarded,
        grid: encodeSolveGrid(p.guesses),
        durationMs: durationOf(p),
      }));
      return Response.json(topDaily(players, username, n));
    }
```

- [ ] **Step 3: Forward `full=1` in the worker route**

In `src/worker.ts`, replace:

```ts
    if (dailyLb && req.method === "GET") {
      const date = dailyLb[1];
      const u = normalizeUsername(url.searchParams.get("username") ?? "");
      const stub = env.ROOM.get(env.ROOM.idFromName(`daily/${date}`));
      return stub.fetch(new Request(
        `https://do/leaderboard?username=${encodeURIComponent(u)}&n=3`,
        { method: "GET" },
      ));
    }
```

with:

```ts
    if (dailyLb && req.method === "GET") {
      const date = dailyLb[1];
      const u = normalizeUsername(url.searchParams.get("username") ?? "");
      const full = url.searchParams.get("full") === "1";
      const stub = env.ROOM.get(env.ROOM.idFromName(`daily/${date}`));
      return stub.fetch(new Request(
        `https://do/leaderboard?username=${encodeURIComponent(u)}&${full ? "full=1" : "n=3"}`,
        { method: "GET" },
      ));
    }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts src/worker.ts
git commit -m "feat(daily): /leaderboard?full=1 serves the complete ranked roster"
```

---

## Phase D — Frontend: full roster on the stats page (v2)

### Task D1: Compute + render the roster (pure helper)

**Files:**
- Modify: `public/daily-stats.js`
- Test: `test/daily-stats.test.js` (only if it already imports from `daily-stats.js`; otherwise skip the test step — see note)

- [ ] **Step 1: Add a pure roster view-model**

Append to `public/daily-stats.js`:

```js
// Shape the full-roster API response ({ players:[{rank,username,gold,guesses,won,resigned,durationMs}], youRank, total })
// into rows ready to render, marking the viewer's own row. Pure — no DOM.
export function computeRosterView(full, me) {
  const players = (full && Array.isArray(full.players)) ? full.players : [];
  const rows = players.map((e) => ({
    rank: e.rank,
    username: e.username,
    gold: e.gold,
    guesses: e.guesses,
    won: !!e.won,
    durationMs: e.durationMs,
    isYou: e.username === me,
  }));
  return { rows, total: (full && typeof full.total === "number") ? full.total : rows.length };
}
```

- [ ] **Step 2: Add a unit test for `computeRosterView`**

`test/daily-stats.test.js` exists and already imports from `../public/daily-stats.js`.
Update its import line:

```js
import { computeDailyStatsView } from "../public/daily-stats.js";
```

to:

```js
import { computeDailyStatsView, computeRosterView } from "../public/daily-stats.js";
```

Then append a new describe block to the file:

```js
describe("computeRosterView", () => {
  it("marks the viewer row and preserves order", () => {
    const full = { players: [
      { rank: 1, username: "ava", gold: 1240, guesses: 2, won: true, durationMs: 95000 },
      { rank: 2, username: "me", gold: 540, guesses: 4, won: true, durationMs: 200000 },
    ], total: 2 };
    const v = computeRosterView(full, "me");
    expect(v.rows.map((r) => r.username)).toEqual(["ava", "me"]);
    expect(v.rows[1].isYou).toBe(true);
    expect(v.total).toBe(2);
  });

  it("handles an empty/absent roster", () => {
    expect(computeRosterView(null, "me")).toEqual({ rows: [], total: 0 });
  });
});
```

Run: `npm test -- daily-stats`
Expected: PASS (existing `computeDailyStatsView` tests + the two new `computeRosterView` tests).

- [ ] **Step 3: Commit**

```bash
git add public/daily-stats.js test/daily-stats.test.js
git commit -m "feat(stats): computeRosterView — pure view-model for the full roster"
```

---

### Task D2: Render the roster at the bottom of the stats page

**Files:**
- Modify: `public/app.js` — imports (~line 17), `showDailyStats` (~line 878), `renderDailyStatsBody` foot line (~line 933)

- [ ] **Step 1: Import the roster helpers**

In `public/app.js`, change:

```js
import { computeDailyStatsView } from "/daily-stats.js";
```

to:

```js
import { computeDailyStatsView, computeRosterView } from "/daily-stats.js";
import { fmtDuration, goldValue } from "/daily-card.js";
```

- [ ] **Step 2: Drop the dead "coming soon" placeholder (keep everything else)**

In `renderDailyStatsBody`, change the foot line:

```js
    <p class="daily-stats-foot muted small">Failed today: ${fmt(v.losses)} · Top-10 leaderboard coming soon.</p>`;
```

to:

```js
    <p class="daily-stats-foot muted small">Failed today: ${fmt(v.losses)}</p>
    <h2 class="daily-stats-sub">Players</h2>
    <div class="daily-roster" id="dailyRoster"><p class="muted small">Loading players…</p></div>`;
```

(All aggregate stats above this line are untouched.)

- [ ] **Step 3: Fetch + render the roster in `showDailyStats`**

In `showDailyStats`, find the end of the function:

```js
  if (parseRoute().kind !== "daily-stats") return; // navigated away mid-fetch
  renderDailyStatsBody(summary);
}
```

Replace with:

```js
  if (parseRoute().kind !== "daily-stats") return; // navigated away mid-fetch
  renderDailyStatsBody(summary);
  void renderDailyRoster(date);
}

// Append the full ranked roster (names, gold, guesses, duration) below the aggregates.
// Source is the Room DO leaderboard (public usernames) — NOT the anonymized SCIENCE feed.
async function renderDailyRoster(date) {
  const me = getUsername();
  let full = null;
  try {
    const res = await fetch(`/api/daily/${date}/leaderboard?full=1&username=${encodeURIComponent(me)}`);
    if (res.ok) full = await res.json();
  } catch (_) { /* offline / cold day — show the empty line */ }
  if (parseRoute().kind !== "daily-stats") return; // navigated away mid-fetch
  const host = $("#dailyRoster");
  if (!host) return;
  const view = computeRosterView(full, me);
  if (!view.rows.length) {
    host.innerHTML = `<p class="muted small">No finishers yet today.</p>`;
    return;
  }
  host.innerHTML = `<ul class="daily-roster-list">${view.rows.map((r) => {
    const u = String(r.username).replace(/[^a-z0-9_-]/gi, "");
    const dur = fmtDuration(r.durationMs);
    return `<li class="daily-roster-row${r.isYou ? " is-you" : ""}">
      <span class="daily-roster-rank">${r.rank}</span>
      <a class="daily-roster-name" href="/@${u}" data-profile="${u}">${r.isYou ? `you (@${u})` : `@${u}`}</a>
      <span class="daily-roster-gold">${goldValue(r.gold)}</span>
      <span class="daily-roster-guesses">${r.won ? `in ${r.guesses}` : "missed"}</span>
      ${dur ? `<span class="daily-roster-time">${dur}</span>` : `<span class="daily-roster-time"></span>`}
    </li>`;
  }).join("")}</ul>`;
  host.querySelectorAll("a[data-profile]").forEach((a) => {
    a.addEventListener("click", (e) => { e.preventDefault(); navigate("/@" + a.getAttribute("data-profile")); });
  });
}
```

- [ ] **Step 4: Verify the suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification**

With `npm run dev` running, via `/browse`:
1. Finish today's daily, then tap "Today's stats ›".
2. Confirm all existing aggregates (Played / Solved / Avg guesses / Avg score / guess
   distribution / Failed today) render unchanged.
3. Below them, a **Players** section lists every finisher: `rank · @name · gold · in N · duration`.
4. Your row is highlighted (`you (@name)`); tapping any `@name` opens that profile.
5. On a cold/empty day, the section shows "No finishers yet today."

Capture a screenshot for the PR.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(stats): full player roster at the bottom of Today's stats"
```

---

### Task D3: Styles for the roster list

**Files:**
- Modify: `public/style.css` (near the daily leaderboard styles)

- [ ] **Step 1: Add roster row styles (mirror the leaderboard row grid)**

In `public/style.css`, after the `.daily-top-*` block (~line 2736) add:

```css
/* Full player roster on the stats page — lean ranked list (rank · name · gold · in N · time). */
.daily-roster-list { list-style: none; margin: .25rem 0 0; padding: 0; display: grid; gap: .35rem; }
.daily-roster-row {
  display: grid;
  grid-template-columns: 1.75rem 1fr auto auto auto;
  align-items: center;
  gap: .6rem;
  padding: .4rem .6rem;
  border-radius: .6rem;
  background: var(--bg-card);
}
.daily-roster-row.is-you { outline: 1px solid var(--accent); }
.daily-roster-rank { font-variant-numeric: tabular-nums; color: var(--muted); font-size: .9em; text-align: center; }
.daily-roster-name { color: var(--fg); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.daily-roster-name:hover { text-decoration: underline; }
.daily-roster-gold { color: #f0c14b; font-variant-numeric: tabular-nums; display: inline-flex; align-items: center; justify-content: flex-end; font-weight: 600; }
.daily-roster-guesses, .daily-roster-time { color: var(--muted); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 2: Manual verification**

Via `/browse`, confirm the roster rows align cleanly (rank, name, gold, guesses, time)
and your row is highlighted. Check a narrow viewport — names ellipsize, no overflow.

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style(stats): roster list rows"
```

---

## Phase E — Final verification

### Task E1: Full suite + typecheck + ship readiness

- [ ] **Step 1: Run everything**

Run: `npm test && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 2: End-to-end manual pass (via `/browse` on `npm run dev`)**

Confirm the full story:
1. Play + finish the daily → featured card = your stamp with letters + `Solved in N · time`.
2. Tap each other leaderboard row → letterless card swaps in with their stats + time; row highlights.
3. Tap your row → back to your card. Tap any `@name` → profile, never a swap.
4. "Today's stats" → all old aggregates intact + a **Players** roster at the bottom with everyone's score + time; your row highlighted.

- [ ] **Step 3: Ship**

Run: `bash dev/ship.sh`
(This tests → rebases on `origin/main` → backup-tags prod → merges → lets CI deploy.
Never `wrangler deploy` by hand.)

---

## Self-review notes (for the implementer)

- **Answer-leak guard:** only the viewer's own card ever passes `solveWords` (letters);
  every other card and the whole roster carry `g/y/x` grids or no grid at all. The
  `full=1` payload has **no grid**. Do not add letters to any non-viewer path.
- **Source split:** the roster comes from the Room DO (`/leaderboard?full=1`), never the
  anonymized SCIENCE summary. The aggregates on the stats page stay exactly as they are.
- **Back-compat:** players persisted before Phase A lack the timestamps → `durationMs`
  undefined → the time chip is omitted (`fmtDuration(null) === ""`). No migration.
- **Type consistency:** `RankablePlayer`/`LeaderEntry` gain `grid?`+`durationMs?` (Task A3);
  `RosterEntry`/`FullLeaderboardView` + `fullDaily` (Task C1); `fmtDuration`/`goldValue`
  exported from `daily-card.js` (Task B1) and imported in `app.js` (Task D2);
  `computeRosterView` exported from `daily-stats.js` (Task D1).
