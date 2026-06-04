# Worlds Browse Surfaces (Plan 2 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Worlds *browsable* — a themed-card strip on the home page and a full `/worlds` theater, each card self-painted in its World's skin, plus SEO meta for `/w/<slug>` and `/worlds`, and binding a World's skin into the solo room you launch from it.

**Architecture:** Plan 1 shipped the `WORLDS` registry, `/w/<slug>`, and try-on skins. Plan 2 adds the discovery front-ends over that registry. A new per-element painter (`paintEditionVars`) lets many cards each wear a *different* edition simultaneously (the global `applyEdition` writes `<html>`; cards need scoped vars). A `world-card.js` module renders one themed card (reused by the home strip and the `/worlds` theater). The theater is a new client route `/worlds` (worker serves the SPA shell, same as `/w/<slug>`). SEO meta reuses the existing `HTMLRewriter` + `data-meta` pattern in `src/worker.ts`.

**Tech Stack:** Cloudflare Workers (`src/worker.ts`), vanilla ES-module client (`public/*.js`), Vitest (`test/*.test.{ts,js}`). No new dependencies.

**Builds on Plan 1 (must be merged first):** `src/worlds.ts` + `public/worlds.js` (`WORLDS`, `listWorlds`, `featuredWorlds`, `getWorld`, `worldSlugFromPath`), `public/edition.js` (`applyEdition(id,{persist})`, `setDefaultEdition`, `getEdition` via `/editions/index.js`), `showWorld` in `public/app.js`, and the `WORLD_RE` worker serve branch.

**Scope notes — deferred:**
- **Live player counts + the "Active" tab** → **Plan 2b.** Needs `world/<slug>` live rooms seeded by the Arena liquidity bots + the Arena DIRECTORY wiring for per-World counts. Plan 2 ships tabs **Featured · All · Mine** (no Active). The card component is built so Plan 2b can drop a live-count badge in without restructuring.
- **Admin edit + KV overrides** → Plan 3.
- **Per-World streaks** → future.

**Naming:** Reuse `WorldDef`. The per-element painter is `paintEditionVars(el, id)` (distinct from the global `applyEdition`).

---

### Task 1: Per-element edition painter (`paintEditionVars`)

**Files:**
- Modify: `public/edition.js` (add `paintEditionVars`, export it)
- Test: `test/edition.test.js`

**Why:** `applyEdition` writes CSS vars on `<html>` — global, one theme at a time. A wall of World cards needs each card painted in its *own* edition's chrome simultaneously. `paintEditionVars(el, id)` sets the edition's chrome palette + display font as inline custom properties on a single element, so `var(--accent)` etc. resolve locally for that card and its descendants. Does NOT touch localStorage or `<html>`.

- [ ] **Step 1: Write the failing test**

Append to `test/edition.test.js` (new `describe` at end of file):

```js
import { paintEditionVars } from "/edition.js";
import { getEdition } from "/editions/index.js";

describe("paintEditionVars — per-element edition chrome", () => {
  it("sets the edition's accent + card bg + display font on the element, not <html>", () => {
    const el = document.createElement("div");
    paintEditionVars(el, "jackpot");
    const ed = getEdition("jackpot");
    expect(el.style.getPropertyValue("--accent")).toBe(ed.palette.accent);
    expect(el.style.getPropertyValue("--bg-card")).toBe(ed.palette.bgCard);
    expect(el.style.getPropertyValue("--font-display")).toBe(ed.fonts.display);
    expect(el.dataset.edition).toBe("jackpot");
    // It must NOT mutate the global <html> default.
    expect(document.documentElement.dataset.edition === "jackpot").toBe(false);
  });

  it("falls back to the default edition for an unknown id (never throws)", () => {
    const el = document.createElement("div");
    expect(() => paintEditionVars(el, "not-real")).not.toThrow();
    const def = getEdition("default");
    expect(el.style.getPropertyValue("--accent")).toBe(def.palette.accent);
  });
});
```

