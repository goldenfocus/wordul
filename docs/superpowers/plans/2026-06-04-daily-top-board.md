# Daily "Today's Top" — Increment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After finishing the Wordul of the Day, the home's post-play recap shows the gold you won and a "Today's Top" leaderboard — top 3 by gold (with guess count), plus your own pinned rank — every name linking to its profile.

**Architecture:** A new pure module `src/leaderboard-core.ts` ranks the daily room's players. The daily `Room` DO exposes a read-only `GET /leaderboard`; the worker proxies it at `GET /api/daily/<date>/leaderboard`. The client (`daily-card.js` + `app.js` + `hub.js`) fetches it best-effort in the post-play state and renders the board, reusing the existing async-fill pattern (`fetchPlayed`).

**Tech Stack:** TypeScript + Cloudflare Workers/Durable Objects, vanilla JS frontend, vitest. No new deps.

**Scope:** Increment 1 only (leaderboard + your rank + gold in recap). Increment 2 (expandable "where gold was won/lost") is independent and additive — it gets its own plan after this ships. See `docs/superpowers/specs/2026-06-04-daily-top-board-design.md`.

**Worktree / deploy:** Work happens in the `daily-top-board` worktree off `origin/main`. Ship via `bash dev/ship.sh` (tests → rebase → backup tag → merge → CI deploys). Never hand-deploy.

---

## File Structure

- **Create** `src/leaderboard-core.ts` — pure ranking: `topDaily(players, username, n) → LeaderboardView`. No Cloudflare deps.
- **Create** `test/leaderboard-core.test.ts` — vitest unit tests for `topDaily`.
- **Modify** `src/room.ts` — add a `GET /leaderboard` branch to `Room.fetch`; import `topDaily`.
- **Modify** `src/worker.ts` — add the `GET /api/daily/<date>/leaderboard` route.
- **Modify** `public/daily-card.js` — post-play recap: gold span + `#dailyTop` container; `renderLeaderboard()`; fetch+inject in `wireDailyCard`.
- **Modify** `public/hub.js` — thread `fetchLeaderboard`, `onProfile`, `username` into `wireDailyCard`.
- **Modify** `public/app.js` — add `cbs.fetchLeaderboard` + `cbs.onProfile`.
- **Modify** `public/style.css` — `.daily-top` leaderboard styles.

---

## Task 1: Pure ranking module `leaderboard-core.ts`

**Files:**
- Create: `src/leaderboard-core.ts`
- Test: `test/leaderboard-core.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/leaderboard-core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { topDaily, type RankablePlayer } from "../src/leaderboard-core.ts";

// helper: a scored, finished human player
const p = (username: string, gold: number, guesses: number, won = true): RankablePlayer => ({
  username, guessCount: guesses, won, goldAwarded: gold,
});

describe("topDaily", () => {
  it("ranks by gold desc, then fewer guesses, then username", () => {
    const players = [p("bao", 980, 3), p("ava", 1240, 2), p("cy", 980, 2), p("dot", 980, 3)];
    const { top } = topDaily(players, "ava", 3);
    expect(top.map((e) => e.username)).toEqual(["ava", "cy", "bao"]);
    // bao vs dot tie on gold+guesses → username asc puts bao before dot (dot is 4th)
  });

  it("excludes bots and unscored (still-playing / failed-mint) players", () => {
    const players: RankablePlayer[] = [
      p("ava", 1240, 2),
      { username: "clanker", guessCount: 2, won: true, goldAwarded: 9999, isBot: true },
      { username: "still", guessCount: 1, won: false, goldAwarded: undefined },
    ];
    const { top, total } = topDaily(players, "ava", 3);
    expect(top.map((e) => e.username)).toEqual(["ava"]);
    expect(total).toBe(1);
  });

  it("returns you=null when the caller is inside the top N", () => {
    const players = [p("ava", 1240, 2), p("bao", 1090, 3), p("cy", 980, 3)];
    const view = topDaily(players, "bao", 3);
    expect(view.you).toBeNull();
    expect(view.top.find((e) => e.username === "bao")).toBeTruthy();
  });

  it("pins the caller with a 1-based rank when outside the top N", () => {
    const players = [
      p("ava", 1240, 2), p("bao", 1090, 3), p("cy", 980, 3),
      p("dot", 700, 4), p("me", 540, 4),
    ];
    const view = topDaily(players, "me", 3);
    expect(view.top).toHaveLength(3);
    expect(view.you).toEqual({ username: "me", gold: 540, guesses: 4, won: true, rank: 5 });
  });

  it("you=null when the caller has no scored row", () => {
    expect(topDaily([p("ava", 1240, 2)], "ghost", 3).you).toBeNull();
  });

  it("handles an empty board", () => {
    expect(topDaily([], "ava", 3)).toEqual({ top: [], you: null, total: 0 });
  });

  it("clamps n into [1,10] and defaults bad n to 3", () => {
    const players = [p("a", 5, 2), p("b", 4, 2), p("c", 3, 2), p("d", 2, 2)];
    expect(topDaily(players, "a", 0).top).toHaveLength(3);   // 0 → default 3
    expect(topDaily(players, "a", 99).top).toHaveLength(4);  // clamp ≤10, but only 4 exist
    expect(topDaily(players, "a", 2).top).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- leaderboard-core`
