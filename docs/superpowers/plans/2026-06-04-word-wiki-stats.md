# Per-Word Live Stats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live per-word solve stats ("answered N× · avg 3.8 guesses · 71% solved") on each word-wiki page, accumulated from real games.

**Architecture:** A new `WordStats` Durable Object, one instance per word (`env.WORDSTATS.idFromName(WORD)`), naturally sharded like the existing `User` DO. At game-finish, `room.ts` fans out each finished player's `(result, guesses)` to the word's DO — alongside the existing per-user fan-out. The worker exposes `/api/word/<word>/stats`; the static page's `word-page.js` fetches it and fills the panel, with a graceful "be the first" state for never-played words.

**Tech Stack:** Cloudflare Durable Objects (SQLite-backed), TypeScript, vitest (node env) for the pure aggregation logic.

**Prerequisite:** `2026-06-04-word-wiki-pages.md` is implemented (pages exist with a `.wp-stats` panel + `public/word-page.js` hydration stub).

**Spec:** `docs/superpowers/specs/2026-06-01-word-wiki-design.md`

---

## File Structure

- `src/wordstats.ts` — pure: `emptyWordStats`, `applyWordGame`, `deriveWordStats`. (NEW)
- `src/wordstats-do.ts` — the `WordStats` Durable Object. (NEW)
- `src/types.ts` — add `WORDSTATS` to `Env`; add `WordStatsState` / `WordStatsView` types. (MODIFY)
- `src/worker.ts` — export `WordStats`; route `/api/word/<word>/stats`. (MODIFY)
- `src/room.ts` — fan out finished games to the word's `WordStats` DO in `finishGame()`. (MODIFY)
- `wrangler.jsonc` — `WORDSTATS` DO binding + `v3` migration (`new_sqlite_classes`). (MODIFY)
- `public/word-page.js` — replace the stub with real hydration. (MODIFY)
- Tests: `test/wordstats.test.ts`. (NEW)

---

## Phase 1 — Pure aggregation

### Task 1: `wordstats.ts` — pure per-word tally

**Files:**
- Create: `src/wordstats.ts`
- Test: `test/wordstats.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/wordstats.test.ts
import { describe, it, expect } from "vitest";
import { emptyWordStats, applyWordGame, deriveWordStats } from "../src/wordstats.ts";

describe("word stats", () => {
  it("counts answered, wins and guess distribution", () => {
    let s = emptyWordStats();
    s = applyWordGame(s, { result: "won", guesses: 3 });
    s = applyWordGame(s, { result: "won", guesses: 4 });
    s = applyWordGame(s, { result: "lost", guesses: 6 });
    expect(s.answered).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.guessDistribution).toEqual({ 3: 1, 4: 1 });
  });
  it("derives solve rate and average guesses (wins only)", () => {
    let s = emptyWordStats();
    s = applyWordGame(s, { result: "won", guesses: 2 });
    s = applyWordGame(s, { result: "won", guesses: 4 });
    s = applyWordGame(s, { result: "lost", guesses: 6 });
    const v = deriveWordStats(s);
    expect(v.answered).toBe(3);
    expect(v.solveRate).toBeCloseTo(2 / 3);
    expect(v.avgGuesses).toBeCloseTo(3); // (2+4)/2
  });
  it("never-played derives to neverPlayed", () => {
    const v = deriveWordStats(emptyWordStats());
    expect(v.neverPlayed).toBe(true);
    expect(v.avgGuesses).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm test -- wordstats` → Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implement `src/wordstats.ts`**

```ts
// src/wordstats.ts — pure per-word aggregation (no Cloudflare deps), mirroring stats.ts.
import type { GameOutcome } from "./stats.ts";

export type WordStatsState = {
  answered: number;
  wins: number;
  guessSum: number; // sum of guesses across WINS only (for average)
  guessDistribution: Record<number, number>;
};

export type WordStatsView = {
  answered: number;
  solveRate: number;       // 0..1
  avgGuesses: number | null;
  guessDistribution: Record<number, number>;
  neverPlayed: boolean;
};

export function emptyWordStats(): WordStatsState {
  return { answered: 0, wins: 0, guessSum: 0, guessDistribution: {} };
}

export function applyWordGame(s: WordStatsState, game: { result: GameOutcome; guesses: number }): WordStatsState {
  const next: WordStatsState = { ...s, guessDistribution: { ...s.guessDistribution } };
  next.answered += 1;
  if (game.result === "won") {
    next.wins += 1;
    next.guessSum += game.guesses;
    next.guessDistribution[game.guesses] = (next.guessDistribution[game.guesses] ?? 0) + 1;
  }
  return next;
}

export function deriveWordStats(s: WordStatsState): WordStatsView {
  return {
    answered: s.answered,
    solveRate: s.answered ? s.wins / s.answered : 0,
    avgGuesses: s.wins ? s.guessSum / s.wins : null,
    guessDistribution: s.guessDistribution,
    neverPlayed: s.answered === 0,
  };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npm test -- wordstats` → Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/wordstats.ts test/wordstats.test.ts
