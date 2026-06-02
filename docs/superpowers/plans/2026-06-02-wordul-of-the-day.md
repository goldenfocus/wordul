# Wordul of the Day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `wordul.com/` *be* today's globally-shared Wordul — a themed, async, one-shot daily puzzle that rolls over at 00:00 UTC, gates its rewards (leaderboard, chat, story, goody) behind completion, drops a free-gold goody + "why this word" note on finish, bridges into live play, and leaves an eternal SEO permalink for every day.

**Architecture:** A new system-singleton `Daily` Durable Object (mirroring the existing `Challenge` DO) owns a `date → World` schedule plus a deterministic FNV-1a fallback. A "day" is a normal `Room` DO addressed `daily/<YYYY-MM-DD>` that self-seeds its word/edition/story from `Daily` on first contact, runs in an `isDaily` async-one-shot mode (no host start, no resets, one scored attempt per username, per-player completion), and reuses the existing board/chat/scoreboard/gold. The worker injects per-day SEO (meta + JSON-LD + story prose + prev/next) and exposes `/`, `/daily/<date>`, `/daily/archive`, and an admin `POST /daily/schedule` (Bearer token). The client makes `/` render the daily, hard-gates the "underneath" on `me.status !== "playing"`, and surfaces the goody + a "play live" bridge.

**Tech Stack:** Cloudflare Workers + Durable Objects (KV-style `ctx.storage` on `new_sqlite_classes`), TypeScript (strict, `.ts` ESM imports), vitest (node env, pure-module unit tests, `/`-aliased frontend imports), vanilla-JS SPA (`public/app.js`), HTMLRewriter for SEO injection.

**Spec:** `docs/superpowers/specs/2026-06-02-wordul-of-the-day-design.md`

**Conventions to honor (from the codebase):**
- Pure logic → modules with NO `cloudflare:workers` import (so vitest/node can test them). DO/worker/frontend glue is typecheck + manual-smoke verified — there are deliberately no DO/worker unit tests in this repo.
- DO storage is a single JSON blob: `ctx.storage.get("state")` / `put("state", …)`.
- New DO namespaces on the free plan MUST use `new_sqlite_classes` (else deploy err 10097; dry-run won't catch it). Existing tags: v1 Room (`new_classes`), v2 User, v3 Challenge → **next tag is v4**.
- Test files: `test/<name>.test.ts`, imports like `import { x } from "../src/x.ts"`.
- Commands: `npm test` (vitest run), `npx vitest run test/<f>.test.ts` (one file), `npm run typecheck` (`tsc --noEmit`), `npm run dev` (wrangler dev, manual smoke).

---

## File Structure

**Create:**
- `src/daily-core.ts` — pure: `World` type, `DailySchedule`, `activeDate`, `fnv1a`, `fallbackWord`, `houseWorld`, `resolveWorld`, `normalizeWorld`. No Cloudflare import.
- `src/daily-seo.ts` — pure: `isValidDateString`, `dailyDateFromPathname`, `dailyPrevNext`, `buildDailyMeta`, `buildDailyJsonLd`, `dailySitemapUrls`. No Cloudflare import.
- `src/daily.ts` — the `Daily` Durable Object (thin; imports `cloudflare:workers` + `daily-core`). Mirrors `src/challenge.ts`.
- `test/daily-core.test.ts`, `test/daily-seo.test.ts` — unit tests for the two pure modules.
- `public/llms.txt` — AI-discoverability doc mentioning the daily.

**Modify:**
- `wrangler.jsonc` — add `DAILY` binding + v4 `new_sqlite_classes` migration.
- `src/types.ts` — `Env.DAILY`, `Env.DAILY_ADMIN_TOKEN`; `RoomSnapshot.isDaily/story/voice`; `PlayerState.scored`.
- `src/worker.ts` — export `Daily`; add daily routes, `injectDailyMeta`, admin schedule route, daily sitemap entries.
- `src/room.ts` — daily self-seed, `isDaily` locks, per-player completion (`afterPlayerStatus` + `scorePlayer`), daily goody gold, constructor backfill.
- `public/index.html` — `data-daily-*` SEO placeholders; `#dailyUnlock` panel + day title in `tpl-room`.
- `public/app.js` — `parseRoute`/`route` daily+play routing, `showDaily`/`showDailyEntry`, hard-gate in `render()`, `showHome` → `/play`, unlock UI.
- `public/locales/en.js` — `daily.*` strings.

---

## Phase A — Daily core (pure, TDD)

### Task 1: `World` type + `activeDate` (UTC date)

**Files:**
- Create: `src/daily-core.ts`
- Test: `test/daily-core.test.ts`

- [ ] **Step 1: Write the failing test**

`test/daily-core.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { activeDate } from "../src/daily-core.ts";

describe("activeDate", () => {
  it("returns the UTC YYYY-MM-DD for an instant", () => {
    // 2026-06-02T12:00:00Z
    expect(activeDate(Date.UTC(2026, 5, 2, 12, 0, 0))).toBe("2026-06-02");
  });

  it("rolls over exactly at 00:00:00 UTC, not before", () => {
    expect(activeDate(Date.UTC(2026, 5, 2, 23, 59, 59))).toBe("2026-06-02");
    expect(activeDate(Date.UTC(2026, 5, 3, 0, 0, 0))).toBe("2026-06-03");
  });

  it("zero-pads month and day", () => {
    expect(activeDate(Date.UTC(2026, 0, 9, 5, 0, 0))).toBe("2026-01-09");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts`
Expected: FAIL — `activeDate` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

`src/daily-core.ts`:
```ts
// src/daily-core.ts — pure, dependency-free daily logic (unit-tested). No Cloudflare deps.
import { WORDS_BY_SIZE } from "./wordsbysize.ts";

export interface World {
  date: string;            // "2026-06-02" — UTC day it belongs to
  word: string;            // main answer (UPPERCASE)
  bonusWord?: string;      // RESERVED (#2): hidden word to discover; no behavior yet
  edition: string;         // design skin id (e.g. "yang", "default")
  voice: string;           // companion voice id (e.g. "yang")
  story: { title: string; body: string; tip?: string };
  curator?: { username: string; message: string }; // RESERVED (#4)
  createdAt: number;       // epoch ms
}

export type DailySchedule = Record<string, World>;

/** UTC calendar date string "YYYY-MM-DD" for an instant (rolls at 00:00:00 UTC). */
export function activeDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): World type + UTC activeDate (pure core)"
```

### Task 2: FNV-1a hash + deterministic `fallbackWord`

**Files:**
- Modify: `src/daily-core.ts`
- Test: `test/daily-core.test.ts`

- [ ] **Step 1: Write the failing test** (append to `test/daily-core.test.ts`)

```ts
import { fnv1a, fallbackWord } from "../src/daily-core.ts";

describe("fnv1a", () => {
  it("is a stable 32-bit unsigned integer for a string", () => {
    const h = fnv1a("2026-06-02");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(fnv1a("2026-06-02")).toBe(h); // deterministic
  });
  it("differs for different inputs", () => {
    expect(fnv1a("2026-06-02")).not.toBe(fnv1a("2026-06-03"));
  });
});

describe("fallbackWord", () => {
  const pool = ["ALPHA", "BRAVO", "CRANE", "DELTA", "EAGLE"];
  it("is deterministic per date and always in the pool", () => {
    const w = fallbackWord("2026-06-02", pool);
    expect(pool).toContain(w);
    expect(fallbackWord("2026-06-02", pool)).toBe(w);
  });
  it("varies across dates (spread over a month of dates)", () => {
    const picks = new Set(
      Array.from({ length: 28 }, (_, i) =>
        fallbackWord(`2026-06-${String(i + 1).padStart(2, "0")}`, pool)),
    );
    expect(picks.size).toBeGreaterThan(1);
  });
  it("falls back to the first word when the pool is empty", () => {
    expect(fallbackWord("2026-06-02", [])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts`
Expected: FAIL — `fnv1a` / `fallbackWord` not defined.

- [ ] **Step 3: Write minimal implementation** (append to `src/daily-core.ts`)

```ts
/** FNV-1a 32-bit hash → unsigned int. Deterministic, dependency-free. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts; >>> 0 keeps it unsigned 32-bit.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic pick from an answer pool, seeded by the date string. */
export function fallbackWord(date: string, answers: string[]): string {
  if (!answers || answers.length === 0) return "";
  return answers[fnv1a(date) % answers.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): FNV-1a + deterministic fallbackWord"
```

### Task 3: `houseWorld` + `resolveWorld` + `normalizeWorld`

**Files:**
- Modify: `src/daily-core.ts`
- Test: `test/daily-core.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { houseWorld, resolveWorld, normalizeWorld } from "../src/daily-core.ts";
import type { World } from "../src/daily-core.ts";

describe("houseWorld", () => {
  it("wraps the deterministic fallback word in a default-edition World", () => {
    const w = houseWorld("2026-06-02", 1_700_000_000_000);
    expect(w.date).toBe("2026-06-02");
    expect(w.word).toMatch(/^[A-Z]+$/);
    expect(w.word.length).toBe(5); // fallback uses the 5-letter pool
    expect(w.edition).toBe("default");
    expect(w.voice).toBe("yang");
    expect(typeof w.story.title).toBe("string");
    expect(typeof w.story.body).toBe("string");
    expect(houseWorld("2026-06-02", 1).word).toBe(w.word); // deterministic word
  });
});

describe("resolveWorld", () => {
  const curated: World = {
    date: "2026-06-02", word: "EMBER", edition: "yang", voice: "yang",
    story: { title: "Why EMBER?", body: "A small warmth that refuses to go out." },
    createdAt: 1,
  };
  it("returns the curated World when the date is scheduled", () => {
    expect(resolveWorld({ "2026-06-02": curated }, "2026-06-02", 99).word).toBe("EMBER");
  });
  it("falls back to a house World for an unscheduled date", () => {
    const w = resolveWorld({}, "2026-06-05", 99);
    expect(w.edition).toBe("default");
    expect(w.word.length).toBe(5);
  });
});

describe("normalizeWorld", () => {
  it("accepts a valid payload and uppercases the word", () => {
    const w = normalizeWorld({
      date: "2026-06-02", word: "ember", edition: "yang", voice: "yang",
      story: { title: "t", body: "b" },
    });
    expect(w?.word).toBe("EMBER");
    expect(typeof w?.createdAt).toBe("number");
  });
  it("rejects garbage / missing fields", () => {
    expect(normalizeWorld(null)).toBeNull();
    expect(normalizeWorld({ word: "ember" })).toBeNull();               // no date
    expect(normalizeWorld({ date: "nope", word: "EMBER", story: {} })).toBeNull(); // bad date
    expect(normalizeWorld({ date: "2026-06-02", word: "EM3ER", story: { title: "t", body: "b" } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-core.test.ts`
Expected: FAIL — the three functions are not defined.

- [ ] **Step 3: Write minimal implementation** (append to `src/daily-core.ts`)

```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A generic "house" World for any unauthored date — deterministic fallback word. */
export function houseWorld(date: string, nowMs: number): World {
  const word = fallbackWord(date, WORDS_BY_SIZE[5]?.answers ?? []);
  return {
    date,
    word,
    edition: "default",
    voice: "yang",
    story: {
      title: `Today's word`,
      body: `No curator claimed ${date} — so the house drew a word. Play it, then come back: a curated day is coming.`,
    },
    createdAt: nowMs,
  };
}