Expected: FAIL — `Cannot find module '../src/leaderboard-core.ts'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/leaderboard-core.ts`:

```ts
// src/leaderboard-core.ts — pure daily-leaderboard ranking (no Cloudflare deps,
// unit-tested). The daily Room DO already holds every player's gold + guesses in
// state.players; this turns that into a top-N board + the caller's own rank.

// Decoupled input shape: the Room maps its PlayerState[] into this so the module
// stays dependency-free. A player is RANKED iff they have a confirmed mint
// (goldAwarded is a number) and are not a bot.
export type RankablePlayer = {
  username: string;
  guessCount: number;
  won: boolean;
  isBot?: boolean;
  goldAwarded?: number | null;
};

export type LeaderEntry = { username: string; gold: number; guesses: number; won: boolean };
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

export function topDaily(players: RankablePlayer[], username: string, n: number): LeaderboardView {
  const ranked: LeaderEntry[] = (players ?? [])
    .filter((p) => p && !p.isBot && typeof p.goldAwarded === "number")
    .map((p) => ({ username: p.username, gold: p.goldAwarded as number, guesses: p.guessCount, won: p.won }))
    .sort((a, b) =>
      b.gold - a.gold ||
      a.guesses - b.guesses ||
      (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));

  const size = clampN(n);
  const top = ranked.slice(0, size);
  const meIdx = ranked.findIndex((e) => e.username === username);
  const you = meIdx >= size ? { ...ranked[meIdx], rank: meIdx + 1 } : null;
  return { top, you, total: ranked.length };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- leaderboard-core`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/leaderboard-core.ts test/leaderboard-core.test.ts
git commit -m "feat(daily): topDaily — pure daily leaderboard ranking + tests"
```

---

## Task 2: `Room` DO exposes `GET /leaderboard`

**Files:**
- Modify: `src/room.ts` (import near line 10; new branch in `fetch`, near line 134)

- [ ] **Step 1: Add the import**

In `src/room.ts`, find the economy import (line ~10):

```ts
import { pointsEarned, goldFromPoints, POINTS } from "./economy.ts";
```

Add directly below it:

```ts
import { topDaily } from "./leaderboard-core.ts";
```

- [ ] **Step 2: Add the read-only branch to `Room.fetch`**

In `src/room.ts`, locate the `fetch` method's `/ws` block ending and the trailing `return new Response("not found", { status: 404 });` (near line 159). Insert this branch **immediately before** that `return`:

```ts
    // Read-only daily leaderboard: top N by gold + the caller's own rank. No socket,
    // no mutation — just a sort over the players already persisted in state.
    if (req.method === "GET" && url.pathname.endsWith("/leaderboard")) {
      const username = (url.searchParams.get("username") ?? "").toLowerCase().trim();
      const n = Number(url.searchParams.get("n") ?? "3");
      const players = this.state.players.map((p) => ({
        username: p.username,
        guessCount: p.guesses.length,
        won: p.status === "won",
        isBot: p.isBot,
        goldAwarded: p.goldAwarded,
      }));
      return Response.json(topDaily(players, username, n));
    }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts
git commit -m "feat(daily): Room GET /leaderboard — read-only top-N + caller rank"
```

---

## Task 3: Worker route `GET /api/daily/<date>/leaderboard`

**Files:**
- Modify: `src/worker.ts` (after the `/api/user/` block, near line 71)

- [ ] **Step 1: Add the route**

In `src/worker.ts`, find the Profile JSON API block that ends near line 71:

```ts
    // Profile JSON API: /api/user/<name>
    if (url.pathname.startsWith("/api/user/")) {
      const name = normalizeUsername(decodeURIComponent(url.pathname.slice("/api/user/".length)));
      if (!isValidUsername(name)) return new Response("bad username", { status: 400 });
      const stub = env.USER.get(env.USER.idFromName(name));
      return stub.fetch(new Request(`https://do/?username=${name}`, { method: "GET" }));
    }
```

Insert directly below it:

```ts
    // Daily leaderboard JSON API: /api/daily/<YYYY-MM-DD>/leaderboard?username=<u>
    // Proxies to the day's single Room DO (keyed exactly like the /ws daily room).
    const dailyLb = url.pathname.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})\/leaderboard$/);
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

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke test against the dev server**

Run (terminal A): `npm run dev`
Run (terminal B), substituting today's UTC date:

```bash
curl -s "http://localhost:8787/api/daily/$(date -u +%F)/leaderboard?username=nobody" | cat
```

Expected: JSON `{"top":[...],"you":null,"total":N}` (an empty board `{"top":[],"you":null,"total":0}` is correct if nobody has finished today). A 404 means the route regex didn't match — recheck the path. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat(daily): /api/daily/<date>/leaderboard route -> day Room DO"
```

---

## Task 4: Client — render the board + gold in the post-play recap

**Files:**
- Modify: `public/daily-card.js`
- Modify: `public/hub.js` (`wireDaily`, near line 87)
- Modify: `public/app.js` (the `cbs` object, near line 230)

- [ ] **Step 1: `daily-card.js` — add the gold span + leaderboard container to the recap**

In `public/daily-card.js`, in `renderDailyCard`, the `if (result) { ... }` branch returns the post-play card. Replace the `daily-result` block and add a `#dailyTop` section. Change:

```js
      <div class="daily-result ${won ? "is-won" : "is-lost"}">
        <span class="daily-result-mark" aria-hidden="true">${won ? GLYPH.check : GLYPH.cross}</span>
        <span class="daily-result-text">${won ? `Solved in ${result.guesses}` : "Missed today"}</span>
      </div>
```

to:

```js
      <div class="daily-result ${won ? "is-won" : "is-lost"}">
        <span class="daily-result-mark" aria-hidden="true">${won ? GLYPH.check : GLYPH.cross}</span>
        <span class="daily-result-text">${won ? `Solved in ${result.guesses}` : "Missed today"}</span>
        <span class="daily-result-gold" id="dailyResultGold" hidden></span>
      </div>
      <section class="daily-top" id="dailyTop" hidden aria-label="Today's top players"></section>
```

- [ ] **Step 2: `daily-card.js` — add the pure `renderLeaderboard` + `escapeHtml` helpers**

In `public/daily-card.js`, add near the top (after the imports) these module-level helpers:

