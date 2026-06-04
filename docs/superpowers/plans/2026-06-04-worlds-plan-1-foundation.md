# Worlds Foundation (Plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make themed Worlds visitable, shareable places — a `WORLDS` registry, a `/w/<slug>` route that previews a World's skin (try-on), and an explicit "make this my default" action.

**Architecture:** A new `WORLDS` registry mirrors the existing `MODES` pattern (a `src/worlds.ts` source of truth + a hand-synced `public/worlds.js` browser twin). The client SPA router gains a `world` route that renders a World page and applies the World's edition skin *without persisting it* (try-on). `applyEdition` gains a `persist` opt-out so a visit doesn't silently change the saved default; a new `setDefaultEdition` is the only thing that persists. The worker explicitly serves the SPA shell for `/w/<slug>` (this repo has no wrangler SPA fallback — every client route is served by hand in `src/worker.ts`).

**Tech Stack:** Cloudflare Workers (`src/worker.ts`), vanilla ES-module client (`public/*.js`), Vitest (`test/*.test.ts`). No new dependencies.

**Scope notes — what this plan deliberately defers:**
- **Live player counts / "Active" heartbeat** → Plan 2 (reuses the Arena DIRECTORY).
- **The home strip and `/worlds` theater** → Plan 2.
- **KV admin overrides + Vibe Studio admin edit** → Plan 3. Plan 1 reads the static code registry only; the registry is shaped so Plan 3 can layer overrides on top.
- **Removing the legacy 7-theme list picker from settings** → its own follow-up: it is coupled to the in-room `set_edition` broadcast and deserves a careful, isolated change. Plan 1 introduces the *new* default-setter (the World page button); the old picker keeps working until that follow-up retires it.
- **SEO meta injection for `/w/<slug>`** → Plan 2 (Plan 1 serves the plain SPA shell).
- **Binding the spawned solo room's theme to the World** → Plan 2 (Plan 1's "Play solo" uses the existing room-create flow).

**Naming:** The registry type is `WorldDef` (NOT `World`). `src/daily-core.ts` already exports a `World` interface (the curated-day bundle). Keep them distinct to avoid a collision.

---

### Task 1: `WORLDS` registry (server source of truth)

**Files:**
- Create: `src/worlds.ts`
- Test: `test/worlds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/worlds.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EDITIONS } from "../public/editions/index.js";
import {
  WORLDS,
  listWorlds,
  featuredWorlds,
  getWorld,
  isWorldSlug,
  worldSlugFromPath,
  type WorldDef,
} from "../src/worlds.ts";

describe("worlds registry", () => {
  it("every World resolves to a real edition", () => {
    const editionIds = new Set(EDITIONS.map((e) => e.id));
    expect(WORLDS.length).toBeGreaterThan(0);
    for (const w of WORLDS) {
      expect(editionIds.has(w.editionId)).toBe(true);
      expect(w.slug).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(w.name.length).toBeGreaterThan(0);
      expect(w.blurb.length).toBeGreaterThan(0);
    }
  });

  it("slugs and ids are unique", () => {
    const slugs = WORLDS.map((w) => w.slug);
    const ids = WORLDS.map((w) => w.id);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("listWorlds is sorted by order; featuredWorlds is the featured subset", () => {
    const ordered = listWorlds();
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].order).toBeGreaterThanOrEqual(ordered[i - 1].order);
    }
    const feat = featuredWorlds();
    expect(feat.length).toBeGreaterThan(0);
    expect(feat.every((w) => w.featured)).toBe(true);
  });

  it("getWorld / isWorldSlug resolve known slugs and reject unknowns", () => {
    const first: WorldDef = WORLDS[0];
    expect(getWorld(first.slug)?.id).toBe(first.id);
    expect(getWorld("nope-not-real")).toBe(null);
    expect(getWorld(undefined)).toBe(null);
    expect(isWorldSlug(first.slug)).toBe(true);
    expect(isWorldSlug("nope-not-real")).toBe(false);
  });

  it("worldSlugFromPath extracts the slug from /w/<slug> and nothing else", () => {
    expect(worldSlugFromPath("/w/jackpot")).toBe("jackpot");
    expect(worldSlugFromPath("/w/tin-bot")).toBe("tin-bot");
    expect(worldSlugFromPath("/w/")).toBe(null);
    expect(worldSlugFromPath("/worlds")).toBe(null);
    expect(worldSlugFromPath("/@jr/room")).toBe(null);
    expect(worldSlugFromPath(undefined)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- worlds`