/** Curated World for the date if scheduled, else the deterministic house World. */
export function resolveWorld(schedule: DailySchedule, date: string, nowMs: number): World {
  return schedule[date] ?? houseWorld(date, nowMs);
}

/** Validate + normalize an admin-supplied World payload. Returns null if invalid. */
export function normalizeWorld(input: unknown): World | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date : "";
  if (!DATE_RE.test(date)) return null;
  const word = typeof o.word === "string" ? o.word.toUpperCase().trim() : "";
  if (!/^[A-Z]+$/.test(word)) return null;
  const story = (o.story && typeof o.story === "object" ? o.story : {}) as Record<string, unknown>;
  if (typeof story.title !== "string" || typeof story.body !== "string") return null;
  const world: World = {
    date,
    word,
    edition: typeof o.edition === "string" && o.edition ? o.edition : "default",
    voice: typeof o.voice === "string" && o.voice ? o.voice : "yang",
    story: {
      title: story.title,
      body: story.body,
      ...(typeof story.tip === "string" ? { tip: story.tip } : {}),
    },
    createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
  };
  if (typeof o.bonusWord === "string" && /^[A-Za-z]+$/.test(o.bonusWord)) world.bonusWord = o.bonusWord.toUpperCase();
  if (o.curator && typeof o.curator === "object") {
    const c = o.curator as Record<string, unknown>;
    if (typeof c.username === "string" && typeof c.message === "string") {
      world.curator = { username: c.username, message: c.message };
    }
  }
  return world;
}
```

> Note: `normalizeWorld` calls `Date.now()` only as a fallback when `createdAt` is absent — fine in the DO. Tests always pass `createdAt`-free payloads through code paths that don't assert the exact value.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-core.test.ts`
Expected: PASS (all daily-core tests).

- [ ] **Step 5: Commit**

```bash
git add src/daily-core.ts test/daily-core.test.ts
git commit -m "feat(daily): houseWorld + resolveWorld + normalizeWorld"
```

---

## Phase B — Daily SEO/routing helpers (pure, TDD)

### Task 4: `isValidDateString` + `dailyDateFromPathname` + `dailyPrevNext`

**Files:**
- Create: `src/daily-seo.ts`
- Test: `test/daily-seo.test.ts`

- [ ] **Step 1: Write the failing test**

`test/daily-seo.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isValidDateString, dailyDateFromPathname, dailyPrevNext } from "../src/daily-seo.ts";

describe("isValidDateString", () => {
  it("accepts real calendar dates", () => {
    expect(isValidDateString("2026-06-02")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true); // leap day
  });
  it("rejects malformed or impossible dates", () => {
    expect(isValidDateString("2026-6-2")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("nope")).toBe(false);
  });
});

describe("dailyDateFromPathname", () => {
  it("extracts the date from /daily/<date>", () => {
    expect(dailyDateFromPathname("/daily/2026-06-02")).toBe("2026-06-02");
  });
  it("returns null for non-daily or invalid paths", () => {
    expect(dailyDateFromPathname("/daily/archive")).toBeNull();
    expect(dailyDateFromPathname("/daily/2026-02-30")).toBeNull();
    expect(dailyDateFromPathname("/@yan/room")).toBeNull();
  });
});

describe("dailyPrevNext", () => {
  it("computes adjacent UTC dates, including month + leap boundaries", () => {
    expect(dailyPrevNext("2026-06-02")).toEqual({ prev: "2026-06-01", next: "2026-06-03" });
    expect(dailyPrevNext("2026-03-01")).toEqual({ prev: "2026-02-28", next: "2026-03-02" });
    expect(dailyPrevNext("2024-02-28")).toEqual({ prev: "2024-02-27", next: "2024-02-29" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-seo.test.ts`
Expected: FAIL — module/functions not defined.

- [ ] **Step 3: Write minimal implementation**

`src/daily-seo.ts`:
```ts
// src/daily-seo.ts — pure, dependency-free daily SEO/routing helpers (unit-tested).
import type { World } from "./daily-core.ts";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict YYYY-MM-DD AND a real calendar date (round-trips through UTC). */
export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s ?? "");
  if (!m) return false;
  const [, y, mo, d] = m;
  const dt = new Date(`${s}T00:00:00Z`);
  return (
    !Number.isNaN(dt.getTime()) &&
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() + 1 === Number(mo) &&
    dt.getUTCDate() === Number(d)
  );
}

/** /daily/<valid-date> → date string; anything else → null. */
export function dailyDateFromPathname(pathname: string): string | null {
  const m = /^\/daily\/(\d{4}-\d{2}-\d{2})$/.exec(pathname ?? "");
  if (!m || !isValidDateString(m[1])) return null;
  return m[1];
}

/** Adjacent UTC dates for prev/next navigation + rel links. */
export function dailyPrevNext(date: string): { prev: string; next: string } {
  const base = Date.parse(`${date}T00:00:00Z`);
  const day = 86_400_000;
  return {
    prev: new Date(base - day).toISOString().slice(0, 10),
    next: new Date(base + day).toISOString().slice(0, 10),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-seo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daily-seo.ts test/daily-seo.test.ts
git commit -m "feat(daily): date validation + path + prev/next helpers (pure)"
```

### Task 5: `buildDailyMeta` + `buildDailyJsonLd` + `dailySitemapUrls`

**Files:**
- Modify: `src/daily-seo.ts`
- Test: `test/daily-seo.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { buildDailyMeta, buildDailyJsonLd, dailySitemapUrls } from "../src/daily-seo.ts";
import type { World } from "../src/daily-core.ts";

const world: World = {
  date: "2026-06-02", word: "EMBER", edition: "yang", voice: "yang",
  story: { title: "Why EMBER?", body: "A small warmth that refuses to go out." },
  createdAt: 1,
};

describe("buildDailyMeta", () => {
  it("builds title/description/canonical pointing at the dated permalink", () => {
    const m = buildDailyMeta("2026-06-02", world, "https://wordul.com");
    expect(m.title).toContain("Wordul of the Day");
    expect(m.title).toContain("June 2, 2026");
    expect(m.canonical).toBe("https://wordul.com/daily/2026-06-02");
    expect(m.description.length).toBeGreaterThan(0);
  });
});

describe("buildDailyJsonLd", () => {
  it("emits a schema.org graph with WebPage + Game and the story body", () => {
    const ld = buildDailyJsonLd("2026-06-02", world, "https://wordul.com") as any;
    expect(ld["@context"]).toBe("https://schema.org");
    const types = ld["@graph"].map((n: any) => n["@type"]);
    expect(types).toContain("WebPage");
    expect(types).toContain("Game");
    const page = ld["@graph"].find((n: any) => n["@type"] === "WebPage");
    expect(page.url).toBe("https://wordul.com/daily/2026-06-02");
  });
});

describe("dailySitemapUrls", () => {
  it("emits /, /daily/archive, and one URL per date", () => {
    const urls = dailySitemapUrls(["2026-06-02", "2026-06-01"], "https://wordul.com");
    expect(urls).toContain("https://wordul.com/");
    expect(urls).toContain("https://wordul.com/daily/archive");
    expect(urls).toContain("https://wordul.com/daily/2026-06-02");
    expect(urls).toContain("https://wordul.com/daily/2026-06-01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-seo.test.ts`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Write minimal implementation** (append to `src/daily-seo.ts`)

```ts
/** Human "June 2, 2026" from a YYYY-MM-DD (UTC, locale-stable). */
function prettyDate(date: string): string {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const [y, m, d] = date.split("-").map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}

export function buildDailyMeta(
  date: string,
  world: World,
  origin: string,
): { title: string; description: string; canonical: string } {
  const pretty = prettyDate(date);
  const firstLine = (world.story.body || "").split("\n")[0].slice(0, 150);
  return {
    title: `Wordul of the Day — ${pretty}`,
    description: world.story.title
      ? `${world.story.title} ${firstLine}`.trim().slice(0, 200)
      : `Play the Wordul of the Day for ${pretty}. One word, the whole world, free — no ads.`,
    canonical: `${origin}/daily/${date}`,
  };
}

export function buildDailyJsonLd(date: string, world: World, origin: string): object {
  const url = `${origin}/daily/${date}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        url,
        name: `Wordul of the Day — ${prettyDate(date)}`,
        description: world.story.body,
        datePublished: date,
        isPartOf: { "@type": "WebSite", name: "Wordul", url: origin },
      },
      {
        "@type": "Game",
        name: `Wordul of the Day — ${prettyDate(date)}`,
        url,
        gamePlatform: "Web browser",
        applicationCategory: "GameApplication",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ],
  };
}