git commit -m "feat(wiki): pure per-word stats aggregation"
```

---

## Phase 2 — The Durable Object

### Task 2: `WordStats` DO + Env wiring + migration

**Files:**
- Create: `src/wordstats-do.ts`
- Modify: `src/types.ts`
- Modify: `wrangler.jsonc`
- Modify: `src/worker.ts` (export)

- [ ] **Step 1: Add `WORDSTATS` to `Env` and the view type re-export in `src/types.ts`**

In the `Env` interface, after `USER`:

```ts
  WORDSTATS: DurableObjectNamespace;
```

- [ ] **Step 2: Implement `src/wordstats-do.ts` (mirrors `User`)**

```ts
// src/wordstats-do.ts — one Durable Object per answer word; holds cumulative solve stats.
// Sharded by word via env.WORDSTATS.idFromName(WORD). Read with GET, bump with POST /bump.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import { emptyWordStats, applyWordGame, deriveWordStats, type WordStatsState } from "./wordstats.ts";
import type { GameOutcome } from "./stats.ts";

export class WordStats extends DurableObject<Env> {
  private async load(): Promise<WordStatsState> {
    return (await this.ctx.storage.get<WordStatsState>("state")) ?? emptyWordStats();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET") {
      return Response.json(deriveWordStats(await this.load()));
    }
    if (req.method === "POST" && url.pathname.endsWith("/bump")) {
      const game = (await req.json()) as { result: GameOutcome; guesses: number };
      const next = applyWordGame(await this.load(), game);
      await this.ctx.storage.put("state", next);
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }
}
```

- [ ] **Step 3: Export `WordStats` from `src/worker.ts`**

Update the imports/exports at the top:

```ts
import { WordStats } from "./wordstats-do.ts";
export { Room, User, WordStats };
```

- [ ] **Step 4: Add the DO binding + migration in `wrangler.jsonc`**

In `durable_objects.bindings`, add:

```jsonc
      { "name": "WORDSTATS", "class_name": "WordStats" }
```

In `migrations`, add a new entry (free plan requires new DOs be SQLite-backed, like `User` on v2):

```jsonc
    { "tag": "v3", "new_sqlite_classes": ["WordStats"] }
```

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck && git add src/wordstats-do.ts src/types.ts src/worker.ts wrangler.jsonc
git commit -m "feat(wiki): WordStats durable object + v3 migration"
```

---

## Phase 3 — Wire game-finish + read endpoint

### Task 3: Fan out finished games to `WordStats`

**Files:**
- Modify: `src/room.ts` (`finishGame()`, ~lines 531-572)

- [ ] **Step 1: Add the per-word fan-out inside `finishGame()`**

In `finishGame()`, after the existing `await Promise.allSettled(...)` that reports to each player's `User` DO, add a second fan-out keyed by the round's word. Bots should not count toward public stats:

```ts
    // Also accumulate public, per-word solve stats (one DO per word, sharded by name).
    // Skip bots — only real players move a word's public stats. Best-effort.
    const word = (this.state.word ?? "").toUpperCase();
    if (word) {
      const humans = this.state.players.filter((p) => !p.isBot);
      await Promise.allSettled(
        humans.map((p) =>
          this.env.WORDSTATS.get(this.env.WORDSTATS.idFromName(word))
            .fetch("https://do/bump", {
              method: "POST",
              body: JSON.stringify({ result: p.status === "won" ? "won" : "lost", guesses: p.guesses.length }),
            })
            .catch((e) => console.error("wordstats bump failed", word, (e as Error).message)),
        ),
      );
    }
```

Note: each instance is single-threaded, so the per-word `humans` bumps for one game serialize correctly against that word's DO. (Different words hit different DO instances — no contention.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 3: Confirm existing room tests still pass**

Run: `npm test -- room roomgame records` → Expected: PASS (the fan-out is best-effort and additive; no existing assertion changes).

- [ ] **Step 4: Commit**

```bash
git add src/room.ts
git commit -m "feat(wiki): record per-word solve stats on game finish"
```