Expected: FAIL — `Cannot find module '../src/worlds.ts'`.

- [ ] **Step 3: Write the registry**

Create `src/worlds.ts`:

```ts
// Single source of truth for browsable Worlds — themed places at /w/<slug>.
// Mirrors the MODES pattern (src/modes.ts): this is the SERVER copy; the hand-synced
// browser twin is public/worlds.js. KEEP THEM IN SYNC.
//
// A World pairs a URL slug with an edition (the theme pack in public/editions/*).
// Launch Worlds === the 7 shipped editions. Plan 3 layers admin KV overrides on top
// of these code defaults; Plan 1 reads the static registry only.
//
// NOTE: type is WorldDef, NOT World — src/daily-core.ts already owns `World`
// (the curated-day bundle). These are deliberately distinct.

export type WorldDef = {
  id: string;        // stable identity (=== editionId for the launch Worlds)
  slug: string;      // URL slug at /w/<slug>; admin-renameable later (Plan 3)
  name: string;      // display name on the card / World page
  blurb: string;     // one-line tagline shown on the World page
  editionId: string; // which edition (public/editions/<id>.js) paints this World
  featured: boolean; // included in the home strip's Featured set (Plan 2)
  order: number;     // sort order within listings
};

export const WORLDS: WorldDef[] = [
  { id: "default",   slug: "wordul",       name: "Wordul",       blurb: "The original. Obsidian and ultraviolet.",  editionId: "default",   featured: true,  order: 0 },
  { id: "jackpot",   slug: "jackpot",      name: "Jackpot",      blurb: "High-roller neon. The House is watching.", editionId: "jackpot",   featured: true,  order: 1 },
  { id: "arcade",    slug: "arcade",       name: "Arcade",       blurb: "Insert coin. The Cabinet glows.",          editionId: "arcade",    featured: true,  order: 2 },
  { id: "editorial", slug: "editorial",    name: "Editorial",    blurb: "Quiet broadsheet. The Editor approves.",   editionId: "editorial", featured: true,  order: 3 },
  { id: "tactile",   slug: "tactile",      name: "Tactile",      blurb: "Warm paper and ink. Coach has notes.",     editionId: "tactile",   featured: false, order: 4 },
  { id: "robot",     slug: "tin-bot",      name: "Tin Bot",      blurb: "Cold circuits. Sprocket computes.",        editionId: "robot",     featured: false, order: 5 },
  { id: "yang",      slug: "yangs-table",  name: "Yang's Table", blurb: "A seat at Yang's table.",                  editionId: "yang",      featured: false, order: 6 },
];

const BY_SLUG = new Map<string, WorldDef>(WORLDS.map((w) => [w.slug, w]));

export function listWorlds(): WorldDef[] {
  return [...WORLDS].sort((a, b) => a.order - b.order);
}

export function featuredWorlds(): WorldDef[] {
  return listWorlds().filter((w) => w.featured);
}

export function getWorld(slug: unknown): WorldDef | null {
  return typeof slug === "string" ? BY_SLUG.get(slug) ?? null : null;
}

export function isWorldSlug(slug: unknown): boolean {
  return getWorld(slug) !== null;
}

// Pure path → slug extractor, shared by the client router (public/worlds.js twin)
// and the worker. "/w/jackpot" -> "jackpot"; anything else -> null.
export function worldSlugFromPath(pathname: unknown): string | null {
  if (typeof pathname !== "string") return null;
  const m = pathname.match(/^\/w\/([a-z0-9-]{1,40})$/);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- worlds`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worlds.ts test/worlds.test.ts