```js
const MEDALS = ["🥇", "🥈", "🥉"];
function escAttr(s) { return String(s).replace(/[^a-z0-9_-]/gi, ""); } // usernames are [a-z0-9_-]
function fmtGold(n) { return `${Number(n).toLocaleString()}g`; }

// Build the leaderboard HTML from a LeaderboardView ({ top, you, total }) and the
// viewer's own username. Top-3 medal rows; your medal row gets .is-you; if you're
// outside the top, a pinned row with your real rank — always shown ("celebrate you").
function renderLeaderboard(view, me) {
  if (!view || !Array.isArray(view.top) || view.top.length === 0) return "";
  const row = (entry, rank, opts = {}) => {
    const u = escAttr(entry.username);
    const badge = opts.pinned ? `#${rank}` : (MEDALS[rank - 1] ?? `#${rank}`);
    const mine = u === escAttr(me);
    const label = mine ? `you (@${u})` : `@${u}`;
    return `<li class="daily-top-row${mine ? " is-you" : ""}${opts.pinned ? " is-pinned" : ""}">
      <span class="daily-top-rank" aria-hidden="true">${badge}</span>
      <a class="daily-top-name" href="/@${u}" data-profile="${u}">${label}</a>
      <span class="daily-top-gold">${fmtGold(entry.gold)}</span>
      <span class="daily-top-guesses">in ${entry.guesses}</span>
    </li>`;
  };
  const medals = view.top.map((e, i) => row(e, i + 1)).join("");
  const pinned = view.you ? `<li class="daily-top-sep" aria-hidden="true"></li>${row(view.you, view.you.rank, { pinned: true })}` : "";
  return `<span class="section-label">Today's Top</span><ul class="daily-top-list">${medals}${pinned}</ul>`;
}
```

- [ ] **Step 3: `daily-card.js` — fetch + inject in `wireDailyCard`**

In `public/daily-card.js`, change the `wireDailyCard` signature to accept the new params, and in the post-play (`if (result)`) branch fetch the board and fill both the gold span and `#dailyTop`. Replace:

```js
export function wireDailyCard({ themeId, result, onPlay, onStats, onShareDaily, fetchPlayed }) {
  stopCountdown(); // never leave a stale timer running across re-renders

  const stats = document.getElementById("dailyStats");
  if (stats && onStats) stats.addEventListener("click", (e) => { e.stopPropagation(); onStats(); });

  // Post-play: result + countdown + share. No play surface (no replay teleport).
  if (result) {
    const share = document.getElementById("dailyShare");
    if (share && onShareDaily) share.addEventListener("click", () => onShareDaily());
    startCountdown();
    return { onType: () => {} };
  }
```

with:

```js
export function wireDailyCard({ themeId, result, username, onPlay, onStats, onShareDaily, onProfile, fetchPlayed, fetchLeaderboard }) {
  stopCountdown(); // never leave a stale timer running across re-renders

  const stats = document.getElementById("dailyStats");
  if (stats && onStats) stats.addEventListener("click", (e) => { e.stopPropagation(); onStats(); });

  // Post-play: result + gold + Today's Top + countdown + share. No play surface.
  if (result) {
    const share = document.getElementById("dailyShare");
    if (share && onShareDaily) share.addEventListener("click", () => onShareDaily());
    startCountdown();

    // Best-effort leaderboard: fills the gold line + the board once it resolves; a
    // failure or empty board just leaves them hidden (recap still renders).
    if (fetchLeaderboard && username) {
      fetchLeaderboard(username).then((view) => {
        if (!view) return;
        const mine = (view.you) ?? (view.top || []).find((e) => e.username === username);
        const goldEl = document.getElementById("dailyResultGold");
        if (goldEl && mine && typeof mine.gold === "number") {
          goldEl.textContent = ` · +${mine.gold.toLocaleString()} gold`;
          goldEl.hidden = false;
        }
        const board = document.getElementById("dailyTop");
        const html = renderLeaderboard(view, username);
        if (board && html) {
          board.innerHTML = html;
          board.hidden = false;
          if (onProfile) {
            board.querySelectorAll("a[data-profile]").forEach((a) => {
              a.addEventListener("click", (e) => { e.preventDefault(); onProfile(a.getAttribute("data-profile")); });
            });
          }
        }
      }).catch(() => {});
    }
    return { onType: () => {} };
  }
```

- [ ] **Step 4: `hub.js` — thread the new params into `wireDailyCard`**

In `public/hub.js`, in `wireDaily()`, update the `wireDailyCard({...})` call (near line 87) to pass the viewer + the two new callbacks:

```js
  const { onType } = wireDailyCard({
    themeId: themeOfDay(),
    result: hubCallbacks.dailyResult ?? null,
    username: hubCallbacks.username,
    onPlay: hubCallbacks.onPlay,
    onStats: hubCallbacks.onStats,
    onShareDaily: hubCallbacks.onShareDaily,
    onProfile: hubCallbacks.onProfile,
    fetchPlayed: hubCallbacks.fetchPlayed,
    fetchLeaderboard: hubCallbacks.fetchLeaderboard,
  });
```