### Task 4: `/api/word/<word>/stats` read endpoint

**Files:**
- Modify: `src/worker.ts`

- [ ] **Step 1: Add the route (near the other `/api/` handler)**

After the existing `/api/user/` block in `fetch`:

```ts
    if (url.pathname.startsWith("/api/word/") && url.pathname.endsWith("/stats")) {
      const word = decodeURIComponent(
        url.pathname.slice("/api/word/".length, -"/stats".length),
      ).toUpperCase();
      if (!isWordPage(word)) return new Response("not found", { status: 404 });
      const res = await env.WORDSTATS.get(env.WORDSTATS.idFromName(word)).fetch("https://do/");
      return new Response(res.body, {
        status: res.status,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
      });
    }
```

(`isWordPage` is already imported by the pages plan; if implementing standalone, add `import { isWordPage } from "./words.ts";`.)

- [ ] **Step 2: Manual verify**

Run: `npm run dev`, then `curl -s http://localhost:8787/api/word/ocean/stats`
Expected: JSON like `{"answered":0,"solveRate":0,"avgGuesses":null,"guessDistribution":{},"neverPlayed":true}`.

- [ ] **Step 3: Commit**

```bash
git add src/worker.ts
git commit -m "feat(wiki): per-word stats read endpoint"
```

---

## Phase 4 — Client hydration

### Task 5: Hydrate the stats panel

**Files:**
- Modify: `public/word-page.js`

- [ ] **Step 1: Replace the stub body with real hydration**

```js
// public/word-page.js — hydrates the live stats panel on a word page.
(function () {
  const panel = document.querySelector(".wp-stats");
  if (!panel) return;
  const word = (panel.dataset.word || "").toLowerCase();
  const body = panel.querySelector(".wp-stats-body");
  if (!word || !body) return;

  fetch(`/api/word/${encodeURIComponent(word)}/stats`)
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (!s || s.neverPlayed) return; // keep the baked-in "Be the first to solve it."
      const pct = Math.round(s.solveRate * 100);
      const avg = s.avgGuesses != null ? s.avgGuesses.toFixed(1) : "—";
      const times = s.answered === 1 ? "once" : `${s.answered.toLocaleString()} times`;
      body.textContent = `Played ${times} · ${pct}% solved · ${avg} guesses on average.`;
    })
    .catch(() => { /* leave the placeholder on any error */ });
})();
```

- [ ] **Step 2: Manual verify**

Run: `npm run dev`. Open `/word/ocean` — with no plays it still shows "Be the first to solve it." Play a real (non-bot) game whose answer is a known word, then reload that word's page and confirm the line updates to the played/solved/average summary.

- [ ] **Step 3: Commit**

```bash
git add public/word-page.js
git commit -m "feat(wiki): hydrate live per-word solve stats"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** per-word `WordStats` DO sharded by name (T2); bumped at finish alongside the existing `User` fan-out (T3); read endpoint `/api/word/<w>/stats` (T4); client hydration with never-played fallback (T5); `v3` `new_sqlite_classes` migration (T2). Recurring answers accumulate by word (DO keyed by word, not date) ✓. Bots excluded from public stats (T3) — a deliberate refinement of the spec's "be the first" intent.
- **Placeholder scan:** none — every step has complete code.
- **Type/name consistency:** `WordStatsState`/`WordStatsView`/`emptyWordStats`/`applyWordGame`/`deriveWordStats` consistent across `src/wordstats.ts`, `src/wordstats-do.ts`, and the test; DO binding `WORDSTATS` + class `WordStats` consistent across `types.ts`, `wrangler.jsonc`, `worker.ts`, `room.ts`; `/bump` and GET paths match between the DO (T2) and its callers (T3/T4); the `.wp-stats` / `.wp-stats-body` / `data-word` selectors match what the pages plan renders in `renderWordPage`.

---

## Risks / notes for the executor

- **Write volume:** one `WordStats.fetch` per human player per finished game. Fine at current scale; if it ever grows, batch the per-word bumps. Different words never contend (separate DO instances).
- **Idempotency:** `finishGame()` already runs once per finish transition (guarded by the existing finish flow), so each game bumps each word once. Don't call it from `onRematch`/restart paths.
- **Migration ordering:** `v3` must follow `v2` in `wrangler.jsonc`; deploy applies it. New SQLite-backed DO — matches the free-plan constraint noted for `User`.
- **Cache:** the read endpoint sets `max-age=300`, so freshly-recorded stats can lag up to 5 min on a word page. Acceptable; lower it if you want snappier updates.