git commit -m "feat(worlds): WORLDS registry — themed places mapped to editions"
```

---

### Task 2: Browser twin `public/worlds.js` + parity test

**Files:**
- Create: `public/worlds.js`
- Modify: `vitest.config.ts` (add the `/worlds.js` alias)
- Test: `test/worlds.test.ts` (append a parity block)

- [ ] **Step 1: Write the failing parity test**

Append to `test/worlds.test.ts` (after the existing `describe` block):

```ts
import { WORLDS as TWIN_WORLDS } from "/worlds.js";

describe("worlds registry — browser twin parity", () => {
  it("public/worlds.js is byte-for-byte identical data to src/worlds.ts", () => {
    expect(TWIN_WORLDS).toEqual(WORLDS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- worlds`
Expected: FAIL — the `/worlds.js` import cannot resolve (no alias yet).

- [ ] **Step 3: Add the vitest alias**

In `vitest.config.ts`, inside `resolve.alias`, add this entry alongside the others (place it next to the `/modes` style entries — anywhere in the array is fine):

```ts
      { find: /^\/worlds\.js$/, replacement: new URL("./public/worlds.js", import.meta.url).pathname },
```

- [ ] **Step 4: Write the browser twin**

Create `public/worlds.js` — identical data + helpers, no TypeScript types:

```js
// Browser twin of src/worlds.ts — KEEP IN SYNC. Single source of truth for the
// Worlds UI (the home strip, the /worlds theater, the /w/<slug> page). A World pairs
// a URL slug with an edition (public/editions/<id>.js). Launch Worlds === the 7
// shipped editions. Admin KV overrides (Plan 3) layer on top of these defaults.

export const WORLDS = [
  { id: "default",   slug: "wordul",       name: "Wordul",       blurb: "The original. Obsidian and ultraviolet.",  editionId: "default",   featured: true,  order: 0 },
  { id: "jackpot",   slug: "jackpot",      name: "Jackpot",      blurb: "High-roller neon. The House is watching.", editionId: "jackpot",   featured: true,  order: 1 },
  { id: "arcade",    slug: "arcade",       name: "Arcade",       blurb: "Insert coin. The Cabinet glows.",          editionId: "arcade",    featured: true,  order: 2 },
  { id: "editorial", slug: "editorial",    name: "Editorial",    blurb: "Quiet broadsheet. The Editor approves.",   editionId: "editorial", featured: true,  order: 3 },
  { id: "tactile",   slug: "tactile",      name: "Tactile",      blurb: "Warm paper and ink. Coach has notes.",     editionId: "tactile",   featured: false, order: 4 },
  { id: "robot",     slug: "tin-bot",      name: "Tin Bot",      blurb: "Cold circuits. Sprocket computes.",        editionId: "robot",     featured: false, order: 5 },
  { id: "yang",      slug: "yangs-table",  name: "Yang's Table", blurb: "A seat at Yang's table.",                  editionId: "yang",      featured: false, order: 6 },
];

const BY_SLUG = new Map(WORLDS.map((w) => [w.slug, w]));

export function listWorlds() {
  return [...WORLDS].sort((a, b) => a.order - b.order);
}

export function featuredWorlds() {
  return listWorlds().filter((w) => w.featured);
}

export function getWorld(slug) {
  return typeof slug === "string" ? BY_SLUG.get(slug) ?? null : null;
}

export function isWorldSlug(slug) {
  return getWorld(slug) !== null;
}

export function worldSlugFromPath(pathname) {
  if (typeof pathname !== "string") return null;
  const m = pathname.match(/^\/w\/([a-z0-9-]{1,40})$/);
  return m ? m[1] : null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- worlds`
Expected: PASS (6 tests — the parity test now resolves and matches).

- [ ] **Step 6: Commit**

```bash
git add public/worlds.js vitest.config.ts test/worlds.test.ts
git commit -m "feat(worlds): browser twin public/worlds.js + parity test"
```

---

### Task 3: `applyEdition` try-on (persist opt-out) + `setDefaultEdition`

**Files:**
- Modify: `public/edition.js:152-173` (`applyEdition`) and add `setDefaultEdition`
- Test: `test/edition.test.js`

**Why:** Visiting a World must *preview* its skin without changing the saved default. `applyEdition` currently always writes `localStorage["wordul.edition"]`. Add a `persist` opt-out (default `true`, so all existing callers are unchanged) and a dedicated `setDefaultEdition` that is the *only* explicit way a visit becomes the default.

- [ ] **Step 1: Write the failing test**

Append to `test/edition.test.js` (new `describe` block at the end of the file):

```js
import { applyEdition, setDefaultEdition, getActiveEditionId } from "/edition.js";

describe("edition try-on vs default persistence", () => {
  beforeEach(() => { localStorage.clear(); });

  it("applyEdition persists by default", () => {
    applyEdition("jackpot");
    expect(getActiveEditionId()).toBe("jackpot");
  });

  it("applyEdition with persist:false does NOT change the saved default", () => {
    setDefaultEdition("default");
    applyEdition("arcade", { persist: false });
    // The skin was applied in-memory, but the SAVED default is untouched.
    expect(getActiveEditionId()).toBe("default");
  });

  it("setDefaultEdition persists the chosen edition", () => {
    setDefaultEdition("robot");
    expect(getActiveEditionId()).toBe("robot");
  });

  it("setDefaultEdition falls back to a real edition for an unknown id", () => {
    setDefaultEdition("not-an-edition");
    // getEdition() falls back to default, so the saved value is the default id.
    expect(getActiveEditionId()).toBe("default");
  });
});
```

> Note: `test/edition.test.js` already imports from `/edition.js` and runs under the existing jsdom/localStorage setup — confirm `describe`/`it`/`expect`/`beforeEach` are imported at the top of the file (they are, for the existing edition tests). If `beforeEach` is not yet imported, add it to the existing `import { ... } from "vitest";` line.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- edition`
Expected: FAIL — `setDefaultEdition is not a function` (not yet exported).

- [ ] **Step 3: Implement the persist opt-out + setDefaultEdition**

In `public/edition.js`, change the `applyEdition` signature and its localStorage write.

Replace this line (currently `public/edition.js:152`):

```js
export function applyEdition(id) {
```

with:

```js
// persist:false applies the skin in-memory + on <html> (a "try-on") WITHOUT saving it
// as the default. Default true keeps every existing caller's behavior unchanged.
export function applyEdition(id, { persist = true } = {}) {
```

Replace this line (currently `public/edition.js:171`):

```js
  localStorage.setItem(LS.edition, ed.id);
```

with:

```js
  if (persist) localStorage.setItem(LS.edition, ed.id);
```

Then add this exported function immediately AFTER the `applyEdition` function's closing `}` (after current line 173):

```js
// The one explicit way a chosen edition becomes the saved default. Used by the World
// page's "Make this my default" action. Normalizes through getEdition so an unknown id
// can't poison the stored value.
export function setDefaultEdition(id) {
  const ed = getEdition(id);
  localStorage.setItem(LS.edition, ed.id);
  return ed.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- edition`
Expected: PASS (all existing edition tests still pass + 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add public/edition.js test/edition.test.js
git commit -m "feat(worlds): applyEdition try-on (persist opt-out) + setDefaultEdition"
```

---

### Task 4: Worker serves the SPA shell for `/w/<slug>`

**Files:**
- Modify: `src/worker.ts` (add `WORLD_RE` + a serve branch)
- Test: manual (worker route serving has no unit harness in this repo; verified end-to-end in Task 7)

**Why:** This repo has **no** wrangler SPA fallback (see the DIVERGENCE note in `wrangler.jsonc`). Every client route is served explicitly in `src/worker.ts` — `/w/<slug>` must return `index.html` or a deep-link/refresh 404s. SEO meta injection is deferred to Plan 2; Plan 1 serves the plain shell.

- [ ] **Step 1: Add the route regex**

In `src/worker.ts`, after the existing `CHALLENGE_RE` declaration (currently line 23), add:

```ts
const WORLD_RE = /^\/w\/([a-z0-9-]{1,40})$/;
```

- [ ] **Step 2: Add the serve branch**

In `src/worker.ts`, inside the `fetch` handler, immediately BEFORE the existing "Profile + room + challenge pages" block (currently line 341, the `const profileMatch = ...` line), add:

```ts
    // World pages (/w/<slug>): serve the SPA shell; the client router renders the
    // World and applies its skin. (No wrangler SPA fallback — see wrangler.jsonc.)
    // SEO meta injection is added in Plan 2.
    if (WORLD_RE.test(url.pathname)) {
      return env.ASSETS.fetch(new Request(url.origin + "/index.html"));
    }

```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Run the full test suite (nothing should break)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker.ts
git commit -m "feat(worlds): serve SPA shell for /w/<slug> deep links"
```

---

### Task 5: Client route + World page screen

**Files:**
- Modify: `public/app.js` (imports, `parseRoute`, `route`, `renderCrumbs`, new `showWorld`)
- Test: covered by `test/worlds.test.ts` (`worldSlugFromPath`) + manual (Task 7)

- [ ] **Step 1: Add the imports**

In `public/app.js`, after the existing edition import (currently line 5), the edition import line reads:

```js
import { applyEdition, applyColorScheme, getActiveEditionId, getGold, setGold, drainGold, companionReact, renderEditionPicker, VOICE_EDITION, activeMistakeFx } from "/edition.js";
```

Replace it with (adds `setDefaultEdition`):

```js
import { applyEdition, applyColorScheme, getActiveEditionId, setDefaultEdition, getGold, setGold, drainGold, companionReact, renderEditionPicker, VOICE_EDITION, activeMistakeFx } from "/edition.js";
```

Then, after the modes import (currently line 20, `import { MODES, isAvailableMode } from "/modes.js";`), add:

```js
import { getWorld, worldSlugFromPath } from "/worlds.js";
```

- [ ] **Step 2: Add the route to `parseRoute`**

In `public/app.js`, inside `parseRoute` (currently lines 98-115), add a World check immediately BEFORE the `const room = location.pathname.match(ROOM_RE);` line (currently line 110):

```js
  const worldSlug = worldSlugFromPath(location.pathname);
  if (worldSlug) return { kind: "world", slug: worldSlug };
```

- [ ] **Step 3: Dispatch the route**

In `public/app.js`, inside `route()` (currently lines 3745-3770), add this branch immediately AFTER the `if (r.kind === "feed-post") { showFeedPost(r.date); return; }` line (currently line 3757):

```js
  if (r.kind === "world") { showWorld(r.slug); return; }
```

- [ ] **Step 4: Add the breadcrumb label**

In `public/app.js`, inside `renderCrumbs` (currently lines 3710-3743), the `here` ternary currently ends with:

```js
    : r.kind === "feed-post" ? "Lab · " + r.date
    : `@${r.username}`;
```

Replace those two lines with (insert the World case before the `@username` fallback):

```js
    : r.kind === "feed-post" ? "Lab · " + r.date
    : r.kind === "world" ? (getWorld(r.slug)?.name ?? "World")
    : `@${r.username}`;
```

- [ ] **Step 5: Add the `showWorld` screen**

In `public/app.js`, add this function immediately BEFORE the `function route()` declaration (currently line 3745). It mirrors the imperative, XSS-safe DOM pattern used by `showFeed`:

```js
// A World page (/w/<slug>): a themed place you can visit, share, and play in. Landing
// here is a TRY-ON — the skin is applied for this visit only (persist:false), never
// silently saved as the default. "Make this my default" is the only thing that commits.
// Live counts + "Join the live race" + SEO meta arrive in Plan 2; an unknown slug here
// goes Home (Plan 2 redirects to /worlds instead).
function showWorld(slug) {
  const world = getWorld(slug);
  if (!world) { navigate("/"); return; }
  document.title = `${world.name} — Wordul`;
  // Try-on: preview the skin without changing the saved default.
  applyEdition(world.editionId, { persist: false });

  const app = $("#app");
  app.innerHTML = "";
  document.body.classList.remove("hub-home");

  const screen = document.createElement("section");
  screen.className = "screen world-screen";

  const back = document.createElement("a");
  back.href = "/"; back.className = "link world-back"; back.textContent = "← Home";
  back.addEventListener("click", (e) => { e.preventDefault(); navigate("/"); });

  const head = document.createElement("header");
  head.className = "world-head";
  const kicker = document.createElement("span");
  kicker.className = "daily-kicker"; kicker.textContent = "World";
  const h1 = document.createElement("h1");
  h1.className = "world-title"; h1.textContent = world.name;
  const blurb = document.createElement("p");
  blurb.className = "world-blurb muted"; blurb.textContent = world.blurb;
  head.append(kicker, h1, blurb);

  const actions = document.createElement("div");
  actions.className = "world-actions";

  const play = document.createElement("button");
  play.type = "button"; play.className = "btn block"; play.textContent = "Play solo →";
  play.addEventListener("click", () => {
    if (!getUsername()) { navigate("/"); return; } // no identity yet — register on Home first
    enterNewRoom({ autoStart: true });
  });

  const makeDefault = document.createElement("button");
  makeDefault.type = "button"; makeDefault.className = "btn block ghost";
  makeDefault.textContent = "Make this my default theme";
  makeDefault.addEventListener("click", () => {
    setDefaultEdition(world.editionId);
    toast("Saved — this World is your default look now", { duration: 1600 });
  });

  actions.append(play, makeDefault);
  screen.append(back, head, actions);
  app.appendChild(screen);
}
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS (no regressions; `worldSlugFromPath` already covered in Task 1).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat(worlds): /w/<slug> client route + World page (try-on skin)"
```

---

### Task 6: Minimal World page styles

**Files:**
- Modify: `public/styles.css` (append a small `world-screen` block)
- Test: manual (Task 7)

**Why:** `showWorld` uses existing utility classes (`screen`, `link`, `btn block`, `muted`, `daily-kicker`) plus a few new ones (`world-screen`, `world-head`, `world-title`, `world-blurb`, `world-actions`, `ghost`). Add a small, on-brand block so the page isn't unstyled. Confirm the stylesheet filename first.

- [ ] **Step 1: Confirm the stylesheet path**

Run: `ls public/*.css && grep -n "stylesheet" public/index.html`
Expected: shows the main CSS file linked from `index.html` (likely `public/styles.css`). Use whatever filename is linked.

- [ ] **Step 2: Append the styles**

Append to the main stylesheet (the file confirmed in Step 1):

```css
/* World page (/w/<slug>) — a themed place you visit, share, play in. */
.world-screen { max-width: 32rem; margin: 0 auto; padding: 2rem 1.25rem; }
.world-back { display: inline-block; margin-bottom: 1.5rem; }
.world-head { margin-bottom: 2rem; }
.world-title { font-family: var(--font-display); font-size: 2.5rem; line-height: 1.05; margin: 0.25rem 0 0.5rem; }
.world-blurb { font-size: 1.05rem; margin: 0; }
.world-actions { display: flex; flex-direction: column; gap: 0.75rem; }
.world-actions .btn.ghost { background: transparent; border: 1px solid var(--border); }
```

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "feat(worlds): minimal World page styles"
```

> If the stylesheet filename differs from `styles.css`, adjust the `git add` path accordingly.

---

### Task 7: End-to-end verification

**Files:** none (manual verification)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Wrangler dev server boots (note the local URL, typically `http://localhost:8787`).

- [ ] **Step 2: Visit a World deep link**

Open `http://localhost:8787/w/jackpot` directly (fresh tab — tests the worker shell serve + client route).
Expected: The World page renders with the title "Jackpot", its blurb, and the page wears the Jackpot accent (chrome morphs). No 404, no blank screen.

- [ ] **Step 3: Confirm try-on does NOT change the default**

In DevTools console on the World page, run:

```js
localStorage.getItem("wordul.edition")
```

Expected: NOT `"jackpot"` (it's whatever it was before — `null` or your prior default). The visit previewed the skin without committing it.

- [ ] **Step 4: Confirm "Make this my default" commits**

Click "Make this my default theme". Expected: a toast appears. Then in console:

```js
localStorage.getItem("wordul.edition")
```

Expected: `"jackpot"`.

- [ ] **Step 5: Confirm an unknown slug redirects Home**

Open `http://localhost:8787/w/does-not-exist`.
Expected: the worker serves the shell, the client router resolves no World, and you land on Home (`/`).

- [ ] **Step 6: Confirm "Play solo" works when signed in**

From Home, set a username if you don't have one. Visit `/w/arcade`, click "Play solo →".
Expected: a new solo room is created and the game auto-starts.

- [ ] **Step 7: Final full check**

Run: `npm test && npm run typecheck`
Expected: both PASS.

- [ ] **Step 8: Commit any verification fixups (if needed)**

```bash
git add -A
git commit -m "fix(worlds): verification fixups"
```

(Skip if nothing changed.)

---

## Self-Review

**Spec coverage (against `2026-06-04-worlds-browser-design.md`):**
- "World = themed place with a URL" → Tasks 1, 4, 5 (`/w/<slug>`). ✅
- "Launch set = 7 editions" → Task 1 registry (Daily handled in Plan 2's strip). ✅
- "Source of truth = static defaults + admin KV overrides (override wins)" → Task 1 ships the static defaults shaped for override layering; KV merge is explicitly Plan 3. ✅ (partial-by-design)
- "Visiting = try-on; default only via explicit action" → Task 3 (`persist` opt-out) + Task 5 (`showWorld` try-on + "Make this my default"). ✅
- "Home strip / `/worlds` theater / live counts / SEO meta" → explicitly deferred to Plan 2 (stated in header). ✅ (out of scope)
- "Admin edit via Vibe Studio" → explicitly deferred to Plan 3. ✅ (out of scope)
- "Remove legacy 7-theme settings picker" → explicitly deferred to a follow-up (coupling to `set_edition` broadcast). The new default-setter ships here. ✅ (out of scope, noted)

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. ✅

**Type/name consistency:** `WorldDef` (not `World`) used in `src/worlds.ts` and tests — avoids the `daily-core.World` collision. `applyEdition(id, { persist })`, `setDefaultEdition(id)`, `getWorld`, `worldSlugFromPath`, `listWorlds`, `featuredWorlds`, `isWorldSlug` are named identically across `src/worlds.ts`, `public/worlds.js`, `public/edition.js`, and `public/app.js`. Route kind `"world"` is consistent across `parseRoute`, `route`, and `renderCrumbs`. ✅

**Next plans:** Plan 2 (home strip + `/worlds` theater + live counts via Arena DIRECTORY + SEO meta + bind spawned room skin), Plan 3 (admin gate `yan`/`zang`/`yanik`/`antonio` + Vibe Studio admin edit + KV override merge).
