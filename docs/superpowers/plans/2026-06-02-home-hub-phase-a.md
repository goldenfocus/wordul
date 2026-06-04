# Home Hub — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-form home with a persistent hub shell + bottom nav whose landing tab ("The Daily") shows the theme-of-the-day, your real Gold + streak, and a Play CTA — ending the "dropped straight into a game" flow.

**Architecture:** A new `public/hub.js` owns the hub UI: a shell (identity bar + content area + bottom nav) that renders once, with instant client-side tab swaps of the content area only. The Daily panel is built from existing data (`/api/user/<name>` → gold + stats, the editions list, the recent-rooms data). Arena/Floor/Feed are honest "coming soon" stub panels so the nav is real from day one. A pure `dayTheme(date, ids)` picks the deterministic theme-of-the-day with no server.

**Tech Stack:** Vanilla ES modules in `public/` (no framework), Vitest + jsdom for the pure logic, `wrangler dev` for manual UI verification. Cloudflare Workers static assets.

**Spec:** `docs/superpowers/specs/2026-06-02-home-hub-phase-a-design.md`
**Visual source of truth:** the live prototype — fetch it for exact markup/CSS to adapt: `curl -s https://wordul.com/designs/hub-the-daily` (and `/designs/hub-the-arena|hub-the-floor|hub-the-feed` for stub-tab flavor).

---

## File Structure

- **Create** `public/hub.js` — the hub UI module: `renderHub`, nav + tab switching, `renderDaily`, the three stub panels, and `dayTheme`. Single responsibility: the hub.
- **Create** `test/daily.test.js` — unit tests for `dayTheme`.
- **Modify** `public/index.html` — add the hub shell markup to `tpl-home` (identity bar, `#hubContent`, bottom nav); keep the username field for new users.
- **Modify** `public/app.js` — route `showHome()` to render the hub; wire the Daily Play CTA + recent rooms + invite to existing flows; drop the replaced plain-form wiring.
- **Modify** `public/style.css` — hub shell, identity bar, bottom nav, Daily hero/cards, coming-soon panels (adapt from the prototype CSS). Mobile-first, reduced-motion safe.

The implementer should `git worktree`-isolate (the controller will set this up) since `app.js`/`style.css`/`index.html` are also edited by a parallel session.

---

## Task 1: `dayTheme` — deterministic theme-of-the-day (pure)

**Files:**
- Create: `public/hub.js` (initial — just `dayTheme` export for now)
- Test: `test/daily.test.js`

- [ ] **Step 1: Write the failing test** — create `test/daily.test.js`:

```js
import { describe, it, expect } from "vitest";
import { dayTheme } from "../public/hub.js";

const IDS = ["default", "yang", "jackpot", "arcade", "editorial", "tactile"];

describe("dayTheme", () => {
  it("is deterministic for a fixed date", () => {
    const d = new Date("2026-06-02T12:00:00Z");
    expect(dayTheme(d, IDS)).toBe(dayTheme(d, IDS));
  });
  it("never returns the default edition when others exist", () => {
    // sample 14 consecutive days — none should be "default"
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.UTC(2026, 5, 1 + i));
      expect(dayTheme(d, IDS)).not.toBe("default");
      expect(IDS).toContain(dayTheme(d, IDS));
    }
  });
  it("rotates across consecutive days", () => {
    const a = dayTheme(new Date(Date.UTC(2026, 5, 1)), IDS);
    const b = dayTheme(new Date(Date.UTC(2026, 5, 2)), IDS);
    expect(a).not.toBe(b); // adjacent days differ (pool length > 1)
  });
  it("returns 'default' when the pool is empty", () => {
    expect(dayTheme(new Date(), ["default"])).toBe("default");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/daily.test.js`