> Note: `getActiveEditionId`/`applyEdition` tests above call `applyEdition`, which sets `document.documentElement.dataset.edition`. To keep the "not <html>" assertion robust regardless of test order, the first test resets it: add `document.documentElement.dataset.edition = "default";` as the first line inside that `it(...)` before calling `paintEditionVars`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- edition`
Expected: FAIL — `paintEditionVars is not a function`.

- [ ] **Step 3: Implement `paintEditionVars`**

In `public/edition.js`, add this exported function immediately AFTER `setDefaultEdition` (added in Plan 1):

```js
// Paint an edition's CHROME palette + display font onto a single element as inline CSS
// custom properties, scoped to that element's subtree. Unlike applyEdition (which writes
// <html> globally and persists), this lets many cards each wear a DIFFERENT edition at
// once — the Worlds strip / theater. Board colors are intentionally left alone (cards
// don't render a board). Never touches localStorage. Falls back to the default edition.
const CARD_VARS = {
  accent: "--accent", bgCard: "--bg-card", fg: "--fg", border: "--border", muted: "--muted",
};
export function paintEditionVars(el, id) {
  if (!el) return;
  const ed = getEdition(id);
  for (const [k, cssVar] of Object.entries(CARD_VARS)) {
    if (ed.palette[k] != null) el.style.setProperty(cssVar, ed.palette[k]);
  }
  if (ed.fonts?.display) el.style.setProperty("--font-display", ed.fonts.display);
  el.dataset.edition = ed.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- edition`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add public/edition.js test/edition.test.js
git commit -m "feat(worlds): paintEditionVars — per-element scoped edition chrome"
```

---

### Task 2: World card component + recent-Worlds tracking (`public/world-card.js`)

**Files:**
- Create: `public/world-card.js`
- Test: `test/world-card.test.js`
- Modify: `vitest.config.ts` (add `/world-card.js` alias)

**Why:** One reusable, XSS-safe themed card, used by both the home strip and the `/worlds` theater. Also the client-only "recent Worlds" store that powers the theater's **Mine** tab (the registry twin `worlds.js` can't use `localStorage` — it must stay parity-identical to the server `src/worlds.ts`).

- [ ] **Step 1: Write the failing test**

Create `test/world-card.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import { getWorld } from "/worlds.js";
import { renderWorldCard, pushRecentWorld, getRecentWorldSlugs } from "/world-card.js";

describe("renderWorldCard", () => {
  it("builds an anchor to /w/<slug> painted in the World's edition, name via textContent", () => {
    const world = getWorld("jackpot");
    const el = renderWorldCard(world);
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/w/jackpot");
    expect(el.classList.contains("world-card")).toBe(true);
    expect(el.dataset.edition).toBe("jackpot"); // paintEditionVars ran
    expect(el.textContent).toContain("Jackpot");
    // XSS-safe: name is text, not parsed HTML.
    expect(el.querySelector(".world-card-name").textContent).toBe("Jackpot");
  });
});

describe("recent Worlds store", () => {
  beforeEach(() => localStorage.clear());

  it("pushes most-recent-first, dedupes, and caps the list", () => {
    pushRecentWorld("jackpot");
    pushRecentWorld("arcade");
    pushRecentWorld("jackpot"); // re-visit moves it to front, no dup
    expect(getRecentWorldSlugs()).toEqual(["jackpot", "arcade"]);
  });

  it("ignores junk and returns [] when empty", () => {
    expect(getRecentWorldSlugs()).toEqual([]);
    pushRecentWorld("");
    pushRecentWorld(null);
    expect(getRecentWorldSlugs()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- world-card`
Expected: FAIL — cannot resolve `/world-card.js` (no alias) / module missing.

- [ ] **Step 3: Add the vitest alias**

In `vitest.config.ts`, add to the `resolve.alias` array (next to the `/worlds.js` entry from Plan 1):

```ts
      { find: /^\/world-card\.js$/, replacement: new URL("./public/world-card.js", import.meta.url).pathname },
```

- [ ] **Step 4: Create `public/world-card.js`**

