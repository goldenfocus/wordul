# Swipe to Previous WOTD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the home daily card into a horizontal carousel so you can swipe / arrow back through every past Wordul — each past day showing the answer, that day's stats, and (if you played it) your solve stamp + an animated replay.

**Architecture:** One tiny new past-only server route (`GET /api/daily/word`) reveals a past day's answer + theme. Everything else reuses what's already shipped: `profile.games` for your result/replay, `/api/daily/<date>/leaderboard` + `computeDailyStatsFromRoster` for the stats line (matches the stats page exactly), and `renderStamp` + `stamp-replay.js` for the animated replay. A small client controller (`daily-carousel.js`) owns offset state, arrows, swipe, and lazy per-day fetch+cache; a pure renderer (`daily-past.js`) draws each past card.

**Tech Stack:** Cloudflare Workers + Durable Objects (TypeScript), vanilla ES-module front-end, vitest (+ jsdom for DOM tests).

**Spec:** `docs/superpowers/specs/2026-06-08-wotd-swipe-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/daily.ts` | Daily DO: add `/word` past-only handler | Modify |
| `src/worker.ts` | Expose `GET /api/daily/word` → Daily DO | Modify |
| `test/daily-word.test.ts` | DO handler: past returns word, today/future refused | Create |
| `public/daily-past.js` | Pure `renderPastDailyCard()` + `clampOffset()` | Create |
| `test/daily-past.test.js` | Render branches + clamp logic | Create |
| `public/daily-carousel.js` | Controller: offset state, arrows, swipe, lazy fetch/cache, replay wiring | Create |
| `public/hub.js` | Mount carousel header (arrows) + slot around the daily card | Modify |
| `public/app.js` | Generalize `dailyResultFor(profile,date)`; pass carousel deps into the hub | Modify |
| `public/locales/en.js` | New user-facing strings (single locale) | Modify |
| `public/style.css` | Arrow controls, past-card, swipe affordance | Modify |

---

## Task 1: Server — past-only `/word` handler on the Daily DO

**Files:**
- Modify: `src/daily.ts` (add a handler next to `/resolve` and `/dates`)
- Test: `test/daily-word.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/daily-word.test.ts` (mirrors the DO-mock pattern in `test/daily-board-unlock.test.ts`):

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class DurableObject {
    ctx: unknown; env: unknown;
    constructor(ctx: unknown, env: unknown) { this.ctx = ctx; this.env = env; }
  },
}));

import { Daily } from "../src/daily.ts";

function makeDaily() {
  const store = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: async (k: string) => store.get(k),
      put: async (k: string, v: unknown) => { store.set(k, v); },
    },
  };
  // DAILY_SALT unset → strict no-op salt (house words), matches prod-with-no-secret.
  return new Daily(ctx as never, {} as never);
}

const get = (d: Daily, date: string) =>
  d.fetch(new Request(`https://do/word?date=${date}`, { method: "GET" }));