/** Sitemap URLs for the daily surface: home, archive, and every known date. */
export function dailySitemapUrls(dates: string[], origin: string): string[] {
  const out = [`${origin}/`, `${origin}/daily/archive`];
  for (const d of dates) if (isValidDateString(d)) out.push(`${origin}/daily/${d}`);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-seo.test.ts`
Expected: PASS (all daily-seo tests).

- [ ] **Step 5: Commit**

```bash
git add src/daily-seo.ts test/daily-seo.test.ts
git commit -m "feat(daily): SEO meta + JSON-LD + sitemap helpers (pure)"
```

---

## Phase C — `Daily` Durable Object + config

### Task 6: Register `DAILY` DO (wrangler v4 + Env + export)

**Files:**
- Modify: `wrangler.jsonc:31-35` (bindings), `wrangler.jsonc:68-75` (migrations)
- Modify: `src/types.ts:20-26` (Env)
- Modify: `src/worker.ts:1-7` (import + export)

> ⚠️ **DO-migration scar:** the new namespace MUST be `new_sqlite_classes` (free plan; err 10097 otherwise — dry-run won't catch it). After deploy, verify it applied (see Rollout).

- [ ] **Step 1: Add the DAILY binding** — in `wrangler.jsonc`, inside `durable_objects.bindings`, after the `Challenge` entry (line 34):

```jsonc
      {
        "name": "DAILY",
        "class_name": "Daily"
      }
```

- [ ] **Step 2: Add the v4 migration** — in `wrangler.jsonc`, append to the `migrations` array (after the v3 block, before the closing `]` at line 75):

```jsonc
    ,{
      // New DO namespace on the free plan MUST be SQLite-backed (else deploy fails with
      // err 10097 — dry-run won't catch it). Daily uses the KV-style ctx.storage.get/put
      // API, which is supported on new_sqlite_classes.
      "tag": "v4",
      "new_sqlite_classes": ["Daily"]
    }
```

- [ ] **Step 3: Extend the Env interface** — replace `src/types.ts:20-26`:

```ts
export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  USER: DurableObjectNamespace;
  DAILY: DurableObjectNamespace;
  DIRECTORY: KVNamespace;
  DESIGNS: R2Bucket;
  DAILY_ADMIN_TOKEN?: string; // wrangler secret; gates POST /daily/schedule
}
```

- [ ] **Step 4: Import + export `Daily`, and add ALL daily imports at the top** — in `src/worker.ts` the existing imports are lines 1-6. ⚠️ ES-module imports MUST live at the top of the file — never mid-file. Add the new imports right after line 6 so the top of `src/worker.ts` reads:

```ts
import { Room } from "./room.ts";
import { User } from "./user.ts";
import { Challenge } from "./challenge.ts";
import { Daily } from "./daily.ts";
import { makeChallengeId } from "./challenge-core.ts";
import type { Env } from "./types.ts";
import { normalizeUsername, normalizeSlug, isValidUsername } from "./identity.ts";
import { activeDate } from "./daily-core.ts";
import type { World } from "./daily-core.ts";
import { buildDailyMeta, buildDailyJsonLd, dailyPrevNext, dailyDateFromPathname, dailySitemapUrls } from "./daily-seo.ts";
export { Room, User, Challenge, Daily };
```

> These cover `injectDailyMeta` (Task 8), the routes (Task 9), and the sitemap (Task 10) — so Tasks 8-10 add NO further imports. The `Daily` class file is created in Task 7; this won't typecheck until then — implement Task 7 in the same session before `npm run typecheck`. (The repo's tsconfig does not set `noUnusedLocals`, so the temporarily-unused daily-seo imports won't error.)

- [ ] **Step 5: Commit** (after Task 7 typechecks)

```bash
git add wrangler.jsonc src/types.ts src/worker.ts
git commit -m "chore(daily): register DAILY DO (v4 sqlite migration) + Env binding"
```

### Task 7: The `Daily` Durable Object (`src/daily.ts`)

**Files:**
- Create: `src/daily.ts`

Mirrors `src/challenge.ts` (thin DO over `ctx.storage` "state").

- [ ] **Step 1: Write the DO**

`src/daily.ts`:
```ts
// src/daily.ts — system-singleton Durable Object (idFromName("daily")). Owns the
// date→World schedule + deterministic fallback, and the set of dates ever resolved
// (for the archive + sitemap). The curated word is handed only to a seeded Room DO
// (server→server); /resolve never leaks a future day's word to a still-playing client.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types.ts";
import type { DailySchedule, World } from "./daily-core.ts";
import { activeDate, resolveWorld, normalizeWorld } from "./daily-core.ts";

type DailyState = { schedule: DailySchedule; seen: string[] };

export class Daily extends DurableObject<Env> {
  private async load(): Promise<DailyState> {
    return (await this.ctx.storage.get<DailyState>("state")) ?? { schedule: {}, seen: [] };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Resolve the World for a date (defaults to today). Records the date as "seen".
    if (req.method === "GET" && url.pathname === "/resolve") {
      const date = url.searchParams.get("date") || activeDate(Date.now());
      const state = await this.load();
      const world = resolveWorld(state.schedule, date, Date.now());
      if (!state.seen.includes(date)) {
        state.seen.push(date);
        await this.ctx.storage.put("state", state);
      }
      return Response.json(world);
    }

    // Sorted union of curated + seen dates — for the archive index + sitemap.
    if (req.method === "GET" && url.pathname === "/dates") {
      const state = await this.load();
      const dates = Array.from(new Set([...Object.keys(state.schedule), ...state.seen])).sort();
      return Response.json({ dates });
    }

    // Admin seed: write/overwrite a curated World. Auth is enforced UPSTREAM in the
    // worker (Bearer token) before this is ever reached.
    if (req.method === "POST" && url.pathname === "/schedule") {
      const world: World | null = normalizeWorld(await req.json().catch(() => null));
      if (!world) return new Response("invalid world", { status: 400 });
      const state = await this.load();
      state.schedule[world.date] = world;
      if (!state.seen.includes(world.date)) state.seen.push(world.date);
      await this.ctx.storage.put("state", state);
      return Response.json({ ok: true, date: world.date });
    }

    return new Response("not found", { status: 404 });
  }
}
```

- [ ] **Step 2: Typecheck the new DO + binding**

Run: `npm run typecheck`
Expected: PASS (no errors). If `Daily` import/export errors, re-check Task 6 Step 4.

- [ ] **Step 3: Run the full test suite (nothing regressed)**

Run: `npm test`
Expected: PASS — all existing tests + the new daily-core/daily-seo tests.

- [ ] **Step 4: Commit**

```bash
git add src/daily.ts
git commit -m "feat(daily): Daily Durable Object (resolve/dates/schedule)"
```

---

## Phase D — Worker routes + SEO wiring

### Task 8: SEO placeholders in the shell + `injectDailyMeta`

**Files:**
- Modify: `public/index.html` (head: JSON-LD placeholder; body: SEO prose container)
- Modify: `src/worker.ts` (add `injectDailyMeta` + `DailyBodySetter`)

- [ ] **Step 1: Add SEO placeholders to `public/index.html`** — immediately after line 60 (the closing `</script>` of the existing WebApplication/FAQPage JSON-LD block, which spans lines 25-60), add a daily JSON-LD placeholder:

```html
<script type="application/ld+json" data-daily-jsonld></script>
```

and inside `<main id="app">` (replace line 82's comment) add a crawlable prose block that the SPA leaves hidden but crawlers read:

```html
<main id="app">
  <!-- Screens injected by app.js -->
  <noscript><div data-daily-prose></div></noscript>