```js
// public/world-card.js — one themed World card, reused by the home strip and the
// /worlds theater. The card self-paints in its World's edition chrome (paintEditionVars),
// so a row of cards reads as a wall of distinct vibes. Also the client-only "recent
// Worlds" store behind the theater's "Mine" tab (kept out of worlds.js, which must stay
// a byte-parity twin of the server registry and therefore localStorage-free).
import { paintEditionVars } from "/edition.js";

// Build one card as an <a> to /w/<slug>, painted in the World's skin. Name via
// textContent (XSS-safe; Plan 3 makes World names admin-editable).
export function renderWorldCard(world) {
  const a = document.createElement("a");
  a.className = "world-card";
  a.href = `/w/${world.slug}`;
  paintEditionVars(a, world.editionId);
  const name = document.createElement("span");
  name.className = "world-card-name";
  name.textContent = world.name;
  const blurb = document.createElement("span");
  blurb.className = "world-card-blurb";
  blurb.textContent = world.blurb;
  a.append(name, blurb);
  return a;
}

const LS_RECENT = "wordul.recentWorlds";
const RECENT_MAX = 12;

export function getRecentWorldSlugs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_RECENT) ?? "[]");
    return Array.isArray(raw) ? raw.filter((s) => typeof s === "string" && s) : [];
  } catch { return []; }
}

export function pushRecentWorld(slug) {
  if (typeof slug !== "string" || !slug) return;
  const next = [slug, ...getRecentWorldSlugs().filter((s) => s !== slug)].slice(0, RECENT_MAX);
  try { localStorage.setItem(LS_RECENT, JSON.stringify(next)); } catch { /* storage full/disabled */ }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- world-card`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add public/world-card.js test/world-card.test.js vitest.config.ts
git commit -m "feat(worlds): themed World card component + recent-Worlds store"
```

---

### Task 3: Home strip

**Files:**
- Modify: `public/hub.js` (render a Worlds strip + wire it)
- Modify: `public/app.js` (pass `onWorld` / `onBrowseWorlds` callbacks; track recent on visit)
- Test: `test/hub-home.test.js` (extend — it already tests hub rendering)

**Why:** A horizontal row of themed cards on the home page, below the modes grid (promotable later), ending with a "Browse all →" card to `/worlds`. The strip is the trailer; `/worlds` is the theater.

- [ ] **Step 1: Write the failing test**

First inspect `test/hub-home.test.js` to match its setup (it renders the hub into a jsdom document). Append a test that asserts the strip renders. Use the SAME import/render harness the file already uses (do not invent a new one — read the top of the file first). The assertion to add, inside a new `describe`:

```js
import { featuredWorlds } from "/worlds.js";