- [ ] **Step 5: `app.js` — add the `onProfile` + `fetchLeaderboard` callbacks**

In `public/app.js`, in the `cbs = { ... }` object (near line 230), add these two entries (place them next to `onStats` / `fetchPlayed`):

```js
      onProfile: (name) => navigate("/@" + name),
      fetchLeaderboard: (username) =>
        fetch(`/api/daily/${todayUTC()}/leaderboard?username=${encodeURIComponent(username)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
```

- [ ] **Step 6: Typecheck (JS is unchecked, but keep TS green)**

Run: `npm run typecheck`
Expected: no errors (no TS files changed in this task, but confirm nothing else broke).

- [ ] **Step 7: Commit**

```bash
git add public/daily-card.js public/hub.js public/app.js
git commit -m "feat(daily): home post-play — Today's Top board + gold in recap"
```

---

## Task 5: Leaderboard styles

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add the styles**

Append to `public/style.css`. These use the project's existing tokens (defined in `:root` near line 4): `--accent: #9d8bff`, `--fg`, `--muted`, `--bg-card`. `.section-label` already exists (line ~2234) and is reused as-is.

```css
/* Daily post-play: gold won + Today's Top leaderboard */
.daily-result-gold { color: var(--accent); font-weight: 600; }

.daily-top { margin-top: 1rem; }
.daily-top .section-label { display: block; margin-bottom: .5rem; }
.daily-top-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
.daily-top-row {
  display: grid;
  grid-template-columns: 1.75rem 1fr auto auto;
  align-items: center;
  gap: .6rem;
  padding: .4rem .6rem;
  border-radius: .6rem;
  background: var(--bg-card);
}
.daily-top-row.is-you { outline: 1px solid var(--accent); }
.daily-top-rank { text-align: center; font-variant-numeric: tabular-nums; }
.daily-top-name { color: var(--fg); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.daily-top-name:hover { text-decoration: underline; }
.daily-top-gold { color: var(--accent); font-variant-numeric: tabular-nums; }
.daily-top-guesses { color: var(--muted); font-variant-numeric: tabular-nums; }
.daily-top-sep { height: 1px; margin: .25rem 0; background: var(--muted); opacity: .25; }
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "style(daily): Today's Top leaderboard rows"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Seed a finish and view the board**

In the browser at `http://localhost:8787/`:
1. Set a username, open today's daily, and solve (or exhaust guesses on) the word.
2. Return to the home (it should show the post-play recap).

Expected:
- The recap reads `Solved in N · +<gold> gold`.
- A `Today's Top` list appears with at least your own row.
- Your name links to `/@<you>`; clicking it navigates to the profile without a full reload.

- [ ] **Step 3: Confirm the rank-pin path (optional, if you can seed >3 finishers)**

With 4+ finishers where you are not top 3, confirm the top 3 medal rows render and your own row is pinned below the separator with your real `#rank`.

- [ ] **Step 4: Confirm graceful degradation**

Temporarily point `fetchLeaderboard` at a bad path (or stop the worker mid-load) and confirm the recap still renders with no `Today's Top` section and no console error thrown from the card.

- [ ] **Step 5: Full suite + typecheck before shipping**

Run: `npm test && npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Ship**

Run: `bash dev/ship.sh`
Expected: tests pass → rebase on `origin/main` → backup tag → merge → CI deploys. If the push is rejected (another tab shipped first), just re-run `bash dev/ship.sh`.

---

## Notes for the implementer

- **Username casing:** players are stored lowercase (`isValidUsername` is `[a-z0-9_-]`), and the worker lowercases the query param via `normalizeUsername`, so exact-string matching in `topDaily` is correct. If you ever see a non-matching `you`, check that `state.players[].username` is lowercase.
- **No spoilers:** the board renders only in the post-play state (`result != null`), so a non-player never sees it. Don't move it into the play-invitation branch.
- **Best-effort everywhere on the client:** every leaderboard fetch is wrapped so a failure degrades to "no board," never a thrown error or a broken recap. Keep it that way.
- **Don't touch the gold mint or the points formula** — Increment 1 only reads what's already minted.