describe("Daily /word (past-only answer reveal)", () => {
  it("returns the word + themeId for a past date", async () => {
    const res = await get(makeDaily(), "2026-06-01");
    expect(res.status).toBe(200);
    const body = await res.json() as { date: string; word: string; themeId: string };
    expect(body.date).toBe("2026-06-01");
    expect(body.word).toMatch(/^[A-Z]+$/);        // a real uppercase answer
    expect(typeof body.themeId).toBe("string");
  });

  it("refuses a far-future date (no live/future answer leak)", async () => {
    const res = await get(makeDaily(), "2999-12-31");
    expect(res.status).toBe(404);
  });

  it("refuses a malformed date", async () => {
    const res = await get(makeDaily(), "nope");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-word.test.ts`
Expected: FAIL — the DO returns a 404/`not found` for `/word` (handler absent), so the "past date" case fails on `status === 200`.

- [ ] **Step 3: Write minimal implementation**

In `src/daily.ts`, add this handler immediately after the `/dates` block (it already imports `activeDate`, `resolveWorld`, `saltForDate`, and `SALT_FROM` is in scope):

```ts
    // Past-only answer reveal for the home carousel. NEVER today or future — same
    // leak rule as /resolve's archive guard (no live answer, no gold-farm seeding).
    // Returns the curated/house word + design edition for a day already played out.
    if (req.method === "GET" && url.pathname === "/word") {
      const date = url.searchParams.get("date") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= activeDate(Date.now())) {
        return new Response("not a past date", { status: 404 });
      }
      const state = await this.load();
      const salt = saltForDate(date, this.env.DAILY_SALT, SALT_FROM);
      const world = resolveWorld(state.schedule, date, Date.now(), salt);
      return Response.json({ date, word: world.word, themeId: world.edition });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-word.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/daily.ts test/daily-word.test.ts
git commit -m "feat(daily): past-only /word handler reveals a past day's answer + theme"
```

---

## Task 2: Server — expose `GET /api/daily/word`

**Files:**
- Modify: `src/worker.ts` (mirror the `/api/daily/dates` route at ~line 574)

- [ ] **Step 1: Add the route**

In `src/worker.ts`, directly below the existing `/api/daily/dates` block:

```ts
    if (url.pathname === "/api/daily/word") {
      const date = url.searchParams.get("date") || "";
      const stub = env.DAILY.get(env.DAILY.idFromName("daily"));
      return stub.fetch(new Request(`https://do/word?date=${encodeURIComponent(date)}`, { method: "GET" }));
    }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Manual verify against the route shape**

Run the full suite to confirm nothing regressed: `npm test`
Expected: PASS. (The forwarding route is a 3-line mirror of `/dates`; the DO logic it forwards to is covered by Task 1. Live behaviour is verified in Task 9.)

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat(daily): route GET /api/daily/word to the Daily DO"
```

---

## Task 3: Client — pure past-card renderer + offset clamp

**Files:**
- Create: `public/daily-past.js`
- Test: `test/daily-past.test.js`

`renderPastDailyCard` is a pure function returning an HTML string. It renders the
answer + stats always; the solve stamp + result line + Watch-replay button only when the
caller passes `myRecord`; otherwise a "Play it" affordance. `clampOffset` bounds the
carousel index.

- [ ] **Step 1: Write the failing test**

Create `test/daily-past.test.js`:

```js
import { describe, it, expect } from "vitest";
import { renderPastDailyCard, clampOffset } from "../public/daily-past.js";

const stats = { played: 1204, winRate: 71 };
const base = { date: "2026-06-07", themeName: "Aurora", word: "CRANE", stats };

describe("clampOffset", () => {
  it("never goes past today (0) or before the oldest day", () => {
    expect(clampOffset(2, 5)).toBe(0);        // future clamped to today
    expect(clampOffset(-99, 5)).toBe(-4);     // oldest is -(n-1)
    expect(clampOffset(-3, 5)).toBe(-3);      // in range passes through
  });
});

describe("renderPastDailyCard", () => {
  it("always reveals the answer and the day's stats", () => {
    const html = renderPastDailyCard({ ...base, myRecord: null });
    expect(html).toContain("CRANE");
    expect(html).toContain("1,204");          // thousands-formatted played
    expect(html).toContain("71%");
  });

  it("shows a Play-it affordance when I did not play that day", () => {
    const html = renderPastDailyCard({ ...base, myRecord: null });
    expect(html).toContain("data-past-play");
    expect(html).not.toContain("data-past-replay");
  });

  it("shows my stamp + replay button when I played that day", () => {
    const myRecord = { won: true, guesses: 4, solveGrid: ["ggggg"], solveWords: ["CRANE"] };
    const html = renderPastDailyCard({ ...base, myRecord });
    expect(html).toContain("daily-stamp");    // renderStamp output
    expect(html).toContain("data-past-replay");
    expect(html).toContain("4/6");            // result line (board rows for a 5-letter word)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily-past.test.js`
Expected: FAIL — module `public/daily-past.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `public/daily-past.js`:

```js
// public/daily-past.js — pure render for ONE past day's card in the home carousel.
// Answer + that day's stats are always shown; the solve stamp + replay appear only when
// the viewer played that day (myRecord present), else a "Play it" link. No DOM, no fetch
// — the carousel owns data + wiring; this only turns data into markup (unit-tested).
import { renderStamp, boardRows } from "/daily-card.js";

// Carousel index lives in (-(n-1) .. 0): 0 = today, -1 = yesterday, oldest = -(n-1).
export function clampOffset(offset, n) {
  const oldest = -(Math.max(1, n) - 1);
  return Math.max(oldest, Math.min(0, offset));
}

const fmt = (x) => Number(x).toLocaleString("en-US");

// The answer + theme are off-the-wire (server-curated, but never trust the wire as markup
// — same posture as renderDailyStatsReveal). Escape before interpolating into the string.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// opts: { date, themeName, word, stats:{played,winRate}, myRecord:{won,guesses,solveGrid,solveWords}|null }
export function renderPastDailyCard({ date, themeName, word, stats, myRecord }) {
  const cols = myRecord?.solveGrid?.[0] ? String(myRecord.solveGrid[0]).length : 5;
  const rows = boardRows(cols);                       // full-board height for this word length

  const hero = myRecord
    ? `<div class="daily-stamp-hero ${myRecord.won ? "is-won" : "is-lost"}">
         ${renderStamp(myRecord.solveGrid, myRecord.solveWords, rows)}
         <span class="past-result">${myRecord.won ? `${myRecord.guesses}/${rows}` : "✗"}</span>
       </div>`
    : "";

  const safeWord = esc(word);
  const wikiSlug = encodeURIComponent(String(word).toLowerCase());

  const action = myRecord
    ? `<button type="button" class="btn ghost small" data-past-replay>▶ Watch replay</button>`
    : `<button type="button" class="btn primary small" data-past-play data-date="${esc(date)}">Play it →</button>`;

  const played = stats?.played ?? 0;
  const winRate = stats?.winRate;
  const statsLine = played > 0
    ? `<p class="past-stats muted small">${fmt(played)} played · ${winRate == null ? "—" : winRate + "%"} solved</p>`
    : `<p class="past-stats muted small">No finishers recorded.</p>`;

  return `<article class="daily-card daily-past" data-date="${esc(date)}">
    ${hero}
    <p class="past-answer"><span class="past-answer-label">Answer</span> <a class="past-answer-word" href="/word/${wikiSlug}" data-past-wiki data-word="${safeWord}">${safeWord}</a></p>
    ${statsLine}
    <div class="past-actions">
      ${action}
      <button type="button" class="link past-stats-link" data-past-stats data-date="${esc(date)}">Stats ›</button>
    </div>
  </article>`;
}
```

Note: `renderStamp` and `boardRows` are existing exports of `public/daily-card.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily-past.test.js`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add public/daily-past.js test/daily-past.test.js
git commit -m "feat(daily): pure renderer + offset clamp for past-day carousel cards"
```

---

## Task 4: Client — generalize `dailyResultFor` to any date

**Files:**
- Modify: `public/app.js` (the `dailyResultFor` function, ~line 341)

`dailyResultFor(profile)` already extracts today's stamp record from `profile.games` by
`roomPath`. Generalize it so the carousel can ask for any past day. Today's caller keeps
working via the default.

- [ ] **Step 1: Change the signature + body**

Replace `const date = todayUTC();` inside `dailyResultFor` so the function takes an optional date:

```js
function dailyResultFor(profile, date = todayUTC()) {
  const g = (profile?.games || []).find((x) => x.roomPath === "daily/" + date);
  if (!g) return null;
```

(The rest of the function — the localStorage letter merge keyed by `${LS.dailySolve}:${date}` and the `return { won, guesses, solveGrid, solveWords }` — is unchanged and already uses the `date` variable.)

- [ ] **Step 2: Typecheck + tests**

Run: `npm run typecheck && npx vitest run test/daily-recover.test.js test/hub-home.test.js`
Expected: PASS (today's path unaffected — the default arg preserves it).

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "refactor(daily): dailyResultFor takes an optional date for past lookups"
```

---

## Task 5: Client — the carousel controller

**Files:**
- Create: `public/daily-carousel.js`

Owns offset state, the `‹ ›` arrows, touch swipe, lazy per-day fetch+cache, and dispatch
between the persistent today card (offset 0) and a freshly rendered past card (offset < 0).
Data comes in via injected deps so it stays decoupled from app.js internals; stats + replay
reuse shipped modules directly.

- [ ] **Step 1: Write the module**

Create `public/daily-carousel.js`:

```js
// public/daily-carousel.js — the home daily card as a day carousel. Offset 0 = today
// (the existing card, never destroyed — just hidden when you swipe away). Offset < 0 =
// a past day, rendered fresh on landing and cached. Arrows + touch-swipe step one day;
// forward clamps at today, back goes to day one. Stats reuse the roster reducer so the
// numbers match the /daily/<date>/stats page exactly; replay reuses the stamp-replay path.
import { computeDailyStatsFromRoster } from "/daily-stats.js";
import { playStampReplay, wireStampReplays } from "/stamp-replay.js";
import { renderPastDailyCard, clampOffset } from "/daily-past.js";
import { t } from "/i18n.js";

const SWIPE_MIN = 40; // px of horizontal intent before a swipe counts

// deps: { dates:string[], shortDate(date)->str, themeName(date)->str,
//         pastRecord(date)->myRecord|null, navigate(path), onPlayDate(date) }
export function initDailyCarousel(root, deps) {
  const header = root.querySelector("#dailyCarHead");
  const slot = root.querySelector("#dailyCarSlot");
  const todayEl = root.querySelector("#dailyToday");
  const pastEl = root.querySelector("#dailyPast");
  const prevBtn = root.querySelector("#dailyPrev");
  const nextBtn = root.querySelector("#dailyNext");
  const label = root.querySelector("#dailyCarDate");
  if (!slot || !todayEl || !pastEl) return;

  const dates = deps.dates.slice().sort();           // ascending; last = today
  const n = dates.length;
  const cache = new Map();                            // date -> { word, stats }
  let offset = 0;

  const dateAt = (off) => dates[n - 1 + off];        // off 0 -> today

  async function fetchDay(date) {
    if (cache.has(date)) return cache.get(date);
    const [wordRes, lbRes] = await Promise.all([
      fetch(`/api/daily/word?date=${date}`).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/daily/${date}/leaderboard?full=1&username=`).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]);
    const stats = lbRes ? computeDailyStatsFromRoster(lbRes) : { played: 0, winRate: null };
    const day = { word: wordRes?.word || "", themeId: wordRes?.themeId || "", stats };
    cache.set(date, day);
    return day;
  }

  function render() {
    offset = clampOffset(offset, n);
    const date = dateAt(offset);
    if (label) label.textContent = deps.shortDate(date);
    if (prevBtn) prevBtn.disabled = offset <= -(n - 1);
    if (nextBtn) nextBtn.hidden = offset === 0;       // today is the right edge

    if (offset === 0) {
      todayEl.hidden = false;
      pastEl.hidden = true;
      pastEl.innerHTML = "";
      return;
    }
    todayEl.hidden = true;
    pastEl.hidden = false;
    pastEl.innerHTML = `<p class="muted small past-loading">${t("daily.loadingDay")}</p>`;
    fetchDay(date).then((day) => {
      if (dateAt(offset) !== date) return;            // swiped away mid-fetch
      pastEl.innerHTML = renderPastDailyCard({
        date, themeName: deps.themeName(date), word: day.word,
        stats: day.stats, myRecord: deps.pastRecord(date),
      });
      wirePast(date);
    });
  }

  function wirePast(date) {
    wireStampReplays(pastEl);                          // stamp tap → replay
    pastEl.querySelector("[data-past-replay]")?.addEventListener("click", () => {
      const stamp = pastEl.querySelector(".daily-stamp");
      if (stamp) playStampReplay(stamp);
    });
    pastEl.querySelector("[data-past-play]")?.addEventListener("click", () => deps.onPlayDate(date));
    pastEl.querySelector("[data-past-stats]")?.addEventListener("click", () => deps.navigate(`/daily/${date}/stats`));
    pastEl.querySelector("[data-past-wiki]")?.addEventListener("click", (e) => {
      e.preventDefault();
      deps.navigate(`/word/${String(e.currentTarget.getAttribute("data-word")).toLowerCase()}`);
    });
  }

  const step = (d) => { offset = clampOffset(offset + d, n); render(); };
  prevBtn?.addEventListener("click", () => step(-1));  // older
  nextBtn?.addEventListener("click", () => step(1));   // newer

  // Touch swipe, scoped to the card slot so the Worlds strip below still scrolls.
  let x0 = null, y0 = null;
  slot.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  slot.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return; // not a horizontal swipe
    step(dx < 0 ? -1 : 1);                              // swipe left → older, right → newer
  }, { passive: true });

  render();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (No callers yet — wired in Task 6. If the typechecker flags the unused module, that's resolved by Task 6 importing it.)

- [ ] **Step 3: Commit**

```bash
git add public/daily-carousel.js
git commit -m "feat(daily): day-carousel controller — arrows, swipe, lazy fetch, replay"
```

---

## Task 6: Client — mount the carousel in the hub

**Files:**
- Modify: `public/hub.js` (wrap the daily header + card; init the carousel)
- Modify: `public/app.js` (pass `editions`/`editionName` already exist; add nothing new — hub reads `hubCallbacks`)

- [ ] **Step 1: Restructure `renderDaily()` markup**

In `public/hub.js`, change the daily panel so the header carries arrows + a date label and the card sits in a slot with a persistent today element and an empty past element. Replace the existing `<header class="daily-head">…</header>` and the `${renderDailyCard(...)}` line with:

```js
  return `<section class="hub-panel daily" id="dailyPanel">
    <div id="dailyCarousel">
      <header class="daily-head" id="dailyCarHead">
        <button type="button" class="daily-arrow" id="dailyPrev" aria-label="${t("daily.prevDay")}">‹</button>
        <div class="daily-head-mid">
          <span class="daily-kicker">${themeName}</span>
          <h1 class="daily-date" id="dailyCarDate">${shortDate(new Date())}</h1>
        </div>
        <button type="button" class="daily-arrow" id="dailyNext" aria-label="${t("daily.nextDay")}" hidden>›</button>
      </header>
      <div id="dailyCarSlot">
        <div id="dailyToday">${renderDailyCard({ themeId, result: hubCallbacks.dailyResult ?? null })}</div>
        <div id="dailyPast" hidden></div>
      </div>
    </div>
```

(Keep the rest of `renderDaily()` — the `hub-modes`, `hub-worlds`, and `daily-recent`
sections — exactly as is. `hub.js` has no `t` import today; Step 2 adds it.)

- [ ] **Step 2: Add imports in `wireDaily()`**

At the top of `public/hub.js`, add to the imports (`hub.js` currently imports `GLYPH`,
`daily-card`, `worlds.js`, `world-card.js` — neither `t` nor the carousel yet):

```js
import { t } from "/i18n.js";
import { initDailyCarousel } from "/daily-carousel.js";
```

At the **end** of `wireDaily()` (after the existing `wireDailyCard(...)` call), add:

```js
  const car = document.getElementById("dailyCarousel");
  if (car && Array.isArray(hubCallbacks.dailyDates) && hubCallbacks.dailyDates.length > 1) {
    initDailyCarousel(car, {
      dates: hubCallbacks.dailyDates,
      shortDate: (d) => shortDate(new Date(`${d}T00:00:00Z`)),
      themeName: (d) => (hubCallbacks.editionName ? hubCallbacks.editionName(hubCallbacks.dayEdition?.(d) || "default") : "default"),
      pastRecord: (d) => hubCallbacks.pastRecord?.(d) ?? null,
      navigate: (p) => hubCallbacks.navigate?.(p),
      onPlayDate: (d) => hubCallbacks.onPlayDate?.(d),
    });
  }
```

- [ ] **Step 3: Provide the new callbacks from app.js**

In `public/app.js`, where `renderHub` is called with the callbacks object (the block that
already sets `editions: EDITIONS, editionName: (id) => getEdition(id).name`), add:

```js
      dailyDates: [],                                   // filled below, async
      pastRecord: (date) => dailyResultFor(profile, date),
      navigate: (p) => navigate(p),
      onPlayDate: (date) => navigate(`/daily/${date}`),
```

Then, right after `renderHub(profile, cbs);`, kick off the dates fetch and re-init if a
multi-day history exists:

```js
      fetch("/api/daily/dates").then((r) => r.ok ? r.json() : { dates: [] }).then(({ dates }) => {
        cbs.dailyDates = Array.isArray(dates) ? dates : [];
        const car = document.getElementById("dailyCarousel");
        if (car && cbs.dailyDates.length > 1) renderHub(profile, cbs); // re-render now that we know the history depth
      }).catch(() => {});
```

(`dailyResultFor` is the Task-4 generalized function; `navigate` and `getEdition` are
existing app.js functions. `profile` is in scope in this callback.)

- [ ] **Step 4: Typecheck + existing hub test**

Run: `npm run typecheck && npx vitest run test/hub-home.test.js`
Expected: PASS. If `hub-home.test.js` asserts on the old `.daily-head` structure, update those assertions to the new `#dailyCarHead` markup (the daily card itself is unchanged inside `#dailyToday`).

- [ ] **Step 5: Commit**

```bash
git add public/hub.js public/app.js
git commit -m "feat(daily): mount the day carousel on the home hub"
```

---

## Task 7: i18n strings

**Files:**
- Modify: `public/locales/en.js` (single locale in this repo)

- [ ] **Step 1: Add the keys**

In `public/locales/en.js`, alongside the other `daily.*` keys:

```js
  "daily.prevDay": "Previous day",
  "daily.nextDay": "Next day",
  "daily.loadingDay": "Loading that day…",
```

- [ ] **Step 2: Verify i18n completeness**

Run: `npm test` (the suite includes i18n/locale checks if present)
Expected: PASS — no missing-key warnings for the new strings.

- [ ] **Step 3: Commit**

```bash
git add public/locales/en.js
git commit -m "feat(daily): i18n strings for the day carousel"
```

---

## Task 8: Styles

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add carousel + past-card styles**

Append to `public/style.css` (near the other `.daily-*` rules):

```css
/* Day carousel: arrows flank the date; the slot holds today's card or a past one. */
.daily-head { display: flex; align-items: center; gap: 0.5rem; }
.daily-head-mid { flex: 1 1 auto; text-align: center; }
.daily-arrow {
  flex: 0 0 auto; width: 2.25rem; height: 2.25rem; border-radius: 999px;
  border: 1px solid var(--hairline, rgba(255,255,255,0.14)); background: transparent;
  color: inherit; font-size: 1.4rem; line-height: 1; cursor: pointer;
}
.daily-arrow:disabled { opacity: 0.25; cursor: default; }
.daily-arrow[hidden] { display: none; }

#dailyCarSlot { position: relative; }
.daily-past { text-align: center; }
.daily-past .past-answer { margin: 0.75rem 0 0.25rem; font-size: 1.15rem; }
.daily-past .past-answer-label { letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.7rem; opacity: 0.6; }
.daily-past .past-answer-word { font-family: var(--font-display); font-weight: 700; letter-spacing: 0.12em; }
.daily-past .past-stats { margin: 0.25rem 0 0.75rem; }
.daily-past .past-actions { display: flex; gap: 0.75rem; justify-content: center; align-items: center; }
.daily-stamp-hero .past-result { display: block; margin-top: 0.25rem; font-weight: 600; }
```

- [ ] **Step 2: Build sanity**

Run: `npm run typecheck`
Expected: PASS (CSS-only change; nothing to typecheck, but confirms no accidental JS edit).

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style(daily): arrows + past-card carousel styling"
```

---

## Task 9: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full test suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS — including the new `daily-word` and `daily-past` tests and the unchanged `ios-input-zoom` guard (no new inputs added).

- [ ] **Step 2: Local dev manual check**

Run: `npm run dev`, open the hub. Verify:
- The daily header shows `‹ <date> ›` with `›` hidden at today.
- Tapping `‹` (and left-swipe on a touch device / emulator) steps back a day: a past card appears with the answer + "N played · X% solved".
- A day you played shows your stamp + "▶ Watch replay" (tap animates the stamp); the stamp tap also replays.
- A day you didn't play shows "Play it →" → navigates to `/daily/<date>`.
- `›` / right-swipe returns toward today and clamps there (never a future word).
- "Stats ›" → `/daily/<date>/stats`; the answer word → `/word/<word>`.

- [ ] **Step 3: Answer-leak guard (manual)**

In the dev console: `fetch('/api/daily/word?date=' + new Date().toISOString().slice(0,10)).then(r=>console.log('today:', r.status))` → expect **404**. A clearly-past date → 200 with `{word}`.

- [ ] **Step 4: Ship**

Per repo rules, deploy only via the ship pipeline (tests → rebase → CI deploys origin/main):

```bash
bash dev/ship.sh
```

Then post the Post-Deploy Summary and run the prod smoke (bot-named browser per the
CLAUDE.md identity rule), confirming the swipe + arrows work on `wordul.com`.

---

## Notes for the implementer

- **Reuse, don't reinvent:** `renderStamp`/`boardRows` (`daily-card.js`),
  `computeDailyStatsFromRoster` (`daily-stats.js`), `playStampReplay`/`wireStampReplays`
  (`stamp-replay.js`) are all existing exports — import them, don't duplicate.
- **The today card is never destroyed** — offset 0 just toggles `#dailyToday` visibility,
  so its wiring (play, fetchPlayed, countdown) stays intact across swipes.
- **Stats must match the stats page**, which is why the card calls the *leaderboard*
  endpoint + `computeDailyStatsFromRoster`, not the science endpoint.
- **Theme per past day** comes from the server (`World.edition` via `/api/daily/word`),
  not the client `dayTheme` stub. `hub.js` currently derives `themeName` from `dayEdition`;
  if no `dayEdition` callback exists, fall back to `"default"` (Task 6 already does).
- **Verify the landed branch** before claiming done (`git log`, `npm test`) — do not trust
  step names alone.
```