// (Use the file's existing hub-render helper — e.g. renderHub(profile, callbacks) with a
// jsdom #hubContent mounted. Mirror the existing tests' setup exactly.)
it("renders a Worlds strip with a card per featured World + a Browse-all card", () => {
  // ...render the hub the same way the existing tests do...
  const strip = document.getElementById("worldsStrip");
  expect(strip).toBeTruthy();
  const cards = strip.querySelectorAll(".world-card");
  expect(cards.length).toBe(featuredWorlds().length);
  expect(document.getElementById("worldsBrowseAll")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hub-home`
Expected: FAIL — no `#worldsStrip` element.

- [ ] **Step 3: Render the strip in `hub.js`**

In `public/hub.js`, add the import at the top (after the existing imports):

```js
import { featuredWorlds } from "/worlds.js";
import { renderWorldCard } from "/world-card.js";
```

In `renderDaily()`, add a Worlds strip section immediately AFTER the `</section>` that closes `.hub-modes` (currently around line 75) and BEFORE the `.daily-recent` section. Because `renderDaily()` returns an HTML string but `renderWorldCard` builds DOM nodes, render the strip as a placeholder container here and fill it in `wireDaily()`:

```html
    <section class="hub-worlds" aria-label="Worlds">
      <div class="hub-worlds-head">
        <span class="section-label">Worlds</span>
      </div>
      <div class="worlds-strip" id="worldsStrip"></div>
    </section>
```

In `wireDaily()`, after the existing mode wiring, fill the strip:

```js
  const strip = document.getElementById("worldsStrip");
  if (strip) {
    strip.textContent = "";
    for (const w of featuredWorlds()) {
      const card = renderWorldCard(w);
      card.addEventListener("click", (e) => {
        if (hubCallbacks.onWorld) { e.preventDefault(); hubCallbacks.onWorld(w.slug); }
      });
      strip.appendChild(card);
    }
    // Trailing "Browse all →" card → /worlds theater.
    const all = document.createElement("a");
    all.id = "worldsBrowseAll";
    all.className = "world-card world-card-more";
    all.href = "/worlds";
    all.textContent = "Browse all →";
    all.addEventListener("click", (e) => {
      if (hubCallbacks.onBrowseWorlds) { e.preventDefault(); hubCallbacks.onBrowseWorlds(); }
    });
    strip.appendChild(all);
  }
```

- [ ] **Step 4: Wire the callbacks in `app.js`**

In `public/app.js`, the `cbs` object passed to `renderHub` (inside `renderHomeIdentity`, around line 248) lists handlers like `onSolo`, `onPvP`, `onArena`. Add two more entries to that object:

```js
      onWorld: (slug) => navigate("/w/" + slug),
      onBrowseWorlds: () => navigate("/worlds"),
```

- [ ] **Step 5: Run tests**

Run: `npm test -- hub-home` then `npm test` (full).
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/hub.js public/app.js test/hub-home.test.js
git commit -m "feat(worlds): home page Worlds strip (themed cards + Browse all)"
```

---

### Task 4: `/worlds` theater route + screen

**Files:**
- Modify: `src/worker.ts` (serve SPA shell for `/worlds`)
- Modify: `public/app.js` (route `worlds`; `showWorlds` screen; track recent in `showWorld`; redirect unknown slug to `/worlds`)
- Test: `test/worlds.test.ts` (add a path-matching assertion); manual for the screen

**Why:** The full tabbed wall — **Featured · All · Mine** — at its own indexable URL.

- [ ] **Step 1: Serve the shell in `src/worker.ts`**

Immediately AFTER the `WORLD_RE` serve branch added in Plan 1, add an exact-match branch for `/worlds`:

```ts
    // The Worlds theater (/worlds): serve the SPA shell; client renders the tabbed wall.
    if (url.pathname === "/worlds") {
      return env.ASSETS.fetch(new Request(url.origin + "/index.html"));
    }
```

(SEO meta for `/worlds` is added in Task 5; this just makes the route resolve.)

- [ ] **Step 2: Route it in `app.js`**

In `parseRoute()`, add immediately BEFORE the world-slug check from Plan 1:

```js
  if (location.pathname === "/worlds") return { kind: "worlds" };
```

In `route()`, add immediately BEFORE the `if (r.kind === "world")` line from Plan 1:

```js
  if (r.kind === "worlds") { showWorlds(); return; }
```

In `renderCrumbs()`, add a label case (before the `world` case from Plan 1):

```js
    : r.kind === "worlds" ? "Worlds"
```

- [ ] **Step 3: Track recent + fix unknown-slug redirect in `showWorld`**

In `public/app.js`, update the import added in Plan 1 to also pull the recent-store + card helpers:

```js
import { getWorld, worldSlugFromPath, listWorlds, featuredWorlds } from "/worlds.js";
import { renderWorldCard, pushRecentWorld, getRecentWorldSlugs } from "/world-card.js";
```

In `showWorld(slug)` (from Plan 1): change the unknown-slug line from `navigate("/")` to `navigate("/worlds")`, and record the visit. The opening of `showWorld` becomes:

```js
function showWorld(slug) {
  const world = getWorld(slug);
  if (!world) { navigate("/worlds"); return; }
  pushRecentWorld(slug); // feeds the theater's "Mine" tab
  document.title = `${world.name} — Wordul`;
  applyEdition(world.editionId, { persist: false });
  // ...(rest of showWorld unchanged)...
```

- [ ] **Step 4: Add the `showWorlds` theater screen**

Add this function in `public/app.js` immediately BEFORE `showWorld`. It mirrors the imperative `showFeed`/`showWorld` pattern (createElement, textContent, XSS-safe). The global skin is reset to the saved default so the page chrome is neutral while each card self-paints:

```js
// The Worlds theater (/worlds): a tabbed wall of themed cards. Tabs: Featured · All ·
// Mine (recently visited). Live counts / an "Active" tab arrive in Plan 2b. Each card
// self-paints (paintEditionVars); the page chrome stays on the saved default.
function showWorlds() {
  document.title = "Worlds — Wordul";
  applyEdition(getActiveEditionId()); // neutral page chrome; cards paint themselves
  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");

  const screen = document.createElement("section");
  screen.className = "screen worlds-screen";

  const back = document.createElement("a");
  back.href = "/"; back.className = "link worlds-back"; back.textContent = "← Home";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });

  const head = document.createElement("header");
  head.className = "worlds-head";
  const kicker = document.createElement("span");
  kicker.className = "daily-kicker"; kicker.textContent = "Worlds";
  const h1 = document.createElement("h1");
  h1.className = "worlds-title"; h1.textContent = "Browse Worlds";
  head.append(kicker, h1);

  const tabsBar = document.createElement("div");
  tabsBar.className = "worlds-tabs";
  const wall = document.createElement("div");
  wall.className = "worlds-wall"; wall.id = "worldsWall";

  const TABS = [
    { key: "featured", label: "Featured", worlds: () => featuredWorlds() },
    { key: "all",      label: "All",      worlds: () => listWorlds() },
    { key: "mine",     label: "Mine",     worlds: () => getRecentWorldSlugs().map(getWorld).filter(Boolean) },
  ];

  const paintWall = (worlds) => {
    wall.textContent = "";
    if (worlds.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted worlds-empty";
      empty.textContent = "No Worlds here yet — visit a few and they'll show up.";
      wall.appendChild(empty);
      return;
    }
    for (const w of worlds) {
      const card = renderWorldCard(w);
      card.addEventListener("click", (e) => { e.preventDefault(); navigate("/w/" + w.slug); });
      wall.appendChild(card);
    }
  };

  TABS.forEach((tab, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "worlds-tab" + (i === 0 ? " is-active" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => {
      tabsBar.querySelectorAll(".worlds-tab").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      paintWall(tab.worlds());
    });
    tabsBar.appendChild(btn);
  });

  screen.append(back, head, tabsBar, wall);
  app.appendChild(screen);
  paintWall(TABS[0].worlds()); // default to Featured
}
```

- [ ] **Step 5: Add a path test**

In `test/worlds.test.ts`, add to the existing `worldSlugFromPath` test that `/worlds` is NOT treated as a World slug (already covered: `worldSlugFromPath("/worlds")` returns null). Confirm that assertion exists; if not, add `expect(worldSlugFromPath("/worlds")).toBe(null);`.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test` then `npm run typecheck`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker.ts public/app.js test/worlds.test.ts
git commit -m "feat(worlds): /worlds theater — tabbed wall (Featured/All/Mine)"
```

---

### Task 5: SEO meta for `/w/<slug>` and `/worlds`

**Files:**
- Modify: `src/worker.ts` (inject per-World meta via `HTMLRewriter`)
- Test: manual (`curl` the rendered `<title>` / canonical)

**Why:** Each World is an indexable landing page (the spec's discoverability win). Replace Plan 1's plain-shell serve for `/w/<slug>` with meta injection (title = World name, description = blurb, canonical/og = the World URL); give `/worlds` its own browse meta. Reuses the existing `HTMLRewriter` + `data-meta` pattern (see `renderFeedStream`/`injectMeta` and the `TextSetter`/`AttrSetter` classes already in the file).

- [ ] **Step 1: Import the registry into the worker**

In `src/worker.ts`, add to the imports (near the other `./` imports):

```ts
import { getWorld } from "./worlds.ts";
```

- [ ] **Step 2: Replace the `/w/<slug>` serve branch with meta injection**

Replace the Plan 1 `WORLD_RE` branch:

```ts
    if (WORLD_RE.test(url.pathname)) {
      return env.ASSETS.fetch(new Request(url.origin + "/index.html"));
    }
```

with:

```ts
    // World pages (/w/<slug>): SPA shell with per-World SEO meta. Unknown slug still
    // serves the shell (the client router redirects to /worlds), with default meta.
    const worldMatch = url.pathname.match(WORLD_RE);
    if (worldMatch) {
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      const world = getWorld(worldMatch[1]);
      const canonical = `${url.origin}/w/${worldMatch[1]}`;
      const title = world ? `${world.name} — Wordul` : "Worlds — Wordul";
      const desc = world ? world.blurb : "Browse themed Worlds on Wordul.";
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter(title))
        .on('[data-meta="og:title"]', new AttrSetter("content", title))
        .on('[data-meta="description"]', new AttrSetter("content", desc))
        .on('[data-meta="og:description"]', new AttrSetter("content", desc))
        .on('[data-meta="canonical"]', new AttrSetter("href", canonical))
        .on('[data-meta="og:url"]', new AttrSetter("content", canonical))
        .transform(shell);
    }
```

- [ ] **Step 3: Add `/worlds` meta to its serve branch**

Replace the Task 4 `/worlds` branch:

```ts
    if (url.pathname === "/worlds") {
      return env.ASSETS.fetch(new Request(url.origin + "/index.html"));
    }
```

with:

```ts
    // The Worlds theater (/worlds): SPA shell + browse meta.
    if (url.pathname === "/worlds") {
      const shell = await env.ASSETS.fetch(new Request(url.origin + "/index.html"));
      const title = "Browse Worlds — Wordul";
      const desc = "Pick a World and play — themed places to race the same word.";
      return new HTMLRewriter()
        .on('[data-meta="title"]', new TextSetter(title))
        .on('[data-meta="og:title"]', new AttrSetter("content", title))
        .on('[data-meta="description"]', new AttrSetter("content", desc))
        .on('[data-meta="og:description"]', new AttrSetter("content", desc))
        .on('[data-meta="canonical"]', new AttrSetter("href", `${url.origin}/worlds`))
        .on('[data-meta="og:url"]', new AttrSetter("content", `${url.origin}/worlds`))
        .transform(shell);
    }
```

> Confirm `TextSetter` and `AttrSetter` are defined in `src/worker.ts` (they are — used by `renderFeedPost`/`injectMeta`). If their constructor signatures differ from `new TextSetter(text)` / `new AttrSetter(attr, value)`, match the existing usages in the file exactly.

- [ ] **Step 4: Add Worlds to the sitemap (discoverability)**

In `src/worker.ts`, the `sitemap(env, origin)` function builds a URL list. After the static seeds (`origin + "/"`, etc.), add the World URLs. Add the import `listWorlds` to the `./worlds.ts` import, and in `sitemap` insert:

```ts
  for (const w of listWorlds()) urls.push(`${origin}/w/${w.slug}`);
  urls.push(`${origin}/worlds`);
```

(Place these right after the initial `const urls = [...]` declaration, before the DIRECTORY pagination loop.)

- [ ] **Step 5: Typecheck + tests**

Run: `npm run typecheck` then `npm test`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker.ts
git commit -m "feat(worlds): per-World SEO meta for /w/<slug> + /worlds + sitemap"
```

---

### Task 6: Bind the spawned solo room to the World's skin

**Files:**
- Modify: `public/app.js` (`enterNewRoom` accepts an edition override; `showWorld` Play passes the World's edition; the `hello` uses it)
- Test: manual (verified in Task 7)

**Why:** Plan 1's final review flagged that "Play solo" from a World creates a room recorded with the player's *saved default* edition, not the World's (the `hello` seeds `edition: getActiveEditionId()` at app.js:1429). Carry the World's skin into the room WITHOUT changing the player's saved default — via a transient pending value, mirroring `pendingDailySeed`.

- [ ] **Step 1: Add a transient pending-edition**

In `public/app.js`, near the other one-shot flags (e.g. `pendingDailySeed`, around line 132), add:

```js
// One-shot: the edition a room should be created with (e.g. launching Solo from a World),
// without persisting it as the player's saved default. Consumed by the hello message.
let pendingRoomEdition = null;
```

- [ ] **Step 2: `enterNewRoom` accepts an edition override**

In `enterNewRoom({ autoStart, publicArena = false })` (around line 351), add an `editionId` option and stash it:

Change the signature to:

```js
function enterNewRoom({ autoStart, publicArena = false, editionId = null }) {
```

and immediately after `if (!username) return;` add:

```js
  pendingRoomEdition = editionId; // null for normal creates; a World's edition from showWorld
```

- [ ] **Step 3: The `hello` uses the pending edition then clears it**

At the `hello` message (around line 1426-1429), the edition field currently reads:

```js
      edition: getActiveEditionId(), // seeds a fresh room with the creator's theme
```

Replace with:

```js
      edition: pendingRoomEdition ?? getActiveEditionId(), // World skin if launched from one, else the saved default
```

Then, immediately AFTER the `send({ type: "hello", ... })` call that contains it, clear the one-shot:

```js
  pendingRoomEdition = null; // consumed — never leak into the next room
```

> Read the surrounding lines first to place the clear correctly — it must run after the hello is sent, in the same function. If the hello is built as an object then sent, clear right after the `send(...)`.

- [ ] **Step 4: `showWorld` Play passes the World's edition**

In `showWorld`, the Play button handler (from Plan 1) currently calls `enterNewRoom({ autoStart: true })`. Change it to:

```js
    enterNewRoom({ autoStart: true, editionId: world.editionId });
```

- [ ] **Step 5: Typecheck + tests**

Run: `npm run typecheck` then `npm test`.
Expected: PASS (no test drives the WS hello; this is verified live in Task 7).

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "feat(worlds): launch solo room in the World's skin (no default change)"
```

---

### Task 7: Styles + end-to-end verification

**Files:**
- Modify: `public/style.css` (strip, theater, card styles)
- Test: manual

- [ ] **Step 1: Append styles**

Append to `public/style.css` (after the Plan 1 `.world-screen` block). Confirm the variable names (`--accent`, `--bg-card`, `--border`, `--fg`, `--font-display`) exist (they're set by `paintEditionVars`, scoped per card):

```css
/* Worlds strip (home) + theater (/worlds) — each .world-card self-paints its edition. */
.hub-worlds { margin-top: 1.5rem; }
.hub-worlds-head { margin-bottom: 0.5rem; }
.worlds-strip { display: flex; gap: 0.75rem; overflow-x: auto; padding-bottom: 0.5rem; scroll-snap-type: x mandatory; }
.worlds-strip .world-card { scroll-snap-align: start; flex: 0 0 auto; }

.world-card {
  display: flex; flex-direction: column; gap: 0.25rem; justify-content: flex-end;
  min-width: 9rem; min-height: 6rem; padding: 0.85rem 1rem; border-radius: 0.9rem;
  text-decoration: none; cursor: pointer;
  background: var(--bg-card); color: var(--fg);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent),
              0 6px 20px -12px color-mix(in srgb, var(--accent) 60%, transparent);
}
.world-card-name { font-family: var(--font-display); font-size: 1.25rem; line-height: 1.05; color: var(--accent); }
.world-card-blurb { font-size: 0.8rem; opacity: 0.8; }
.world-card-more { align-items: center; justify-content: center; font-weight: 600; color: var(--accent); }

.worlds-screen { max-width: 48rem; margin: 0 auto; padding: 2rem 1.25rem; }
.worlds-back { display: inline-block; margin-bottom: 1.25rem; }
.worlds-head { margin-bottom: 1.25rem; }
.worlds-title { font-family: var(--font-display); font-size: 2.25rem; margin: 0.25rem 0 0; }
.worlds-tabs { display: flex; gap: 0.5rem; margin-bottom: 1.25rem; }
.worlds-tab { background: transparent; border: 1px solid var(--border); border-radius: 999px;
  padding: 0.35rem 0.9rem; font: inherit; color: var(--muted); cursor: pointer; }
.worlds-tab.is-active { color: var(--fg); border-color: var(--accent); }
.worlds-wall { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 0.85rem; }
.worlds-empty { grid-column: 1 / -1; }
```

- [ ] **Step 2: Commit styles**

```bash
git add public/style.css
git commit -m "feat(worlds): strip + theater + themed card styles"
```

- [ ] **Step 3: Start the dev server**

Run: `npm run dev` (note the local URL, typically `http://localhost:8787`).

- [ ] **Step 4: Verify the home strip**

Open `http://localhost:8787/`, set a username if needed. Expected: below the Solo/Duel/Arena modes, a "Worlds" strip of themed cards (each in a different skin — accent/bg/font differ per card) ending with a "Browse all →" card. Tapping a card → `/w/<slug>`. Tapping "Browse all" → `/worlds`.

- [ ] **Step 5: Verify the theater**

At `/worlds`: three tabs (Featured/All/Mine). Featured shows the featured set; All shows all 7; Mine shows Worlds you've visited (visit a couple via `/w/...` first). Each card self-painted. Tapping a card opens its World.

- [ ] **Step 6: Verify SEO meta (curl)**

Run:
```bash
curl -s http://localhost:8787/w/jackpot | grep -o '<title[^>]*>[^<]*</title>'
curl -s http://localhost:8787/worlds | grep -o '<title[^>]*>[^<]*</title>'
```
Expected: `Jackpot — Wordul` and `Browse Worlds — Wordul` respectively.

- [ ] **Step 7: Verify the room inherits the World skin**

Visit `/w/arcade` → "Play solo →". In the spawned room, confirm the board/chrome wears the Arcade edition (not your saved default). Then go Home and confirm your saved default is unchanged (`localStorage.getItem("wordul.edition")` is whatever it was, not "arcade").

- [ ] **Step 8: Final automated check**

Run: `npm test && npm run typecheck`.
Expected: both PASS.

- [ ] **Step 9: Stop the dev server.**

---

## Self-Review

**Spec coverage (against `2026-06-04-worlds-browser-design.md`):**
- Home strip (themed cards, near modes, "Browse all →") → Task 3. ✅
- `/worlds` theater (tabbed wall) → Task 4. Tabs **Featured · All · Mine**; **Active** deferred to Plan 2b (stated in header). ✅ (partial-by-design)
- Card = themed `wordul-card` showing the name, painted in its skin → Tasks 1+2 (`paintEditionVars` + `renderWorldCard`). ✅
- Indexable `/worlds` + per-World pages (SEO) → Task 5 (meta + sitemap). ✅
- Bind spawned room to World skin (Plan 1 carry-forward) → Task 6. ✅
- Lingering-try-on-skin (Plan 1 carry-forward) → addressed: `showWorlds` resets global chrome to the saved default and cards self-paint; returning Home already re-applies the default via `renderHomeIdentity`. ✅
- Live counts / Active heartbeat / `world/<slug>` rooms → **Plan 2b** (explicit). ✅ (out of scope)

**Placeholder scan:** Task 1, 2, 4, 5, 6 ship complete code. Task 3's hub-home test references the file's existing render harness rather than reproducing it — the step instructs reading the file first because the harness specifics must match what's there; the assertion body is complete. No TBD/TODO.

**Type/name consistency:** `paintEditionVars(el, id)`, `renderWorldCard(world)`, `pushRecentWorld`/`getRecentWorldSlugs`, `pendingRoomEdition`, route kinds `"worlds"`/`"world"`, and the `/world-card.js` alias are used identically across `edition.js`, `world-card.js`, `hub.js`, `app.js`, `worker.ts`, and `vitest.config.ts`. SEO reuses `getWorld`/`listWorlds` from `src/worlds.ts` and the existing `TextSetter`/`AttrSetter`.

**Next plan:** Plan 2b (live counts: `world/<slug>` rooms + Arena DIRECTORY counts + the "Active" tab + ghost-town fallback), then Plan 3 (admin gate `yan`/`zang`/`yanik`/`antonio` + Vibe Studio admin edit + KV override merge).