</main>
```

> Using `<noscript>` keeps the prose invisible to JS users (the SPA renders the real UI) while remaining in the served HTML for crawlers. HTMLRewriter fills `[data-daily-prose]` for daily routes only.

- [ ] **Step 2: Add `injectDailyMeta` to `src/worker.ts`** — its imports were already added at the TOP of the file in Task 6 Step 4 (do NOT add imports here). Add this function immediately after the existing `injectMeta` function's closing `}` (around line 209):

```ts
// Serve the SPA shell themed for a daily date: meta + JSON-LD + crawlable story
// prose + prev/next links injected. `date` is a validated YYYY-MM-DD.
async function injectDailyMeta(env: Env, url: URL, date: string): Promise<Response> {
  let world: World | null = null;
  try {
    const res = await env.DAILY.get(env.DAILY.idFromName("daily")).fetch(`https://do/resolve?date=${date}`);
    if (res.ok) world = (await res.json()) as World;
  } catch { /* degrade to default meta below */ }

  const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
  if (!world) {
    // DAILY unavailable — still serve a sane shell with a self canonical.
    return new HTMLRewriter()
      .on('[data-meta="title"]', new TextSetter("Wordul of the Day"))
      .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/daily/${date}`))
      .transform(shell);
  }

  const meta = buildDailyMeta(date, world, url.origin);
  const jsonld = JSON.stringify(buildDailyJsonLd(date, world, url.origin));
  const { prev, next } = dailyPrevNext(date);
  const prose =
    `<h1>${escapeHtml(meta.title)}</h1>` +
    `<h2>${escapeHtml(world.story.title)}</h2>` +
    `<p>${escapeHtml(world.story.body)}</p>` +
    (world.story.tip ? `<p><em>${escapeHtml(world.story.tip)}</em></p>` : "") +
    `<nav><a href="${url.origin}/daily/${prev}">← ${prev}</a> · ` +
    `<a href="${url.origin}/daily/archive">archive</a> · ` +
    `<a href="${url.origin}/daily/${next}">${next} →</a></nav>`;

  return new HTMLRewriter()
    .on('[data-meta="title"]', new TextSetter(meta.title))
    .on('[data-meta="og:title"]', new AttrSetter("content", meta.title))
    .on('[data-meta="description"]', new AttrSetter("content", meta.description))
    .on('[data-meta="og:description"]', new AttrSetter("content", meta.description))
    .on('[data-meta="canonical"]', new AttrSetter("href", meta.canonical))
    .on('[data-meta="og:url"]', new AttrSetter("content", meta.canonical))
    .on('[data-daily-jsonld]', new TextSetter(jsonld))
    .on('[data-daily-prose]', new RawHtmlSetter(prose))
    .transform(shell);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

- [ ] **Step 3: Add the `RawHtmlSetter` rewriter handler** — after `AttrSetter` (after line 218):

```ts
class RawHtmlSetter {
  constructor(private html: string) {}
  element(el: Element) { el.setInnerContent(this.html, { html: true }); }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`injectDailyMeta` is unused until Task 9 wires the routes — TS won't error on an unused module-scope function, but if `noUnusedLocals` complains, proceed to Task 9 in the same session.)

- [ ] **Step 5: Commit** (after Task 9 if needed for unused-warnings)

```bash
git add public/index.html src/worker.ts
git commit -m "feat(daily): injectDailyMeta + SEO placeholders in shell"
```

### Task 9: Worker daily routes + admin schedule

**Files:**
- Modify: `src/worker.ts` (route block + imports already added in Task 8)

- [ ] **Step 1: Add the daily routes** — in `src/worker.ts`'s `fetch` handler, insert immediately after the sitemap route (`if (url.pathname === "/sitemap.xml") { return sitemap(env, url.origin); }`) and BEFORE the legacy redirect (`if (url.pathname === "/r" || url.pathname.startsWith("/r/"))`). Anchor to that code, not a line number — the top-of-file imports from Task 6 shift the numbers:

```ts
    // Home + Daily of the Day. "/" IS today's puzzle (canonical → dated permalink).
    if (url.pathname === "/" || url.pathname === "/daily") {
      const today = activeDate(Date.now());
      if (url.pathname === "/daily") return Response.redirect(url.origin + "/", 302);
      return injectDailyMeta(env, url, today);
    }

    // Admin seed: POST /daily/schedule (Bearer token). Set DAILY_ADMIN_TOKEN via
    // `wrangler secret put DAILY_ADMIN_TOKEN`. If unset, the route is closed.
    if (url.pathname === "/daily/schedule" && req.method === "POST") {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!env.DAILY_ADMIN_TOKEN || token !== env.DAILY_ADMIN_TOKEN) {
        return new Response("unauthorized", { status: 401 });
      }
      const stub = env.DAILY.get(env.DAILY.idFromName("daily"));
      return stub.fetch(new Request("https://do/schedule", {
        method: "POST",
        body: await req.text(),
        headers: { "content-type": "application/json" },
      }));
    }

    // Archive index — list of every day so far (rendered client-side from /api/daily/dates).
    if (url.pathname === "/daily/archive") {
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter("Wordul Daily — Archive"))
        .on('[data-meta="description"]', new AttrSetter("content", "Every Wordul of the Day — the whole archive, one word at a time."))
        .on('[data-meta="canonical"]', new AttrSetter("href", url.origin + "/daily/archive"))
        .transform(shell);
    }

    // Dated permalink — the eternal artifact. /daily/<YYYY-MM-DD>
    const dailyDate = dailyDateFromPathname(url.pathname);
    if (dailyDate) {
      return injectDailyMeta(env, url, dailyDate);
    }

    // Public dates list (powers the archive UI + client today checks).
    if (url.pathname === "/api/daily/dates") {
      const stub = env.DAILY.get(env.DAILY.idFromName("daily"));
      return stub.fetch(new Request("https://do/dates", { method: "GET" }));
    }
```

- [ ] **Step 2: (imports already done)** — `dailyDateFromPathname` and `activeDate` were imported at the top of `src/worker.ts` in Task 6 Step 4. No import edit needed here.

- [ ] **Step 3: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Manual smoke (worker dev)**

Run: `npm run dev` then in another shell:
```bash
curl -sI http://localhost:8787/ | grep -i "200\|location"
curl -s http://localhost:8787/ | grep -o 'data-meta="canonical"[^>]*'        # canonical → /daily/<today>
curl -s http://localhost:8787/daily/2026-06-02 | grep -o '<h1>[^<]*</h1>'      # crawlable prose present
curl -sI http://localhost:8787/daily | grep -i location                       # 302 → /
curl -s -X POST http://localhost:8787/daily/schedule -d '{}' | head -c 40      # → unauthorized (no token in dev)
curl -s http://localhost:8787/api/daily/dates                                  # → {"dates":[...]}
```
Expected: home serves with a `/daily/<today>` canonical; dated page has `<h1>`/story prose; `/daily` 302s to `/`; schedule is `unauthorized`; dates returns JSON.

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts public/index.html
git commit -m "feat(daily): worker routes — /, /daily/<date>, /daily/archive, admin schedule"
```

### Task 10: Daily entries in sitemap + `llms.txt`

**Files:**
- Modify: `src/worker.ts` (`sitemap` function, lines 127-144)
- Create: `public/llms.txt`

- [ ] **Step 1: Add daily URLs to the sitemap** — in `src/worker.ts`'s `sitemap` function, insert this block AFTER the KV `do…while` loop closes and BEFORE the `const body =` line (so the URLs land in `urls` before it's serialized):

```ts
  // Daily surface: home, archive, and every known date (best-effort — a DAILY hiccup
  // must not 500 the sitemap).
  try {
    const res = await env.DAILY.get(env.DAILY.idFromName("daily")).fetch("https://do/dates");
    if (res.ok) {
      const { dates } = (await res.json()) as { dates: string[] };
      urls.push(...dailySitemapUrls(dates, origin));
    }
  } catch { /* skip daily urls */ }
```

- [ ] **Step 2: (imports already done)** — `dailySitemapUrls` was imported at the top of `src/worker.ts` in Task 6 Step 4. No import edit needed here.

- [ ] **Step 3: Create `public/llms.txt`**

```text
# Wordul — wordul.com

Wordul is a free, ad-free multiplayer word game. The home page is the Wordul of
the Day: one curated word for the whole world, every day (rolls over 00:00 UTC).
Complete the day to unlock the leaderboard, the chat, the story behind the word,
and a gold goody — then jump into live rooms to keep playing.

## Key pages
- /                     Today's Wordul of the Day (canonical: /daily/<today>)
- /daily/<YYYY-MM-DD>   That day's eternal archive (board, story, leaderboard, chat)
- /daily/archive        Index of every past day
- /play                 Create or join live multiplayer rooms
- /@<username>          A player's public profile
- /how-to-play          Rules, gold economy, power-ups

## Why Wordul
Free. No ads. No interruptions. Multiplayer races, daily curated words, themed
"editions" with cloned-voice companions — the things NYT Wordle doesn't have.
```

- [ ] **Step 4: Typecheck + smoke**

Run: `npm run typecheck && npm run dev`
Then: `curl -s http://localhost:8787/sitemap.xml | grep -c "/daily/"` (expect ≥ 1 after a `/` visit seeds today).

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts public/llms.txt
git commit -m "feat(daily): sitemap daily entries + llms.txt"
```

---

## Phase E — Room daily mode

### Task 11: Daily fields on room state (types + backfill)

**Files:**
- Modify: `src/types.ts` (`RoomSnapshot`, `PlayerState`)
- Modify: `src/room.ts` (constructor backfill)

- [ ] **Step 1: Extend `RoomSnapshot`** — in `src/types.ts`, add to the `RoomSnapshot` type (after `edition: string;`, line 64):

```ts
  // Daily-mode (Wordul of the Day). Absent/false on normal race rooms.
  isDaily?: boolean;       // async one-shot, locked word, no resets, per-player scoring
  story?: { title: string; body: string; tip?: string } | null; // World story for the unlock
  voice?: string;          // World companion voice id (forward-compat; client still defaults)
```

- [ ] **Step 2: Extend `PlayerState`** — in `src/types.ts`, add to `PlayerState` (after `pointsSpent: number;`, line 35):

```ts
  scored?: boolean;        // daily: this player's one result has been recorded (mint once)
```

- [ ] **Step 3: Default + backfill the new fields in the Room constructor** — in `src/room.ts`:
  (a) In the default `this.state = { … }` object (lines 54-73), add right after `edition: "default",`:
```ts
      isDaily: false,
      story: null,
```
  (b) In the `blockConcurrencyWhile` restore block, after the `edition` backfill (line 84), add:
```ts
        if (restored.isDaily === undefined) restored.isDaily = false;
```
  `voice` and per-player `scored` stay optional (set only in daily mode); the `!player.scored` / `if (this.state.isDaily …)` checks treat `undefined` correctly, so no further defaults are required.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/room.ts
git commit -m "feat(daily): isDaily/story/voice on RoomSnapshot, scored on PlayerState"
```

### Task 12: Daily self-seed + mode locks

**Files:**
- Modify: `src/room.ts` (constants, `onHello`, new `seedDailyIfNeeded`, lock guards, `ensureBot`)

- [ ] **Step 1: Add the daily-bonus constant + detection** — in `src/room.ts`, after the `ROBOT_SLUG`/`BOT_NAME` constants (line 30), add:

```ts
// Wordul of the Day: a flat gold goody on completion, on top of the score-based mint.
const DAILY_GOLD_BONUS = 100; // ← tune to taste (1 gold ≈ 100 points)

// A room whose canonical path is daily/<YYYY-MM-DD> is the day's puzzle.
function dailyDateOf(path: string): string | null {
  const m = /^daily\/(\d{4}-\d{2}-\d{2})$/.exec(path ?? "");
  return m ? m[1] : null;
}
```

- [ ] **Step 2: Add `seedDailyIfNeeded`** — in `src/room.ts`, add a new method (place it just before `onStart`, after `onHello`'s helpers, e.g. after `registerRoom`, line 283):

```ts
  // A daily room (path daily/<date>) pulls its World from the DAILY DO on first
  // contact and locks to it: the word never changes, the board goes straight to
  // "playing" (no host start), and the theme/story come from the World. Server→server
  // so the word never reaches a still-playing client. Idempotent — seeds once.
  private async seedDailyIfNeeded(): Promise<void> {
    const date = dailyDateOf(this.state.path);
    if (!date) return;                 // not a daily room
    if (this.state.isDaily && this.state.word) return; // already seeded
    try {
      const res = await this.env.DAILY.get(this.env.DAILY.idFromName("daily"))
        .fetch(`https://do/resolve?date=${date}`);
      if (!res.ok) return;
      const world = (await res.json()) as {
        word: string; edition: string; voice: string;
        story: { title: string; body: string; tip?: string };
      };
      const word = (world.word ?? "").toUpperCase();
      if (!/^[A-Z]+$/.test(word)) return;
      this.state.isDaily = true;
      this.state.word = word;
      this.state.wordLength = word.length;
      this.state.maxGuesses = guessesFor(word.length);
      this.state.edition = world.edition || "default";
      this.state.voice = world.voice || "yang";
      this.state.story = world.story ?? null;
      this.state.phase = "playing";    // async one-shot: always live, no lobby
      this.state.round = 1;
      this.state.startedAt = this.state.startedAt ?? Date.now();
    } catch (e) {
      console.error("seedDaily failed", this.state.path, (e as Error).message);
    }
  }
```

- [ ] **Step 3: Call it from `onHello`** — in `src/room.ts`, in `onHello`, replace the `this.ensureBot();` line near the end (line 267) with a daily-aware version:

```ts
    await this.seedDailyIfNeeded();
    this.ensureBot();
```

> A fresh daily player is `pushed` into `state.players` with `status: "playing"` (existing code, line 220), which is correct: they can immediately guess the locked word.

- [ ] **Step 4: Lock the daily room against resets/config** — add an early-return guard at the top of each of these methods in `src/room.ts`:

In `onStart` (after line 369 `if (this.state.phase === "playing") return;`), add:
```ts
    if (this.state.isDaily) return; // daily auto-starts on seed; no manual start
```
In `onRematch` (after line 600 `if (this.state.phase !== "finished") return;` — note daily never reaches "finished", but guard anyway), add at the very top:
```ts
    if (this.state.isDaily) return; // daily never resets — one attempt per day
```
In `onSetLength`, `onSetMode`, `onSetEdition` — add as the first line of each:
```ts
    if (this.state.isDaily) return; // daily word/theme are locked by the World
```

- [ ] **Step 5: Keep bots — and the directory — out of daily rooms** — in `ensureBot` (line 451), add after `if (!this.isRobotRoom()) return;`:

```ts
    if (this.state.isDaily) return; // no worduler in the daily room
```

Daily rooms already never register in `DIRECTORY` (the `registerRoom` + owner-profile writes in `onHello` only fire when `username === this.state.owner`, and `daily/<date>`'s owner is the literal string `"daily"`, which no human username equals — so daily URLs never leak into the sitemap as `/@daily/<date>`). Make the intent undeniable: add an explicit guard as the first line of `registerRoom` (line 271):

```ts
    if (this.state.isDaily) return; // daily rooms are NOT directory-discoverable
```

- [ ] **Step 6: Typecheck + full test**

Run: `npm run typecheck && npm test`
Expected: PASS (existing race-room tests unaffected — daily branches are all guarded behind `isDaily`).

- [ ] **Step 7: Commit**

```bash
git add src/room.ts
git commit -m "feat(daily): room self-seeds World + locks word/theme/resets in daily mode"
```

### Task 13: Per-player completion + goody gold

**Files:**
- Modify: `src/room.ts` (`applyGuess`, `onResign`, new `afterPlayerStatus` + `scorePlayer`)

The race path finishes the whole room at once (`maybeFinish` → `finishGame`). Daily is async: each player completes independently, scored once, and the room never globally finishes.

- [ ] **Step 1: Route completion through a shared hook** — in `src/room.ts`, in `applyGuess`, replace the final `await this.maybeFinish();` (line 440) with:

```ts
    await this.afterPlayerStatus(player);
```

In `onResign`, replace `await this.maybeFinish();` (line 510) with:

```ts
    await this.afterPlayerStatus(player);
```

- [ ] **Step 2: Add `afterPlayerStatus` + `scorePlayer`** — in `src/room.ts`, add these methods right after `finishGame` (after line 597):

```ts
  // Completion router. Race rooms finish all-at-once (maybeFinish); daily rooms score
  // each player the moment THEY finish (won/lost), exactly once, with no global finish.
  private async afterPlayerStatus(player: PlayerState): Promise<void> {
    if (!this.state.isDaily) {
      await this.maybeFinish();
      return;
    }
    if (player.status !== "playing" && !player.scored) {
      player.scored = true;
      if (this.state.winner === null && player.status === "won") this.state.winner = player.username;
      await this.scorePlayer(player);
    }
  }

  // Daily: record ONE player's result — scoreboard bump + game record + gold (score
  // mint + flat daily goody). Best-effort; never blocks the player's board flipping.
  private async scorePlayer(player: PlayerState): Promise<void> {
    this.state.scoreboard = bumpScoreboard(this.state.scoreboard, {
      winner: player.status === "won" ? player.username : null,
      participants: [player.username],
    });
    // Daily is async one-shot: each record is intentionally SOLO (empty opponents) —
    // hundreds play the same word across 24h, so a per-player rival list is meaningless.
    // summarizeRoomGame + the profile UI already handle solo records gracefully.
    const records = buildGameRecords({
      roomPath: this.state.path,
      word: this.state.word ?? "",
      wordLength: this.state.wordLength,
      finishedAt: Date.now(),
      players: [{ username: player.username, status: player.status, guesses: player.guesses.length }],
    });
    const record = records[player.username];
    const gold = goldFromPoints(player.points) + DAILY_GOLD_BONUS; // score mint + goody
    const stub = this.env.USER.get(this.env.USER.idFromName(player.username));
    const calls: Promise<unknown>[] = [
      stub.fetch(`https://do/append?username=${encodeURIComponent(player.username)}`, {
        method: "POST", body: JSON.stringify(record),
      }).catch((e) => console.error("daily report failed", player.username, (e as Error).message)),
    ];
    if (!player.isBot) {
      calls.push(
        stub.fetch(`https://do/ledger/append?username=${encodeURIComponent(player.username)}`, {
          method: "POST",
          body: JSON.stringify({ token: "gold", delta: gold, reason: "mint:daily", ref: `${this.state.path}#${player.username}` }),
        }).catch((e) => console.error("daily mint failed", player.username, (e as Error).message)),
      );
    }
    await Promise.allSettled(calls);
  }
```

- [ ] **Step 3: Typecheck + full test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Manual smoke (the full daily loop)**

Run: `npm run dev`. In a browser at `http://localhost:8787/`:
1. The home connects to room `daily/<today>` and shows a board already in `playing` (no "Start" button).
2. Solve or give up → your gold increases by score + 100; the answer reveals to you only.
3. Reload → your finished board is restored; you cannot guess again (no reset).
4. Open a second browser (different username) → fresh board, same word; finishing scores them independently.

- [ ] **Step 5: Commit**

```bash
git add src/room.ts
git commit -m "feat(daily): per-player scoring + free-gold goody on completion"
```

---

## Phase F — Frontend: daily home, hard gate, goody, bridge

> ⛔ **SUPERSEDED — do NOT implement Tasks 14-17 below.** They built a *parallel* home/daily UI (`parseRoute /`→daily, `showHome`→`/play`, tpl-room takeover) against a stale checkout. On `origin/main` the home is already the **hub** (`public/hub.js`, `renderHomeIdentity`). Implement **"Phase F (REVISED) — Integrate into the existing hub"** at the END of this document instead. Tasks 14-17 are kept only for historical context.

### Task 14: Route the front door to the daily

**Files:**
- Modify: `public/app.js` (`parseRoute` line 72, `route` line 2757, `showHome` line 95)

- [ ] **Step 1: Teach `parseRoute` about daily + /play** — replace `parseRoute` (`public/app.js:72-80`). Order matters: dated `/daily/<date>`, `/daily/archive`, and `/play` are matched first; `/` and bare `/daily` map to **today's daily** (NOT home); `ROOM_RE`/`PROFILE_RE` only match `/@…` paths so they never collide with `/`. The `route()` dispatcher in Step 2 branches on `daily`/`daily-archive` BEFORE `room`/`profile`:

```js
const DAILY_RE = /^\/daily\/(\d{4}-\d{2}-\d{2})$/;
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function parseRoute() {
  const challenge = location.pathname.match(/^\/c\/([0-9A-Za-z]{5})$/);
  if (challenge) return { kind: "challenge", id: challenge[1] };
  if (location.pathname === "/play") return { kind: "home" };
  if (location.pathname === "/daily/archive") return { kind: "daily-archive" };
  const dated = location.pathname.match(DAILY_RE);
  if (dated) return { kind: "daily", date: dated[1] };
  const room = location.pathname.match(ROOM_RE);
  if (room) return { kind: "room", owner: room[1], slug: room[2] };
  const prof = location.pathname.match(PROFILE_RE);
  if (prof) return { kind: "profile", username: prof[1] };
  if (location.pathname === "/" || location.pathname === "/daily") return { kind: "daily", date: todayUTC() };
  return { kind: "home" };
}
```

- [ ] **Step 2: Dispatch daily routes** — in `route()` (`public/app.js:2757`), add daily handling before the `room` branch:

```js
function route() {
  const r = parseRoute();
  renderCrumbs(r);
  if (r.kind === "challenge") { showChallenge(r.id); return; }
  if (r.kind === "daily") { showDaily(r.date); return; }
  if (r.kind === "daily-archive") { showDailyArchive(); return; }
  if (r.kind === "room") {
    if (getUsername()) { showRoom(r.owner, r.slug); }
    else { showRoomEntry(r.owner, r.slug); }
  } else if (r.kind === "profile") {
    showProfile(r.username);
  } else {
    leaveRoom();
    showHome();
  }
}
```

- [ ] **Step 3: Move the live-play home to `/play`** — in `showHome` (`public/app.js:95`), change the URL it pins:

```js
function showHome() {
  history.replaceState(null, "", "/play");
```

and add a "Wordul of the Day" return link at the top of the home CTA — after the `how-to-play` link wiring (line 108 area), append inside `showHome`:

```js
  // Daily is the front door; offer a one-tap hop back to today's puzzle.
  const howto = $(".home-howto");
  if (howto && !$(".home-daily-link")) {
    const a = document.createElement("a");
    a.className = "home-daily-link link";
    a.href = "/";
    a.textContent = "✦ Play today's Wordul →";
    a.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });
    howto.parentNode.insertBefore(a, howto);
  }
```

- [ ] **Step 4: Typecheck (frontend is plain JS) + boot smoke**

Run: `npm run dev`, then load `/play` (old home appears, URL stays `/play`), `/` (daily — Task 15 makes it render), `/@you` (profile back-button → `/` daily). No console errors in `parseRoute`/`route`.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(daily): front-door routing — / = daily, /play = live home"
```

### Task 15: `showDaily` / `showDailyEntry` (reuse the room engine)

**Files:**
- Modify: `public/app.js` (new `showDaily`, `showDailyEntry`; small `showRoom` daily flag)

A daily IS a room (`daily/<date>`), so we reuse `showRoom`'s socket/board/keyboard wiring and flag it daily.

- [ ] **Step 1: Add a daily flag to the game object** — in the `game` object (`public/app.js:364`), add after `challengeId`:

```js
  isDaily: false,    // /daily/<date>: async one-shot, gated "underneath"
  dailyDate: null,
```

- [ ] **Step 2: Preserve the daily flag across `showRoom`** — ⚠️ `showRoom`'s FIRST line is `leaveRoom();`, and `leaveRoom()` clears `game.isDaily`/`game.dailyDate` (Task 16 Step 3). So capture them BEFORE that call. In `showRoom` (line 487), insert as the very FIRST statement of the function body, ABOVE `leaveRoom();`:

```js
  const keepDaily = game.isDaily, keepDailyDate = game.dailyDate; // must survive leaveRoom()
```
Then, after the block that resets `game.*` fields (after `game.autoStart = false;`, ~line 500-504), restore them:
```js
  game.isDaily = keepDaily; game.dailyDate = keepDailyDate;
```

- [ ] **Step 3: Add `showDaily` + `showDailyEntry`** — add after `showChallengeEntry` (around line 623):

```js
// The Wordul of the Day: a room at daily/<date>, rendered with daily chrome and a
// gated "underneath". Needs a username to play (like a room/challenge).
function showDaily(date) {
  if (!getUsername()) { showDailyEntry(date); return; }
  game.isDaily = true;
  game.dailyDate = date;
  // Canonical lives at the dated permalink; "/" stays clean in the bar for today.
  if (date !== todayUTC()) history.replaceState(null, "", `/daily/${date}`);
  document.title = `Wordul of the Day — ${date}`;
  showRoom("daily", date);
}

function showDailyEntry(date) {
  game.isDaily = true;
  game.dailyDate = date;
  mount("tpl-home");
  const topBtn = $("#chatTopBtn");
  if (topBtn) topBtn.hidden = true;
  $("#homeGreeting").hidden = true;
  $("#homeRooms").hidden = true;
  $("#homeIntro").hidden = false;
  $(".tagline").textContent = t("daily.entryTitle");
  $(".sub").textContent = t("daily.entrySub");
  const input = $("#usernameInput");
  input.value = getUsername();
  input.focus();
  const btn = $("#startPlayingBtn");
  const label = btn.querySelector(".hero-btn-label") || btn;
  label.textContent = t("daily.entryCta");
  const play = () => {
    const username = setUsername(input.value);
    if (username.length < 3) { input.focus(); toast(t("home.needName"), { error: true, duration: 1800 }); return; }
    showDaily(date);
  };
  btn.addEventListener("click", play);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") play(); });
}
```

> `showRoom("daily", date)` connects to `/ws?room=daily/<date>`. The worker passes that to the Room DO, which `seedDailyIfNeeded()` recognizes and locks. The owner segment "daily" never matches a real player's username, so no owner-config or directory registration fires.

- [ ] **Step 4: Ensure `t` is available** — confirm `public/app.js` imports the i18n helper; if not present near the top imports, add:

```js
import { t } from "/i18n.js";
```

- [ ] **Step 5: Smoke**

Run: `npm run dev`. Visit `/` with no username → daily entry copy + "Play today" CTA; pick a username → board (already playing, locked word). Visit `/daily/2026-06-01` → that day's board.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(daily): showDaily/showDailyEntry reuse the room engine"
```

### Task 16: Hard-gate the "underneath" + daily chrome

**Files:**
- Modify: `public/app.js` (`render` line 1292; hide lobby/invite controls in daily)

- [ ] **Step 1: Gate scoreboard/chat/games until the viewer finishes** — in `render()` (`public/app.js:1292`), after `const me = snap.players.find(...)` (line 1295), add a daily gate computed once:

```js
  // Daily hard-gate: until YOU finish (win/give up), only your board is visible.
  // me.status flips to won/lost on completion → the whole "underneath" unlocks.
  const dailyLocked = game.isDaily && (!me || me.status === "playing");
```

- [ ] **Step 2: Apply the gate** — still in `render()`, replace the chat-visibility block (lines 1346-1351) with a daily-aware version:

```js
  // Chat + leaderboard are social — hidden while you play solo in a normal room, and
  // in daily mode they stay LOCKED until you finish today's word.
  const hasCompany = snap.players.length >= 2;
  const showSocial = game.isDaily ? !dailyLocked : hasCompany;
  const chatPanel = $("#chatPanel");
  const chatTopBtn = $("#chatTopBtn");
  if (chatPanel) chatPanel.hidden = !showSocial;
  if (chatTopBtn) chatTopBtn.hidden = !showSocial;
  if (!showSocial) closeChatSheet();
```

and hide the room tabs while locked — after `applyTabVisibility(snap.phase === "playing");` (line 1363) add:

```js
  const tabs = $("#roomTabs");
  if (tabs) tabs.hidden = game.isDaily && dailyLocked;
```

- [ ] **Step 3: Hide lobby/invite/rematch chrome in daily** — in `render()`, the lobby branch (line 1320) runs only when `phase === "lobby"`; daily is always `playing`, so lobby controls already stay hidden. Hide the invite/share row + day chrome — after `setChromeVisibility(snap.phase);` (line 1356) add:

```js
  if (game.isDaily) {
    document.body.classList.add("daily");
    const inviteRow = $(".invite-share-row"); if (inviteRow) inviteRow.hidden = true;
    const renameBtn = $("#renameBtn"); if (renameBtn) renameBtn.hidden = true;
    const nameEl = $("#roomName");
    if (nameEl) nameEl.textContent = t("daily.boardTitle", { date: game.dailyDate });
  }
```

and in `leaveRoom()` (line 2703) clear the body class — after `document.body.classList.remove("playing");` (line 2713) add:

```js
  document.body.classList.remove("daily");
  game.isDaily = false; game.dailyDate = null;
```

- [ ] **Step 4: Smoke** — `npm run dev`, visit `/`: while playing, no tabs/chat/scoreboard, no invite/rename; after solving, they appear. Open a normal room at `/@you/<slug>` → unaffected (tabs/chat normal).

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(daily): hard-gate leaderboard/chat/tabs until you complete the day"
```

### Task 17: The unlock — story + goody + keep-playing bridge

**Files:**
- Modify: `public/index.html` (`tpl-room`: add `#dailyUnlock`)
- Modify: `public/app.js` (render the unlock on completion)
- Modify: `public/locales/en.js` (`daily.*` strings)

- [ ] **Step 1: Add the unlock panel to `tpl-room`** — in `public/index.html`, inside `#tabPlay` after `#messageRow` (line 180), add:

```html
      <section id="dailyUnlock" class="daily-unlock" hidden>
        <div class="daily-goody" id="dailyGoody"></div>
        <article class="daily-story" id="dailyStory"></article>
        <div class="daily-bridge">
          <a href="/play" class="btn primary block" id="dailyBridgeBtn">▶ Keep playing — live rooms</a>
          <a href="/daily/archive" class="link" id="dailyArchiveLink">Browse past days →</a>
        </div>
      </section>
```

- [ ] **Step 2: Render the unlock on completion** — in `public/app.js`, add a function and call it from `render()`. Add the call right after the daily chrome block from Task 16 Step 3:

```js
  if (game.isDaily) renderDailyUnlock(snap, me);
```

Add the function (near `renderGames`, around line 1227):

```js
// The "underneath", revealed once you finish today's word: a goody line, the story
// behind the word, and a one-tap bridge into live rooms. Idempotent per snapshot.
// snap.story may be null (World fetch failed / house day) — the goody + bridge still
// render; only the story block is skipped.
function renderDailyUnlock(snap, me) {
  const box = $("#dailyUnlock");
  if (!box) return;
  const done = me && me.status !== "playing";
  box.hidden = !done;
  if (!done) return;
  const goody = $("#dailyGoody");
  if (goody && !goody.dataset.filled) {
    const solved = me.status === "won";
    goody.textContent = solved
      ? t("daily.goodySolved", { word: snap.word || "" })
      : t("daily.goodyMissed", { word: snap.word || "" });
    goody.dataset.filled = "1";
  }
  const story = $("#dailyStory");
  if (story && snap.story && !story.dataset.filled) {
    const h = document.createElement("h3");
    h.textContent = snap.story.title || t("daily.storyFallbackTitle");
    const p = document.createElement("p");
    p.textContent = snap.story.body || "";
    story.append(h, p);
    if (snap.story.tip) {
      const tip = document.createElement("p");
      tip.className = "daily-tip";
      tip.textContent = "💡 " + snap.story.tip;
      story.appendChild(tip);
    }
    story.dataset.filled = "1";
  }
  const bridge = $("#dailyBridgeBtn");
  if (bridge && !bridge.dataset.wired) {
    bridge.addEventListener("click", (e) => { e.preventDefault(); navigate("/play"); });
    bridge.dataset.wired = "1";
  }
  const arch = $("#dailyArchiveLink");
  if (arch && !arch.dataset.wired) {
    arch.addEventListener("click", (e) => { e.preventDefault(); navigate("/daily/archive"); });
    arch.dataset.wired = "1";
  }
}
```

> `snap.word` is non-null only once the viewer is done (server `snapshotFor` gate), so the goody/story can safely show the answer. `dataset.filled` guards make it idempotent across the many snapshots per second.

- [ ] **Step 3: Add `daily.*` strings** — in `public/locales/en.js`, add these keys (match the file's existing object style):

```js
  "daily.entryTitle": "Today's Wordul.",
  "daily.entrySub": "One word. The whole world. Pick a username to play.",
  "daily.entryCta": "Play today →",
  "daily.boardTitle": "Wordul of the Day · {date}",
  "daily.goodySolved": "🎁 Solved it! The word was {word}. Here's your gold.",
  "daily.goodyMissed": "The word was {word}. Here's a little gold for trying — come back tomorrow.",
  "daily.storyFallbackTitle": "The story behind the word",
```

- [ ] **Step 4: Add `showDailyArchive`** — in `public/app.js`, add a minimal archive renderer (referenced by `route()` in Task 14). Place near `showProfile` (around line 2716):

```js
// The archive: every past day as a clickable list (data from /api/daily/dates).
async function showDailyArchive() {
  leaveRoom();
  mount("tpl-profile"); // reuse the simple single-column screen shell
  const back = $("#profileBack"); if (back) back.onclick = (e) => { e.preventDefault(); navigate("/"); };
  document.title = "Wordul Daily — Archive";
  const mountEl = $("#profileMount");
  if (mountEl) mountEl.innerHTML = `<h1>${t("daily.archiveTitle")}</h1><ul class="daily-archive-list" id="dailyArchiveList"></ul>`;
  try {
    const res = await fetch("/api/daily/dates");
    const { dates } = res.ok ? await res.json() : { dates: [] };
    const list = $("#dailyArchiveList");
    if (list) {
      for (const d of dates.slice().reverse()) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `/daily/${d}`; a.textContent = d; a.className = "link";
        a.addEventListener("click", (e) => { e.preventDefault(); navigate(`/daily/${d}`); });
        li.appendChild(a); list.appendChild(li);
      }
    }
  } catch { /* empty archive degrades to just the heading */ }
}
```

and add the string in `public/locales/en.js`:
```js
  "daily.archiveTitle": "Every Wordul of the Day",
```

- [ ] **Step 5: Run i18n check + full test + smoke**

Run: `npm test` (pure tests still green). Then `npm run dev`:
1. `/` → play → solve → goody + story + tip + "Keep playing" + archive link all appear.
2. Click "Keep playing" → `/play` live home.
3. `/daily/archive` → list of dates; click one → that day's board.

If the repo has a `check-i18n` gauntlet script, run it and resolve any missing-key warnings for the new `daily.*` keys.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js public/locales/en.js
git commit -m "feat(daily): unlock panel — goody + story + tip + keep-playing bridge + archive"
```

---

## Self-review checklist (run before declaring done)

- [ ] **Spec coverage:** home takeover (Task 9/14), 00:00 UTC rollover (`activeDate`, Task 1/9), hard gate (Task 16), goody = free gold + story/tip (Task 13/17), keep-playing bridge (Task 17), eternal permalink + SEO (Task 8/9), sitemap + llms (Task 10), DAILY DO + fallback (Task 2/3/7), admin seed auth (Task 9), one scored attempt per username (Task 12/13). Bonus-word + curator note reserved only (types carry the fields, no behavior). ✅
- [ ] **No placeholders:** every code step has real code; every test step has real assertions; every run step has a real command + expected result.
- [ ] **Type consistency:** `World`/`DailySchedule` defined in `daily-core.ts` and imported everywhere; `resolveWorld(schedule, date, nowMs)` arg order identical in DO + tests; `RoomSnapshot.story` shape `{title, body, tip?}` matches `World.story` and the client reader; `scorePlayer` uses the same `goldFromPoints`/ledger shape as `finishGame`.
- [ ] **Race rooms unaffected:** every daily branch is guarded by `isDaily`; `seedDailyIfNeeded` early-returns for non-`daily/*` paths.

## Verification & rollout (not a code task)

1. `npm test` (all green) + `npm run typecheck` (clean).
2. Deploy via the `/push` skill (commit → push main → `wrangler deploy` → smoke). 
3. **Migration verify (the v4 scar):** after deploy, confirm the `Daily` class deployed without err 10097 — check `wrangler deployments list` / the dashboard shows the `v4` migration applied. If deploy errors with 10097, the `new_sqlite_classes` entry is wrong — fix and redeploy.
4. **Set the admin secret:** `wrangler secret put DAILY_ADMIN_TOKEN` (operator runs this; until set, `/daily/schedule` returns 401 — the safe default).
5. **Seed a curated day (optional smoke):**
   ```bash
   curl -X POST https://wordul.com/daily/schedule \
     -H "Authorization: Bearer $DAILY_ADMIN_TOKEN" -H "content-type: application/json" \
     -d '{"date":"2026-06-03","word":"EMBER","edition":"yang","voice":"yang","story":{"title":"Why EMBER?","body":"A small warmth that refuses to go out.","tip":"Start with a vowel-rich opener."}}'
   ```
6. Smoke: `/` plays today; finishing unlocks the underneath + gold; `/daily/<date>` shows story prose in view-source; `/sitemap.xml` lists daily URLs; yesterday's room still loads (eternal).

---

# REVISION A (2026-06-02) — rebased onto `origin/main` @ `1519bca` + hub integration

The original plan was written against a stale local checkout (8+ commits behind). On `origin/main`, **"The Daily" home hub already ships** (`public/hub.js`, hub shell in `tpl-home`, `dayTheme`, "route home through the hub"). The backend engine (Phases A–E) is **still greenfield and valid**; only **Phase F is replaced** (below) to integrate with the hub instead of building a parallel home. Build against `origin/main`, in the worktree.

## Code-base facts to build against (`origin/main` @ `1519bca`)

- **`src/room.ts` is 721 lines, challenge-integrated.** `onStart` already has `if (this.state.challengeId) { /* fetch pinned word from CHALLENGE server→server */ } else { /* random */ }` — the daily word-seed mirrors that exact server→server pattern. **Ignore the original Phase E line numbers; locate methods by name** (`constructor`, `onHello`, `registerRoom`, `onStart`, `applyGuess`, `onResign`, `ensureBot`, `finishGame`, `snapshotFor`). The Phase E *code* is unchanged.
- **`Env` (src/types.ts:20-27) already has 4 DO namespaces.** Phase C Task 6 Step 3 must use this exact interface (supersedes the original):
  ```ts
  export interface Env {
    ASSETS: Fetcher;
    ROOM: DurableObjectNamespace;
    USER: DurableObjectNamespace;
    CHALLENGE: DurableObjectNamespace;
    DAILY: DurableObjectNamespace;
    DIRECTORY: KVNamespace;
    DESIGNS: R2Bucket;
    DAILY_ADMIN_TOKEN?: string; // wrangler secret; gates POST /daily/schedule
  }
  ```
- **`RoomSnapshot` already has `challengeId?`** — Phase E's `isDaily/story/voice` sit beside it; the constructor default object already lists `challengeId: null`, so add `isDaily: false, story: null` there too.
- **`wrangler.jsonc`:** migrations v1/v2/v3 (Room/User/Challenge) + `"preview_urls": true`. DAILY = **v4 `new_sqlite_classes`** (unchanged). Bindings array currently ends with the `CHALLENGE` entry — add `DAILY` after it.
- **`src/worker.ts` (219 lines)** has challenge routes; Phase D's daily routes/sitemap/injectMeta edits still apply (anchor structurally: after the `/sitemap.xml` route, before the `/r` redirect).
- **Phase D note — the home is the hub, not a daily takeover.** Keep Phase D's `/daily/<date>`, `/daily/archive`, `POST /daily/schedule`, sitemap, and `injectDailyMeta`. **DROP** the original Phase D "`/` or `/daily` → injectDailyMeta(today)" branch — `/` must keep serving the hub shell untouched. `/daily` (bare) → `302` to `/daily/<today>` is fine; `/` is left to the existing ASSETS/hub path.

## Phase F (REVISED) — Integrate the real daily into the existing hub

The hub (`public/hub.js` + `renderHomeIdentity`) already owns home + "The Daily" panel + "Play today's word". We do **not** rebuild home. We point its `onPlay` at the real shared daily room, reach it via `/daily/<date>`, hard-gate the underneath in the room view, render the goody/story/bridge on completion, and theme the board by the World's edition (house days fall back to the hub's `dayTheme`).

### Task F1: `/daily/<date>` + `/daily/archive` routes (leave `/` = hub)

**Files:** Modify `public/app.js` (`parseRoute` ~line 74, `route` ~line 2778).

- [ ] **Step 1: add a `todayUTC` helper + daily branches to `parseRoute`** (do NOT touch the `/` → home fallthrough — the hub owns home). Replace `parseRoute` (lines 74-82):
```js
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function parseRoute() {
  const challenge = location.pathname.match(/^\/c\/([0-9A-Za-z]{5})$/);
  if (challenge) return { kind: "challenge", id: challenge[1] };
  if (location.pathname === "/daily/archive") return { kind: "daily-archive" };
  const daily = location.pathname.match(/^\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (daily) return { kind: "daily", date: daily[1] };
  if (location.pathname === "/daily") return { kind: "daily", date: todayUTC() };
  const room = location.pathname.match(ROOM_RE);
  if (room) return { kind: "room", owner: room[1], slug: room[2] };
  const prof = location.pathname.match(PROFILE_RE);
  if (prof) return { kind: "profile", username: prof[1] };
  return { kind: "home" };
}
```
- [ ] **Step 2: dispatch daily in `route()`** — after the `challenge` branch, before the `room` branch:
```js
  if (r.kind === "daily") { showDaily(r.date); return; }
  if (r.kind === "daily-archive") { showDailyArchive(); return; }
```
- [ ] **Step 3:** `npm run typecheck` clean; load `/daily/2026-06-02` (Task F3 makes it render). Commit: `feat(daily): /daily/<date> + /daily/archive routes`.

### Task F2: point the hub's "Play today's word" at the real daily room

**Files:** Modify `public/app.js` (`renderHomeIdentity` ~line 154).

- [ ] **Step 1:** in the `cbs` object, change `onPlay` from creating a new themed room to entering the shared daily room (apply the theme-of-day as the board's starting look; a curated `World.edition` overrides via snapshot):
```js
      onPlay: (editionId) => { applyEdition(editionId); navigate(`/daily/${todayUTC()}`); },
```
- [ ] **Step 2:** `npm run typecheck` clean; from the hub, "Play today's word" navigates to `/daily/<today>`. Commit: `feat(daily): hub 'Play today's word' enters the real daily room`.

### Task F3: `showDaily` / `showDailyEntry` (reuse `showRoom`; flag set AFTER, like `enterNewRoom`'s `autoStart`)

**Files:** Modify `public/app.js`. Add `isDaily: false, dailyDate: null` to the `game` object (~line 399, beside `challengeId`).

- [ ] **Step 1:** add the two screens near `showRoomEntry`:
```js
// The Wordul of the Day: a SHARED room at daily/<date> (everyone joins the same DO).
// Reuses the room engine; daily chrome + the gated unlock are render()-driven.
function showDaily(date) {
  if (!getUsername()) { showDailyEntry(date); return; }
  document.title = `Wordul of the Day — ${date}`;
  showRoom("daily", date);                       // connects to /ws?room=daily/<date>
  game.isDaily = true; game.dailyDate = date;    // AFTER showRoom resets state (mirrors enterNewRoom's autoStart)
}

// Username gate for a cold deep-link to /daily/<date> (the hub path already has a username).
function showDailyEntry(date) {
  mount("tpl-home");
  const hub = $("#hub"); if (hub) hub.hidden = true;
  $("#homeGreeting").hidden = true; $("#homeRooms").hidden = true;
  $("#homeIntro").hidden = false;
  $(".tagline").textContent = t("daily.entryTitle");
  $(".sub").textContent = t("daily.entrySub");
  const cta = $(".home-cta"); if (cta) cta.hidden = false;
  const input = $("#usernameInput"); input.value = getUsername(); input.focus();
  const btn = $("#startPlayingBtn"); const label = btn.querySelector(".hero-btn-label") || btn;
  label.textContent = t("daily.entryCta");
  const play = () => {
    const u = setUsername(input.value);
    if (u.length < 3) { input.focus(); toast("Pick a username — at least 3 letters", { error: true, duration: 1800 }); return; }
    showDaily(date);
  };
  btn.addEventListener("click", play);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") play(); });
}
```
- [ ] **Step 2:** in `leaveRoom()` (~line 2724), clear the daily flags + body class — after `document.body.classList.remove("playing");`:
```js
  document.body.classList.remove("daily");
  game.isDaily = false; game.dailyDate = null;
```
- [ ] **Step 3:** smoke `/daily/<today>` from a fresh + logged-in user; `npm run typecheck`. Commit: `feat(daily): showDaily/showDailyEntry reuse the room engine`.

### Task F4: hard-gate the underneath + house-day board theming (`render()` + `onServerMessage`)

**Files:** Modify `public/app.js` (`render()` ~line 1315; the snapshot edition-apply in `onServerMessage` ~line 1014+). Read the current `render()` chat/scoreboard/tabs gating and `onServerMessage`'s `applyEdition(msg.room.edition)` block before editing — anchor structurally.

- [ ] **Step 1: hard-gate in `render()`** — after `const me = snap.players.find(...)`, compute the gate and apply it to chat + tabs + lobby chrome:
```js
  const dailyLocked = game.isDaily && (!me || me.status === "playing");
  if (game.isDaily) {
    document.body.classList.add("daily");
    const inviteRow = $(".invite-share-row"); if (inviteRow) inviteRow.hidden = true;
    const tabs = $("#roomTabs"); if (tabs) tabs.hidden = dailyLocked;        // no leaderboard/games until done
    const nameBtn = $("#roomName"); if (nameBtn) nameBtn.textContent = t("daily.boardTitle", { date: game.dailyDate });
  }
```
Fold `dailyLocked` into the existing chat-visibility decision: chat shows when `game.isDaily ? !dailyLocked : hasCompany`. Keep race rooms unchanged. (Daily rooms are seeded straight to `playing`, so the lobby controls already stay hidden.)
- [ ] **Step 2: house-day theming (decision: World owns word; `dayTheme` owns the house edition)** — in `onServerMessage`'s snapshot handler, replace the `applyEdition(msg.room.edition)` line so a daily room with a non-curated (`"default"`) edition keeps the hub's theme-of-day:
```js
  const wantEd = game.isDaily
    ? (msg.room.edition && msg.room.edition !== "default" ? msg.room.edition : getActiveEditionId())
    : msg.room.edition;
  if (wantEd && wantEd !== getActiveEditionId()) { applyEdition(wantEd); applySettings(getSettings()); }
```
- [ ] **Step 3:** smoke: while playing the daily, no tabs/chat; a normal room at `/@you/<slug>` is unchanged. `npm run typecheck`. Commit: `feat(daily): hard-gate the underneath + house-day dayTheme fallback`.

### Task F5: the unlock — story + goody + keep-playing bridge

**Files:** Modify `public/index.html` (`tpl-room` `#tabPlay`), `public/app.js` (`render()` + new `renderDailyUnlock`).

- [ ] **Step 1:** in `index.html`, inside `#tabPlay` after `<div id="messageRow" …></div>` (line 187), add:
```html
      <section id="dailyUnlock" class="daily-unlock" hidden>
        <div class="daily-goody" id="dailyGoody"></div>
        <article class="daily-story" id="dailyStory"></article>
        <div class="daily-bridge">
          <a href="/" class="btn primary block" id="dailyBridgeBtn">▶ Keep playing — back to the hub</a>
          <a href="/daily/archive" class="link" id="dailyArchiveLink">Browse past days →</a>
        </div>
      </section>
```
- [ ] **Step 2:** in `render()`, after the daily chrome block, call `if (game.isDaily) renderDailyUnlock(snap, me);`. Add the function (near `renderGames`):
```js
// The "underneath", revealed once you finish today's word: a goody line, the story behind
// the word, and a one-tap bridge back to the hub. Idempotent per snapshot.
// snap.story may be null (house day / World fetch failed) — goody + bridge still render.
function renderDailyUnlock(snap, me) {
  const box = $("#dailyUnlock");
  if (!box) return;
  const done = me && me.status !== "playing";
  box.hidden = !done;
  if (!done) return;
  const goody = $("#dailyGoody");
  if (goody && !goody.dataset.filled) {
    goody.textContent = me.status === "won"
      ? t("daily.goodySolved", { word: snap.word || "" })
      : t("daily.goodyMissed", { word: snap.word || "" });
    goody.dataset.filled = "1";
  }
  const story = $("#dailyStory");
  if (story && snap.story && !story.dataset.filled) {
    const h = document.createElement("h3"); h.textContent = snap.story.title || t("daily.storyFallbackTitle");
    const p = document.createElement("p"); p.textContent = snap.story.body || "";
    story.append(h, p);
    if (snap.story.tip) { const tip = document.createElement("p"); tip.className = "daily-tip"; tip.textContent = "💡 " + snap.story.tip; story.appendChild(tip); }
    story.dataset.filled = "1";
  }
  const bridge = $("#dailyBridgeBtn");
  if (bridge && !bridge.dataset.wired) { bridge.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); }); bridge.dataset.wired = "1"; }
  const arch = $("#dailyArchiveLink");
  if (arch && !arch.dataset.wired) { arch.addEventListener("click", (e) => { e.preventDefault(); navigate("/daily/archive"); }); arch.dataset.wired = "1"; }
}
```
- [ ] **Step 3:** smoke the full loop (play → finish → goody + story + bridge). `npm run typecheck`. Commit: `feat(daily): unlock panel — goody + story + keep-playing bridge`.

### Task F6: `/daily/archive` page + i18n strings

**Files:** Modify `public/app.js` (new `showDailyArchive`), `public/locales/en.js`.

- [ ] **Step 1:** add `showDailyArchive` (reuse `tpl-profile`'s single-column shell), near `showProfile`:
```js
async function showDailyArchive() {
  leaveRoom();
  mount("tpl-profile");
  const back = $("#profileBack"); if (back) back.onclick = (e) => { e.preventDefault(); navigate("/"); };
  document.title = "Wordul Daily — Archive";
  const mountEl = $("#profileMount");
  if (mountEl) mountEl.innerHTML = `<h1>${t("daily.archiveTitle")}</h1><ul class="daily-archive-list" id="dailyArchiveList"></ul>`;
  try {
    const res = await fetch("/api/daily/dates");
    const { dates } = res.ok ? await res.json() : { dates: [] };
    const list = $("#dailyArchiveList");
    if (list) for (const d of dates.slice().reverse()) {
      const li = document.createElement("li");
      const a = document.createElement("a"); a.href = `/daily/${d}`; a.textContent = d; a.className = "link";
      a.addEventListener("click", (e) => { e.preventDefault(); navigate(`/daily/${d}`); });
      li.appendChild(a); list.appendChild(li);
    }
  } catch { /* empty archive degrades to just the heading */ }
}
```
- [ ] **Step 2:** add to `public/locales/en.js` (match the file's existing key style):
```js
  "daily.entryTitle": "Today's Wordul.",
  "daily.entrySub": "One word. The whole world. Pick a username to play.",
  "daily.entryCta": "Play today →",
  "daily.boardTitle": "Wordul of the Day · {date}",
  "daily.goodySolved": "🎁 Solved it! The word was {word}. Here's your gold.",
  "daily.goodyMissed": "The word was {word}. A little gold for trying — come back tomorrow.",
  "daily.storyFallbackTitle": "The story behind the word",
  "daily.archiveTitle": "Every Wordul of the Day",
```
- [ ] **Step 3:** `npm test` + `npm run typecheck`; smoke `/daily/archive`. Commit: `feat(daily): archive index + i18n strings`.

### Phase F (REVISED) — note on minimal CSS
The unlock + daily chrome reuse existing classes (`btn primary`, `link`, `room-tab-panel`). Add a small `.daily-unlock { … }` / `.daily-story` / `.daily-tip` block to `public/style.css` (mirroring the hub's card styling) only if the default flow looks unstyled in smoke — keep it minimal; the hub's Glass Aurora tokens (`--bg-card`, `--border`, `--accent`) already exist.