Expected: FAIL — cannot resolve `dayTheme` (file/exports don't exist yet).

- [ ] **Step 3: Create `public/hub.js` with `dayTheme`**

```js
// public/hub.js — the Wordul home hub: shell + bottom nav + The Daily landing.
// Other tabs (Arena/Floor/Feed) are honest stubs in Phase A. Pure helpers live here too.

// Deterministic featured edition for a given date: rotates through the non-default
// editions so every day has a "theme of the day" with no server. Same date -> same
// theme for everyone (UTC day boundary).
export function dayTheme(date, editionIds) {
  const pool = editionIds.filter((id) => id !== "default");
  if (pool.length === 0) return "default";
  const dayNumber = Math.floor(date.getTime() / 86400000);
  return pool[dayNumber % pool.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/daily.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add public/hub.js test/daily.test.js
git commit -m "feat(hub): deterministic theme-of-the-day (dayTheme) + tests"
```

---

## Task 2: Hub shell markup in `index.html`

**Files:**
- Modify: `public/index.html` (the `tpl-home` template)

- [ ] **Step 1: Read the current template + a prototype**

Read `public/index.html`'s `<template id="tpl-home">` block (the username field `#usernameInput`, `#startPlayingBtn`, `#homeRooms`/`#roomList`). Fetch the visual reference: `curl -s https://wordul.com/designs/hub-the-daily` — note its structure (identity bar, hero card, stat chips, bottom nav) for class/markup inspiration. Match the app's existing class conventions where they exist.

- [ ] **Step 2: Restructure `tpl-home` into the hub shell**

Inside `<template id="tpl-home">`, keep the new-user `#homeIntro` (username field) and `#homeGreeting` as-is, but wrap the post-identity experience in a hub shell. Add this structure (IDs are load-bearing — `app.js`/`hub.js` query them):

```html
<!-- Hub shell: persistent identity bar + swappable content + bottom nav. -->
<div id="hub" class="hub" hidden>
  <header class="hub-bar">
    <button id="avatarBtn" class="avatar-btn" type="button" aria-label="Menu" aria-haspopup="true">◆</button>
    <div class="hub-bar-stats">
      <span class="stat-chip" id="hubGold" title="Gold">◆ <span id="hubGoldVal">0</span></span>
      <span class="stat-chip" id="hubStreak" title="Streak">🔥 <span id="hubStreakVal">0</span></span>
    </div>
  </header>
  <main id="hubContent" class="hub-content"><!-- active tab panel renders here --></main>
  <nav class="hub-nav" role="tablist" aria-label="Hub sections">
    <button class="hub-tab is-active" data-tab="daily"  role="tab" aria-selected="true">🗞️<span>Daily</span></button>
    <button class="hub-tab"           data-tab="arena"  role="tab" aria-selected="false">⚡<span>Arena</span></button>
    <button class="hub-tab"           data-tab="floor"  role="tab" aria-selected="false">🃏<span>Floor</span></button>
    <button class="hub-tab"           data-tab="feed"   role="tab" aria-selected="false">👥<span>Feed</span></button>
  </nav>
</div>
```

Keep `#homeRooms`/`#roomList` available (The Daily panel will reuse the recent-rooms render; if the existing renderer targets `#roomList`, the Daily panel will contain a `#roomList` mount — see Task 4). Leave `#homeIntro`/`#homeGreeting` for the new-user gate.

- [ ] **Step 3: Sanity check (no test framework for HTML)**

Run: `node -e "const s=require('fs').readFileSync('public/index.html','utf8'); for (const id of ['hub','hubContent','hub-nav','avatarBtn','hubGoldVal','hubStreakVal']) if(!s.includes(id)) throw new Error('missing '+id); console.log('markup ok')"`
Expected: `markup ok`.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(hub): hub shell markup — identity bar, content area, bottom nav"
```

---

## Task 3: Hub render + nav + stub panels in `hub.js`

**Files:**
- Modify: `public/hub.js`

- [ ] **Step 1: Add the shell render, tab switching, and stub panels**

Append to `public/hub.js`. These functions render the shell once and swap only `#hubContent`. `renderDaily` is stubbed here and built in Task 4.

```js
let activeTab = "daily";

// Render a tab's panel HTML into #hubContent and sync nav highlight. The bar + nav
// never re-render — only the content area swaps, so switching is instant + flicker-free.
export function setTab(tab) {
  activeTab = tab;
  const content = document.getElementById("hubContent");
  if (!content) return;
  content.innerHTML = PANELS[tab] ? PANELS[tab]() : "";
  document.querySelectorAll(".hub-tab").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (tab === "daily") wireDaily(); // attach Daily's interactive handlers
}

// Honest "coming soon" stubs — real tabs so the hub feels whole, filled in later phases.
function stubPanel(emoji, title, line, extra = "") {
  return `<section class="hub-panel hub-stub">
    <div class="stub-emoji">${emoji}</div>
    <h2 class="stub-title">${title}</h2>
    <p class="stub-line muted">${line}</p>${extra}
  </section>`;
}

const PANELS = {
  daily: () => renderDaily(),
  arena: () => stubPanel("⚡", "The Arena", "Live games to join — coming soon."),
  floor: () => stubPanel("🃏", "The Floor", "Stake tables &amp; buy-ins — coming soon.",
    `<p class="stub-bankroll">Your bankroll: ◆ <span id="floorGold">${hubState.gold}</span></p>`),
  feed:  () => stubPanel("👥", "The Feed", "Your friends' games — coming soon.",
    `<button id="feedInvite" class="btn ghost">＋ Invite friends</button>`),
};

// Shared, hub-wide state the panels read (set on mount from the profile).
export const hubState = { gold: 0, streak: 0, username: "" };

// Mount the hub: fill the identity bar, render the default tab, wire the nav.
// callbacks: { onPlay(editionId), onInvite(), renderRecentRooms(mountEl), openMenu(anchor) }
export function renderHub(profile, callbacks) {
  hubState.gold = (profile && typeof profile.gold === "number") ? profile.gold : 0;
  hubState.streak = profile?.stats?.currentStreak ?? 0;
  hubState.username = callbacks.username ?? "";
  hubCallbacks = callbacks;

  const hub = document.getElementById("hub");
  if (hub) hub.hidden = false;
  const g = document.getElementById("hubGoldVal");
  const s = document.getElementById("hubStreakVal");
  if (g) g.textContent = String(hubState.gold);
  if (s) s.textContent = String(hubState.streak);

  document.querySelectorAll(".hub-tab").forEach((b) =>
    b.addEventListener("click", () => setTab(b.dataset.tab)));
  const avatar = document.getElementById("avatarBtn");
  if (avatar && callbacks.openMenu) avatar.addEventListener("click", () => callbacks.openMenu(avatar));

  setTab("daily");
}

let hubCallbacks = {};
```

- [ ] **Step 2: Add a temporary `renderDaily` placeholder so the module loads**

Add (replaced fully in Task 4):

```js
function renderDaily() { return `<section class="hub-panel" id="dailyPanel"></section>`; }
function wireDaily() { /* built in Task 4 */ }
```

- [ ] **Step 3: Verify the module parses + existing tests pass**

Run: `npm run typecheck` (clean) and `npx vitest run test/daily.test.js` (still 4 passing — `dayTheme` unaffected).
Expected: clean + PASS.

- [ ] **Step 4: Commit**

```bash
git add public/hub.js
git commit -m "feat(hub): shell render, tab switching, stub panels (Arena/Floor/Feed)"
```

---

## Task 4: The Daily panel

**Files:**
- Modify: `public/hub.js`
- Reference: `curl -s https://wordul.com/designs/hub-the-daily` for the hero/card/chip markup + classes to adapt.

- [ ] **Step 1: Implement `renderDaily` + `wireDaily`**

Replace the Task-3 placeholders. `renderDaily` returns the panel HTML (theme-of-the-day hero, identity line, recent-rooms mount, challenges teaser, companion quip). `wireDaily` attaches handlers after the HTML is in the DOM. It reads editions + the active companion line via globals the app exposes (passed through `hubCallbacks`). Adapt visual classes from the prototype; reuse existing app classes (`btn primary`, `muted`, etc.) where present.

```js
// Imported lazily to avoid a hard cycle: the app passes these in via renderHub callbacks.
//   hubCallbacks.editions  -> EDITIONS array [{id,name,...}]
//   hubCallbacks.editionName(id) -> display name
//   hubCallbacks.companionIdleLine() -> a personality string for the active edition
//   hubCallbacks.onPlay(editionId) -> apply edition + start a solo game
//   hubCallbacks.renderRecentRooms(mountEl) -> fill a recent-rooms list into mountEl
//   hubCallbacks.onInvite() -> existing invite/share flow

function renderDaily() {
  const ids = (hubCallbacks.editions ?? []).map((e) => e.id);
  const themeId = dayTheme(new Date(), ids.length ? ids : ["default"]);
  const themeName = hubCallbacks.editionName ? hubCallbacks.editionName(themeId) : themeId;
  const quip = hubCallbacks.companionIdleLine ? hubCallbacks.companionIdleLine() : "The board is waiting.";
  return `<section class="hub-panel daily" id="dailyPanel">
    <article class="daily-hero" data-theme="${themeId}">
      <span class="daily-kicker">Theme of the day</span>
      <h1 class="daily-theme-name">${themeName}</h1>
      <p class="daily-quip muted">${quip}</p>
      <button id="dailyPlay" class="btn primary block hero-btn">▶ Play today's word</button>
    </article>

    <div class="daily-stats">
      <span class="stat-card">◆ <strong>${hubState.gold}</strong><span class="muted">Gold</span></span>
      <span class="stat-card">🔥 <strong>${hubState.streak}</strong><span class="muted">Streak</span></span>
    </div>

    <section class="daily-challenges">
      <span class="section-label">Challenges</span>
      <div class="challenge-rail">
        <div class="challenge-card soon">Speed Round<span class="soon-badge">soon</span></div>
        <div class="challenge-card soon">6-Letter Friday<span class="soon-badge">soon</span></div>
      </div>
    </section>

    <section class="daily-recent" id="dailyRecent" hidden>
      <span class="section-label">Recent</span>
      <ul id="roomList" class="room-list"></ul>
    </section>
  </section>`;
}

function wireDaily() {
  const ids = (hubCallbacks.editions ?? []).map((e) => e.id);
  const themeId = dayTheme(new Date(), ids.length ? ids : ["default"]);
  const play = document.getElementById("dailyPlay");
  if (play && hubCallbacks.onPlay) play.addEventListener("click", () => hubCallbacks.onPlay(themeId));
  // Recent rooms: reuse the app's renderer; reveal the section only if it filled anything.
  const recent = document.getElementById("dailyRecent");
  const list = document.getElementById("roomList");
  if (recent && list && hubCallbacks.renderRecentRooms) {
    hubCallbacks.renderRecentRooms(list);
    if (list.children.length > 0) recent.hidden = false;
  }
  // Gentle gold count-up on first mount (reduced-motion safe).
  const goldEl = document.querySelector("#dailyPanel .stat-card strong");
  if (goldEl && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    countUp(goldEl, hubState.gold);
  }
}

function countUp(el, to) {
  const start = performance.now(), dur = 600, from = 0;
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = String(Math.round(from + (to - from) * t));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
```

- [ ] **Step 2: Verify module + tests**

Run: `npm run typecheck` (clean), `npx vitest run test/daily.test.js` (4 pass).
Expected: clean + PASS.

- [ ] **Step 3: Commit**

```bash
git add public/hub.js
git commit -m "feat(hub): The Daily panel — theme-of-day hero, stats, recent rooms, challenges teaser"
```

---

## Task 5: Wire the hub into `app.js`

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Read the current home wiring**

Read `showHome()` (~line 91), `renderHomeIdentity()` (~line 125), the `#startPlayingBtn` handler (~line 103, currently `enterNewRoom({ autoStart: false })`), the recent-rooms renderer (whatever fills `#roomList`), the invite/share handler, `getUsername()`, `applyEdition`/`getActiveEditionId` imports (line 5), and `openHub`/`showHub` (the avatar menu).

- [ ] **Step 2: Import the hub + editions helpers**

Add near the top imports:

```js
import { renderHub } from "/hub.js";
import { EDITIONS, getEdition } from "/editions/index.js";
```

- [ ] **Step 3: Route the home through the hub**

In `showHome()`, after `mount("tpl-home")` and the existing new-user/returning-user identity gate, when the user HAS a username, call `renderHub` instead of the old plain-form body. Pass the callbacks bridging to existing app flows:

```js
// After identity is resolved and we know there's a username:
const name = getUsername();
if (name) {
  fetch(`/api/user/${encodeURIComponent(name)}`)
    .then((r) => (r.ok ? r.json() : {}))
    .then((profile) => {
      renderHub(profile, {
        username: name,
        editions: EDITIONS,
        editionName: (id) => getEdition(id).name,
        companionIdleLine: () => {
          const lines = getEdition(getActiveEditionId()).companion?.lines?.idle ?? ["The board is waiting."];
          return lines[Math.floor(Date.now() / 86400000) % lines.length];
        },
        onPlay: (editionId) => { applyEdition(editionId); enterNewRoom({ autoStart: true }); },
        renderRecentRooms: (mountEl) => renderRecentRoomsInto(mountEl), // see Step 4
        onInvite: () => enterNewRoom({ autoStart: false }),
        openMenu: (anchor) => showHub(anchor), // existing avatar menu
      });
    })
    .catch(() => renderHub({}, { /* same callbacks; hub shows 0s */ username: name, editions: EDITIONS, editionName: (id) => getEdition(id).name, companionIdleLine: () => "The board is waiting.", onPlay: (id) => { applyEdition(id); enterNewRoom({ autoStart: true }); }, renderRecentRooms: () => {}, onInvite: () => enterNewRoom({ autoStart: false }), openMenu: (a) => showHub(a) }));
}
```

Note: `onPlay` uses `autoStart: true` because tapping "Play today's word" is a deliberate choice to play now — this is NOT the old problem (the problem was *landing* in a game; now you land on the hub and choose to play).

- [ ] **Step 4: Provide `renderRecentRoomsInto(mountEl)`**

If the existing recent-rooms renderer hard-codes `#roomList`, refactor it to take a mount element (or have it query `#roomList`, which now lives inside the Daily panel — either works since the markup keeps the `#roomList` id). Minimal version if a renderer already exists:

```js
function renderRecentRoomsInto(mountEl) {
  // Reuse the existing recent-rooms data + row builder; append rows to mountEl.
  // (Adapt to the existing renderer — it currently targets #roomList, which is now
  // inside the Daily panel, so calling the existing function may already work.)
}
```

If the existing function already targets `#roomList` by id, `renderRecentRooms` can simply call it and the function works unchanged — confirm by reading the current renderer and reuse it directly rather than duplicating.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` (clean), `npm test` (all pass — the hub is UI, no unit-test regressions; `dayTheme` tests still green).
Expected: clean + PASS.

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(hub): route home through the hub — land on The Daily, Play is a deliberate tap"
```

---

## Task 6: Hub styling

**Files:**
- Modify: `public/style.css`
- Reference: `curl -s https://wordul.com/designs/hub-the-daily` — lift the hero/chip/nav CSS and adapt to the app's CSS variables (`--bg`, `--fg`, `--muted`, `--border`, `--accent`, `--bg-card`, the gold/precious color).

- [ ] **Step 1: Add hub styles**

Append to `public/style.css`. Use the existing CSS custom properties (so it themes with every edition). Provide the structural rules; pull richer visual detail (gradients, glow) from the prototype:

```css
/* --- Home hub --- */
.hub { display: flex; flex-direction: column; min-height: 100dvh; }
.hub-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; }
.hub-bar-stats { display: flex; gap: 8px; }
.stat-chip { font-size: 13px; color: var(--fg); background: var(--bg-card, #17171a);
  border: 1px solid var(--border); border-radius: 999px; padding: 5px 10px; }
.hub-content { flex: 1; padding: 8px 14px 84px; } /* bottom pad clears the nav */

.hub-nav { position: fixed; left: 0; right: 0; bottom: 0; display: flex;
  background: var(--bg-card, #17171a); border-top: 1px solid var(--border); }
.hub-tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: none; border: 0; color: var(--muted); font-size: 11px; padding: 9px 0; cursor: pointer; }
.hub-tab span { font-family: var(--font-body); }
.hub-tab.is-active { color: var(--accent); }
@media (min-width: 720px) { .hub-nav { position: sticky; max-width: 560px; margin: 0 auto;
  border: 1px solid var(--border); border-radius: 999px; bottom: 16px; } }

/* The Daily */
.daily-hero { background: var(--bg-card, #17171a); border: 1px solid var(--border);
  border-radius: 18px; padding: 22px; margin: 12px 0; }
.daily-kicker { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
.daily-theme-name { font-family: var(--font-display); font-size: 34px; margin: 6px 0 4px; }
.daily-stats { display: flex; gap: 10px; margin: 12px 0; }
.stat-card { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: var(--bg-card, #17171a); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
.stat-card strong { font-family: var(--font-display); font-size: 24px; }
.section-label { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.challenge-rail { display: flex; gap: 10px; overflow-x: auto; padding: 8px 0; }
.challenge-card { position: relative; min-width: 130px; padding: 16px; border-radius: 14px;
  background: var(--bg-card, #17171a); border: 1px solid var(--border); }
.challenge-card.soon { opacity: .7; }
.soon-badge { position: absolute; top: 8px; right: 8px; font-size: 9px; text-transform: uppercase;
  color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 1px 6px; }

/* Stub panels (Arena/Floor/Feed) */
.hub-stub { text-align: center; padding: 56px 16px; }
.stub-emoji { font-size: 40px; }
.stub-title { font-family: var(--font-display); font-size: 26px; margin: 8px 0 4px; }

@media (prefers-reduced-motion: reduce) { .hub-tab, .challenge-card { transition: none !important; } }
```

- [ ] **Step 2: Manual visual verification**

Run: `npx wrangler dev --port 8820 --local`. In the browser set `localStorage['wr.username']='tester'`, load `http://localhost:8820/`. Verify:
- You land on **The Daily** (not a started game); the hero shows the theme-of-the-day name = `dayTheme(today)`.
- ◆ Gold and 🔥 Streak in the bar + stat cards show the profile's real values (0 for a fresh account; gold counts up).
- Bottom nav switches Daily/Arena/Floor/Feed **instantly**; the bar stays fixed; Arena/Floor/Feed show their "coming soon" panels (Floor shows the bankroll).
- "Play today's word" applies that theme and starts a game.
- Toggle OS reduced-motion → no transitions/count-up.
Kill the dev server when done (`pkill -f "wrangler dev --port 8820"`).

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "feat(hub): hub + Daily styling (themes via CSS vars, reduced-motion safe)"
```

---

## Self-Review

**Spec coverage:**
- Persistent shell (bar + nav + content swap) → Tasks 2, 3. ✓
- The Daily landing (theme-of-day, gold, streak, Play CTA, recent rooms, challenges teaser, companion quip) → Task 4. ✓
- Deterministic theme-of-the-day, no server → Task 1. ✓
- Arena/Floor/Feed honest stubs → Task 3. ✓
- End "dropped into a game" (land on hub, Play is deliberate) → Task 5 Step 3. ✓
- Smooth (shell renders once, content-only swap) → Task 3 `setTab`. ✓
- Reduced-motion safe → Task 4 count-up guard + Task 6 media query. ✓
- No new server endpoints (reuse `/api/user`, editions, recent rooms) → Task 5. ✓
- Tests for `dayTheme` → Task 1. ✓

**Type/identifier consistency:** `dayTheme`, `renderHub`, `setTab`, `hubState`, `hubCallbacks`, `renderDaily`, `wireDaily`, panel ids (`hub`, `hubContent`, `hubGoldVal`, `hubStreakVal`, `dailyPlay`, `dailyRecent`, `roomList`) are defined in early tasks and reused consistently in later tasks.

**Notes for the implementer:**
- The prototype `hub-the-daily.html` is the visual target — fetch it and adapt its richer styling; the plan's CSS is the structural baseline, not a ceiling.
- If the existing recent-rooms renderer already targets `#roomList`, reuse it directly (the id now lives inside the Daily panel) instead of writing `renderRecentRoomsInto`.
- `onPlay` uses `autoStart: true` on purpose — that's a deliberate "play now" tap, not the old auto-land-in-game bug.
- **XSS guard:** the panel `innerHTML` only interpolates app-controlled data (edition names, companion lines, numbers) — safe. Any *user-controlled* string (usernames, room names) must be inserted via `textContent` / `createElement`, never string-concatenated into `innerHTML`. The recent-rooms renderer is reused as-is (it already handles room names); do not introduce new `innerHTML` of user data.
