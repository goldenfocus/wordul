# Admin World Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin add/edit/delete/reorder/feature the 7 themed Worlds through an isolated studio page, persisted as KV overrides over code defaults and reflected live in the game.

**Architecture:** Code `WORLDS` array stays the base layer. A single JSON override doc in `DIRECTORY` KV (key `worlds:overrides`) is merged on top at runtime by a pure `mergeWorlds`. A public `GET /worlds.json` serves the effective list; the client hydrates `public/worlds.js` from it before rendering. Admin reads/writes go through `GET/POST /admin/worlds`, bearer-gated by the existing `DAILY_ADMIN_TOKEN`. The editor is a dedicated isolated page (`/studio-worlds`) with a pure CRUD core.

**Tech Stack:** Cloudflare Workers + Durable Objects, Workers KV (`DIRECTORY`), TypeScript (`src/`), vanilla ES modules (`public/`), vitest (`node` env).

**Spec:** `docs/superpowers/specs/2026-06-06-admin-world-manager-design.md`

> **Note on URL:** Spec said `/studio/worlds`; this plan serves the flat asset `public/studio-worlds.html` at `/studio-worlds` to match the existing flat static-asset pattern (`vibe-studio.html` → `/vibe-studio`). Functionally identical.

---

## File Structure

**Create:**
- `src/world-overrides.ts` — `WorldOverrides` type, `EMPTY_OVERRIDES`, pure `mergeWorlds(base, ov)`, pure `normalizeOverrides(raw, base)`. The override engine. No I/O.
- `test/world-overrides.test.ts` — tests for merge + normalize.
- `public/studio-worlds-core.js` — pure CRUD transforms (`addWorld`, `removeWorld`, `moveWorld`, `updateField`, `buildOverrides`). No DOM, no fetch.
- `test/studio-worlds-core.test.js` — tests for the CRUD core.
- `public/studio-worlds.html` — the manager page shell (Glass-Aurora styled).
- `public/studio-worlds.js` — the manager controller (DOM + fetch; thin).

**Modify:**
- `src/worlds.ts` — add async `getEffectiveWorlds(env)` (read KV + merge).
- `src/worker.ts` — add `GET /worlds.json`, `GET /admin/worlds`, `POST /admin/worlds`; make `/w/<slug>` page + sitemap use `getEffectiveWorlds(env)`.
- `public/worlds.js` — add `hydrateWorlds(list)` + `loadWorlds()`; read from a mutable internal list.
- `public/app.js` — `await loadWorlds()` during boot before the Worlds strip renders.
- `public/hub.js` — `await loadWorlds()` before the featured strip renders.
- `public/vibe-studio.html` — add a link to `/studio-worlds`.
- `vitest.config.ts` — alias `/studio-worlds-core.js`.

---

## Task 1: Override types + `mergeWorlds`

**Files:**
- Create: `src/world-overrides.ts`
- Test: `test/world-overrides.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/world-overrides.test.ts
import { describe, it, expect } from "vitest";
import { WORLDS, type WorldDef } from "../src/worlds.ts";
import { mergeWorlds, EMPTY_OVERRIDES, type WorldOverrides } from "../src/world-overrides.ts";

const base: WorldDef[] = [
  { id: "a", slug: "a", name: "A", blurb: "ba", editionId: "default", featured: true,  order: 0 },
  { id: "b", slug: "b", name: "B", blurb: "bb", editionId: "yang",    featured: false, order: 1 },
];

describe("mergeWorlds", () => {
  it("returns the base list (sorted) when overrides are empty", () => {
    expect(mergeWorlds(base, EMPTY_OVERRIDES).map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("applies field edits but never changes a base world's id", () => {
    const ov: WorldOverrides = { edits: { a: { name: "AA", id: "hacked" } as any }, added: [], deleted: [] };
    const out = mergeWorlds(base, ov);
    expect(out.find((w) => w.id === "a")!.name).toBe("AA");
    expect(out.map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("drops deleted base worlds (tombstone)", () => {
    const ov: WorldOverrides = { edits: {}, added: [], deleted: ["a"] };
    expect(mergeWorlds(base, ov).map((w) => w.id)).toEqual(["b"]);
  });

  it("appends added worlds and re-sorts by order", () => {
    const added: WorldDef = { id: "c", slug: "c", name: "C", blurb: "bc", editionId: "default", featured: false, order: -1 };
    const ov: WorldOverrides = { edits: {}, added: [added], deleted: [] };
    expect(mergeWorlds(base, ov).map((w) => w.id)).toEqual(["c", "a", "b"]);
  });

  it("real launch worlds survive an empty merge unchanged", () => {
    expect(mergeWorlds(WORLDS, EMPTY_OVERRIDES).length).toBe(WORLDS.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/world-overrides.test.ts`
Expected: FAIL — cannot resolve `../src/world-overrides.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/world-overrides.ts
import type { WorldDef } from "./worlds.ts";

export type WorldOverrides = {
  edits: Record<string, Partial<WorldDef>>; // field changes keyed by world id
  added: WorldDef[];                          // brand-new worlds not in code
  deleted: string[];                          // ids hidden/removed
};

export const EMPTY_OVERRIDES: WorldOverrides = { edits: {}, added: [], deleted: [] };

// Pure: code base + override layer -> effective list, sorted by order.
// A base world's `id` is immutable; edits to `id` are ignored.
export function mergeWorlds(base: WorldDef[], ov: WorldOverrides): WorldDef[] {
  const del = new Set(ov?.deleted ?? []);
  const edits = ov?.edits ?? {};
  const out: WorldDef[] = [];
  for (const w of base) {
    if (del.has(w.id)) continue;
    out.push({ ...w, ...(edits[w.id] ?? {}), id: w.id });
  }
  for (const a of ov?.added ?? []) {
    if (del.has(a.id)) continue;
    out.push({ ...a, ...(edits[a.id] ?? {}), id: a.id });
  }
  return out.sort((x, y) => x.order - y.order);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/world-overrides.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/world-overrides.ts test/world-overrides.test.ts
git commit -m "feat(worlds): pure mergeWorlds override engine + types"
```

---

## Task 2: `normalizeOverrides` validation

**Files:**
- Modify: `src/world-overrides.ts`
- Test: `test/world-overrides.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing file)

```ts
// append to test/world-overrides.test.ts
import { normalizeOverrides } from "../src/world-overrides.ts";

describe("normalizeOverrides", () => {
  const base: WorldDef[] = [
    { id: "a", slug: "a", name: "A", blurb: "ba", editionId: "default", featured: true, order: 0 },
  ];

  it("accepts a well-formed doc and echoes a clean copy", () => {
    const raw = { edits: { a: { name: "AA" } }, added: [], deleted: [] };
    const r = normalizeOverrides(raw, base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.edits.a.name).toBe("AA");
  });

  it("coerces a non-object into EMPTY_OVERRIDES", () => {
    const r = normalizeOverrides(null, base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ edits: {}, added: [], deleted: [] });
  });

  it("rejects an added world with a bad slug", () => {
    const raw = { edits: {}, deleted: [],
      added: [{ id: "x", slug: "Bad Slug!", name: "X", blurb: "b", editionId: "default", featured: false, order: 1 }] };
    const r = normalizeOverrides(raw, base);
    expect(r.ok).toBe(false);
  });

  it("rejects a duplicate slug against a base world", () => {
    const raw = { edits: {}, deleted: [],
      added: [{ id: "x", slug: "a", name: "X", blurb: "b", editionId: "default", featured: false, order: 1 }] };
    const r = normalizeOverrides(raw, base);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown editionId", () => {
    const raw = { edits: {}, deleted: [],
      added: [{ id: "x", slug: "x", name: "X", blurb: "b", editionId: "nope", featured: false, order: 1 }] };
    const r = normalizeOverrides(raw, base);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty name on an edited world", () => {
    const r = normalizeOverrides({ edits: { a: { name: "" } }, added: [], deleted: [] }, base);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/world-overrides.test.ts`
Expected: FAIL — `normalizeOverrides` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/world-overrides.ts`)

```ts
// append to src/world-overrides.ts
export type NormResult =
  | { ok: true; value: WorldOverrides }
  | { ok: false; reason: string };

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const NAME_MAX = 60;
const BLURB_MAX = 140;

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// Validate an admin-supplied override doc against the code base. Returns a cleaned
// doc or a human-readable reason. Strategy: coerce shape, merge, validate the
// EFFECTIVE list (catches both added and edited worlds in one pass).
export function normalizeOverrides(raw: unknown, base: WorldDef[]): NormResult {
  const o = asObj(raw);
  const edits = asObj(o.edits) as Record<string, Partial<WorldDef>>;
  const added = Array.isArray(o.added) ? (o.added as WorldDef[]) : [];
  const deleted = Array.isArray(o.deleted) ? (o.deleted as unknown[]).filter((x) => typeof x === "string") as string[] : [];

  const baseIds = new Set(base.map((w) => w.id));
  for (const id of Object.keys(edits)) {
    if (!baseIds.has(id) && !added.some((a) => a && a.id === id)) {
      return { ok: false, reason: `edit references unknown world id: ${id}` };
    }
  }

  const validEditions = new Set(base.map((w) => w.editionId));
  const clean: WorldOverrides = { edits, added, deleted };
  const effective = mergeWorlds(base, clean);

  const seenSlug = new Set<string>();
  for (const w of effective) {
    if (typeof w.id !== "string" || !w.id) return { ok: false, reason: "world missing id" };
    if (typeof w.slug !== "string" || !SLUG_RE.test(w.slug)) return { ok: false, reason: `bad slug: ${String(w.slug)}` };
    if (seenSlug.has(w.slug)) return { ok: false, reason: `duplicate slug: ${w.slug}` };
    seenSlug.add(w.slug);
    if (typeof w.name !== "string" || !w.name.trim() || w.name.length > NAME_MAX) return { ok: false, reason: `bad name for ${w.slug}` };
    if (typeof w.blurb !== "string" || w.blurb.length > BLURB_MAX) return { ok: false, reason: `bad blurb for ${w.slug}` };
    if (!validEditions.has(w.editionId)) return { ok: false, reason: `unknown editionId: ${String(w.editionId)}` };
    if (typeof w.featured !== "boolean") return { ok: false, reason: `featured must be boolean for ${w.slug}` };
    if (typeof w.order !== "number" || !Number.isFinite(w.order)) return { ok: false, reason: `bad order for ${w.slug}` };
  }
  return { ok: true, value: clean };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/world-overrides.test.ts`
Expected: PASS (all tests, both describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/world-overrides.ts test/world-overrides.test.ts
git commit -m "feat(worlds): normalizeOverrides validation (slug/edition/uniqueness)"
```

---

## Task 3: `getEffectiveWorlds(env)` server helper

**Files:**
- Modify: `src/worlds.ts` (append at end)
- Test: `test/worlds.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `test/worlds.test.ts`)

```ts
// append to test/worlds.test.ts
import { getEffectiveWorlds } from "../src/worlds.ts";

function fakeEnv(stored: unknown) {
  return { DIRECTORY: { async get(_key: string, _type: "json") { return stored; } } } as any;
}

describe("getEffectiveWorlds", () => {
  it("returns the code base when KV has no overrides", async () => {
    const out = await getEffectiveWorlds(fakeEnv(null));
    expect(out.length).toBe(WORLDS.length);
  });

  it("applies a stored edit", async () => {
    const ov = { edits: { default: { name: "Renamed" } }, added: [], deleted: [] };
    const out = await getEffectiveWorlds(fakeEnv(ov));
    expect(out.find((w) => w.id === "default")!.name).toBe("Renamed");
  });

  it("falls back to base if KV throws", async () => {
    const env = { DIRECTORY: { async get() { throw new Error("kv down"); } } } as any;
    const out = await getEffectiveWorlds(env);
    expect(out.length).toBe(WORLDS.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/worlds.test.ts`
Expected: FAIL — `getEffectiveWorlds` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/worlds.ts`)

```ts
// append to src/worlds.ts
import { mergeWorlds, EMPTY_OVERRIDES, type WorldOverrides } from "./world-overrides.ts";

export const WORLD_OVERRIDES_KEY = "worlds:overrides";

// Effective registry = code base merged with the admin KV override layer.
// Never throws: any KV failure falls back to the static base.
export async function getEffectiveWorlds(env: { DIRECTORY: KVNamespace }): Promise<WorldDef[]> {
  let ov: WorldOverrides = EMPTY_OVERRIDES;
  try {
    const stored = (await env.DIRECTORY.get(WORLD_OVERRIDES_KEY, "json")) as WorldOverrides | null;
    if (stored) ov = stored;
  } catch {
    /* fall back to base */
  }
  return mergeWorlds(WORLDS, ov);
}

export function getEffectiveWorld(list: WorldDef[], slug: unknown): WorldDef | null {
  return typeof slug === "string" ? list.find((w) => w.slug === slug) ?? null : null;
}
```

> Note: `KVNamespace` is a Cloudflare type already available via `@cloudflare/workers-types` (used across `src/`). If tsc complains it is unresolved here, import `WorldDef` is already in-file; reuse the `Env` type from `src/types.ts` instead by typing the param as `Pick<Env, "DIRECTORY">`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/worlds.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/worlds.ts test/worlds.test.ts
git commit -m "feat(worlds): getEffectiveWorlds — KV override layer over code base"
```

---

## Task 4: Worker endpoints + effective-aware `/w/` and sitemap

**Files:**
- Modify: `src/worker.ts` (import at top; routes near the `/daily/schedule` admin block ~L275; `getWorld` use ~L513; sitemap ~L591)

- [ ] **Step 1: Add the import** (top of `src/worker.ts`, alongside the existing `./worlds.ts` import at line 12)

Change:
```ts
import { getWorld, listWorlds } from "./worlds.ts";
```
to:
```ts
import { getWorld, listWorlds, getEffectiveWorlds, getEffectiveWorld } from "./worlds.ts";
import { normalizeOverrides, WORLD_OVERRIDES_KEY } from "./world-overrides.ts";
```

- [ ] **Step 2: Add the three routes** (insert immediately after the `/daily/schedule` block, ~L288)

```ts
    // Public effective Worlds registry (code base + admin KV overrides). Powers the
    // live client strip, the /w/<slug> page, and the sitemap.
    if (url.pathname === "/worlds.json" && req.method === "GET") {
      const list = await getEffectiveWorlds(env);
      return new Response(JSON.stringify(list), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    // Admin: read effective list + base (for the manager editor).
    if (url.pathname === "/admin/worlds" && req.method === "GET") {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!env.DAILY_ADMIN_TOKEN || token !== env.DAILY_ADMIN_TOKEN) {
        return new Response("unauthorized", { status: 401 });
      }
      const effective = await getEffectiveWorlds(env);
      return new Response(JSON.stringify({ base: WORLDS_FOR_ADMIN(), effective }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    // Admin: write the override doc.
    if (url.pathname === "/admin/worlds" && req.method === "POST") {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!env.DAILY_ADMIN_TOKEN || token !== env.DAILY_ADMIN_TOKEN) {
        return new Response("unauthorized", { status: 401 });
      }
      let raw: unknown;
      try { raw = await req.json(); }
      catch { return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: { "content-type": "application/json" } }); }
      const result = normalizeOverrides(raw, WORLDS_FOR_ADMIN());
      if (!result.ok) {
        return new Response(JSON.stringify({ error: result.reason }), { status: 400, headers: { "content-type": "application/json" } });
      }
      await env.DIRECTORY.put(WORLD_OVERRIDES_KEY, JSON.stringify(result.value));
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }
```

- [ ] **Step 3: Add the `WORLDS_FOR_ADMIN` import helper**

The base array is `WORLDS` in `src/worlds.ts`. Export it for the admin route by adding to the Step-1 import line:
```ts
import { getWorld, listWorlds, getEffectiveWorlds, getEffectiveWorld, WORLDS } from "./worlds.ts";
```
Then replace the two `WORLDS_FOR_ADMIN()` calls above with `WORLDS` directly (they were a placeholder for the base array):
```ts
      return new Response(JSON.stringify({ base: WORLDS, effective }), { ... });
      // and:
      const result = normalizeOverrides(raw, WORLDS);
```

- [ ] **Step 4: Make `/w/<slug>` effective-aware** (at ~L513 where `getWorld(worldMatch[1])` is called)

Change:
```ts
      const world = getWorld(worldMatch[1]);
```
to:
```ts
      const world = getEffectiveWorld(await getEffectiveWorlds(env), worldMatch[1]);
```

- [ ] **Step 5: Make the sitemap effective-aware** (at ~L591)

Change:
```ts
  for (const w of listWorlds()) urls.push(`${origin}/w/${w.slug}`);
```
to (ensure the enclosing function has `env`; the sitemap builder is called from the fetch handler — pass `env` through if needed):
```ts
  for (const w of await getEffectiveWorlds(env)) urls.push(`${origin}/w/${w.slug}`);
```

> If the sitemap helper does not currently receive `env`, thread it through: add `env` to its parameter list and pass it at the call site. If that is invasive, leave the sitemap on `listWorlds()` (static) for this slice and note it — the sitemap is non-critical and stale slugs there are harmless. Prefer threading `env` if it is a one-liner.

- [ ] **Step 6: Verify nothing else used `getWorld` synchronously in a way this breaks**

Run: `grep -n "getWorld\b" src/worker.ts`
Expected: only the `/w/` page site (now effective-aware). If `isWorldSlug` is used elsewhere for routing, leave it (static membership check for routing is fine; the page resolution is what must be effective-aware).

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/worker.ts
git commit -m "feat(worlds): /worlds.json + admin read/write routes; effective-aware /w and sitemap"
```

---

## Task 5: Client `hydrateWorlds` + `loadWorlds`

**Files:**
- Modify: `public/worlds.js`
- Test: `test/worlds-client.test.js` (new; uses the `/worlds.js` alias)

- [ ] **Step 1: Write the failing test**

```js
// test/worlds-client.test.js
import { describe, it, expect, beforeEach } from "vitest";
import { WORLDS, listWorlds, getWorld, hydrateWorlds } from "/worlds.js";

describe("worlds.js hydration", () => {
  beforeEach(() => hydrateWorlds(WORLDS)); // reset to base between tests

  it("listWorlds reflects a hydrated list", () => {
    hydrateWorlds([
      { id: "z", slug: "zed", name: "Zed", blurb: "b", editionId: "default", featured: true, order: 0 },
    ]);
    expect(listWorlds().map((w) => w.slug)).toEqual(["zed"]);
    expect(getWorld("zed").name).toBe("Zed");
  });

  it("getWorld stops resolving slugs that were hydrated away", () => {
    hydrateWorlds([]);
    expect(getWorld("wordul")).toBe(null);
  });

  it("ignores a non-array payload (keeps current list)", () => {
    hydrateWorlds(null);
    expect(listWorlds().length).toBe(WORLDS.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/worlds-client.test.js`
Expected: FAIL — `hydrateWorlds` is not exported.

- [ ] **Step 3: Implement** — refactor `public/worlds.js` to read from a mutable list.

Replace the top of the file (the `export const WORLDS = [...]` stays as the static fallback) and the `BY_SLUG` + getter functions with:

```js
// public/worlds.js  (WORLDS const array stays exactly as-is above this block)

// Runtime list: starts as the static base, replaced by hydrateWorlds() once the
// effective registry (code + admin KV overrides) is fetched at boot.
let CURRENT = [...WORLDS];
let BY_SLUG = new Map(CURRENT.map((w) => [w.slug, w]));

// Replace the runtime registry. Ignores non-arrays so a failed fetch is harmless.
export function hydrateWorlds(list) {
  if (!Array.isArray(list)) return;
  CURRENT = list.slice().sort((a, b) => a.order - b.order);
  BY_SLUG = new Map(CURRENT.map((w) => [w.slug, w]));
}

// Fetch the effective registry from the worker and hydrate. Safe to call once at boot.
export async function loadWorlds() {
  try {
    const res = await fetch("/worlds.json", { cache: "no-store" });
    if (res.ok) hydrateWorlds(await res.json());
  } catch {
    /* keep the static fallback */
  }
}

export function listWorlds() {
  return [...CURRENT].sort((a, b) => a.order - b.order);
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
```

Leave `worldSlugFromPath` unchanged (it is a pure regex, no registry dependency).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/worlds-client.test.js`
Expected: PASS.

- [ ] **Step 5: Run the existing worlds test too (no regression)**

Run: `npx vitest run test/worlds.test.ts`
Expected: PASS (server twin unaffected).

- [ ] **Step 6: Commit**

```bash
git add public/worlds.js test/worlds-client.test.js
git commit -m "feat(worlds): client hydrateWorlds + loadWorlds (effective registry at boot)"
```

---

## Task 6: Wire boot fetch into app.js + hub.js

**Files:**
- Modify: `public/app.js` (import line 28; boot/init)
- Modify: `public/hub.js` (import line 6; boot/init)

- [ ] **Step 1: Add `loadWorlds` to the app.js import** (line 28)

Change:
```js
import { getWorld, worldSlugFromPath, listWorlds, featuredWorlds } from "/worlds.js";
```
to:
```js
import { getWorld, worldSlugFromPath, listWorlds, featuredWorlds, loadWorlds } from "/worlds.js";
```

- [ ] **Step 2: Await `loadWorlds()` before the Worlds strip first renders**

Find the app boot/init function (search for the top-level init that runs on DOMContentLoaded or the module's bottom-of-file bootstrap). Add, as early as is safe in async init and **before** the first call that renders the Worlds theater (the `featured`/`all` tabs at `app.js:5000`):

```js
  await loadWorlds(); // hydrate effective registry before rendering the Worlds strip
```

If app boot is not already `async`, wrap the registry-dependent render so it runs after hydration — e.g. call `loadWorlds().then(renderWorldsStrip)` at the point the strip is first built, rather than making the whole boot async. Choose the smallest change that guarantees hydration precedes the strip render.

- [ ] **Step 3: Same for hub.js** (import line 6)

Change:
```js
import { featuredWorlds } from "/worlds.js";
```
to:
```js
import { featuredWorlds, loadWorlds } from "/worlds.js";
```
And before the featured loop at `hub.js:119` first runs, ensure `await loadWorlds()` has completed (await it in the hub's async init, or gate the strip render behind `loadWorlds().then(...)`).

- [ ] **Step 4: Typecheck (JS is not type-checked, so just syntax-load it)**

Run: `node --check public/app.js && node --check public/hub.js`
Expected: no output (syntax OK).

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/hub.js
git commit -m "feat(worlds): hydrate effective registry at app + hub boot"
```

---

## Task 7: Studio CRUD core (`studio-worlds-core.js`)

**Files:**
- Create: `public/studio-worlds-core.js`
- Test: `test/studio-worlds-core.test.js`
- Modify: `vitest.config.ts` (add alias)

- [ ] **Step 1: Add the vitest alias** (in `vitest.config.ts`, inside the `resolve.alias` array, next to the `vibe-studio-core` line)

```ts
      { find: /^\/studio-worlds-core\.js$/, replacement: new URL("./public/studio-worlds-core.js", import.meta.url).pathname },
```

- [ ] **Step 2: Write the failing test**

```js
// test/studio-worlds-core.test.js
import { describe, it, expect } from "vitest";
import { addWorld, removeWorld, moveWorld, updateField, buildOverrides } from "/studio-worlds-core.js";

const base = [
  { id: "a", slug: "a", name: "A", blurb: "ba", editionId: "default", featured: true,  order: 0 },
  { id: "b", slug: "b", name: "B", blurb: "bb", editionId: "yang",    featured: false, order: 1 },
];

describe("studio-worlds-core", () => {
  it("updateField returns a new list with one field changed", () => {
    const out = updateField(base, "a", "name", "AA");
    expect(out.find((w) => w.id === "a").name).toBe("AA");
    expect(base.find((w) => w.id === "a").name).toBe("A"); // immutable input
  });

  it("addWorld appends a new world with a derived id and next order", () => {
    const out = addWorld(base, { slug: "c", name: "C", editionId: "default" });
    const added = out.find((w) => w.slug === "c");
    expect(added).toBeTruthy();
    expect(added.order).toBe(2);
    expect(added.id).toBeTruthy();
  });

  it("removeWorld drops by id", () => {
    expect(removeWorld(base, "a").map((w) => w.id)).toEqual(["b"]);
  });

  it("moveWorld swaps order with the neighbor", () => {
    const out = moveWorld(base, "b", -1); // move b up
    expect(out.find((w) => w.id === "b").order).toBeLessThan(out.find((w) => w.id === "a").order);
  });

  it("buildOverrides diffs a working list against base: edit", () => {
    const working = updateField(base, "a", "name", "AA");
    const ov = buildOverrides(working, base);
    expect(ov.edits.a).toEqual({ name: "AA" });
    expect(ov.added).toEqual([]);
    expect(ov.deleted).toEqual([]);
  });

  it("buildOverrides detects an added world", () => {
    const working = addWorld(base, { slug: "c", name: "C", editionId: "default" });
    const ov = buildOverrides(working, base);
    expect(ov.added).toHaveLength(1);
    expect(ov.added[0].slug).toBe("c");
  });

  it("buildOverrides detects a deletion", () => {
    const working = removeWorld(base, "a");
    const ov = buildOverrides(working, base);
    expect(ov.deleted).toEqual(["a"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/studio-worlds-core.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```js
// public/studio-worlds-core.js
// Pure CRUD transforms for the World manager. No DOM, no fetch.
// A "world" is { id, slug, name, blurb, editionId, featured, order }.

const FIELDS = ["slug", "name", "blurb", "editionId", "featured", "order"];

export function updateField(list, id, key, value) {
  return list.map((w) => (w.id === id ? { ...w, [key]: value } : w));
}

export function addWorld(list, partial) {
  const order = list.reduce((m, w) => Math.max(m, w.order), -1) + 1;
  const slug = (partial.slug || "new-world").toString();
  const id = uniqueId(list, slug);
  const w = {
    id,
    slug,
    name: partial.name || "New World",
    blurb: partial.blurb || "",
    editionId: partial.editionId || "default",
    featured: !!partial.featured,
    order,
  };
  return [...list, w];
}

export function removeWorld(list, id) {
  return list.filter((w) => w.id !== id);
}

// dir: -1 (up) or +1 (down). Swaps the `order` value with the adjacent world.
export function moveWorld(list, id, dir) {
  const sorted = [...list].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((w) => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return list;
  const a = sorted[i], b = sorted[j];
  return list.map((w) => {
    if (w.id === a.id) return { ...w, order: b.order };
    if (w.id === b.id) return { ...w, order: a.order };
    return w;
  });
}

// Diff a working list against the code base -> override doc the server understands.
export function buildOverrides(working, base) {
  const baseById = new Map(base.map((w) => [w.id, w]));
  const workingIds = new Set(working.map((w) => w.id));
  const edits = {};
  const added = [];
  const deleted = [];
  for (const w of working) {
    const b = baseById.get(w.id);
    if (!b) { added.push({ ...w }); continue; }
    const diff = {};
    for (const k of FIELDS) if (w[k] !== b[k]) diff[k] = w[k];
    if (Object.keys(diff).length) edits[w.id] = diff;
  }
  for (const b of base) if (!workingIds.has(b.id)) deleted.push(b.id);
  return { edits, added, deleted };
}

function uniqueId(list, slug) {
  const taken = new Set(list.map((w) => w.id));
  let id = slug;
  let n = 1;
  while (taken.has(id)) id = `${slug}-${n++}`;
  return id;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/studio-worlds-core.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add public/studio-worlds-core.js test/studio-worlds-core.test.js vitest.config.ts
git commit -m "feat(studio): pure World-manager CRUD core (add/edit/remove/move/buildOverrides)"
```

---

## Task 8: Studio manager page (HTML + controller) + studio link

**Files:**
- Create: `public/studio-worlds.html`
- Create: `public/studio-worlds.js`
- Modify: `public/vibe-studio.html` (add a link)

- [ ] **Step 1: Create the page shell**

```html
<!-- public/studio-worlds.html -->
<!doctype html>
<html lang="en" data-themed="0">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>World Manager · Wordul Studio</title>
  <link rel="stylesheet" href="/style.css" />
  <style>
    .wm-wrap { max-width: 880px; margin: 0 auto; padding: 24px 16px 80px; }
    .wm-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .wm-token { width: 100%; margin: 12px 0 20px; padding: 10px 12px; border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); background: rgba(0,0,0,.35); color: inherit; }
    .wm-row { display: grid; grid-template-columns: 1.2fr 2fr 1fr auto auto; gap: 8px; align-items: center;
      padding: 10px; border-radius: 12px; background: rgba(255,255,255,.04); margin-bottom: 8px; }
    .wm-row input, .wm-row select { width: 100%; padding: 6px 8px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.3); color: inherit; }
    .wm-actions { display: flex; gap: 6px; }
    .wm-bar { position: sticky; bottom: 0; display: flex; gap: 10px; justify-content: flex-end;
      padding: 14px 0; background: linear-gradient(transparent, rgba(0,0,0,.6) 30%); }
    .wm-status { min-height: 1.4em; opacity: .85; }
    button { cursor: pointer; }
    button.danger { color: #ff8a8a; }
  </style>
</head>
<body>
  <div class="wm-wrap">
    <div class="wm-head">
      <h1>World Manager</h1>
      <a href="/vibe-studio">← Studio</a>
    </div>
    <input id="adminToken" class="wm-token" type="password" placeholder="Admin token (Bearer)" autocomplete="off" />
    <div id="rows"></div>
    <button id="addBtn">+ Add World</button>
    <div class="wm-bar">
      <span id="status" class="wm-status"></span>
      <button id="revertBtn" class="danger">Revert all</button>
      <button id="saveBtn">Save changes</button>
    </div>
  </div>
  <script type="module" src="/studio-worlds.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the controller**

```js
// public/studio-worlds.js
import { addWorld, removeWorld, moveWorld, updateField, buildOverrides } from "/studio-worlds-core.js";
import { EDITIONS } from "/editions/index.js";

const TOKEN_KEY = "wordul.admin.token";
const $ = (id) => document.getElementById(id);

let BASE = [];     // code defaults (read-only reference)
let working = [];  // editable effective list

const tokenInput = $("adminToken");
tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";
tokenInput.addEventListener("input", () => localStorage.setItem(TOKEN_KEY, tokenInput.value.trim()));

function authHeaders() {
  return { "content-type": "application/json", Authorization: `Bearer ${tokenInput.value.trim()}` };
}

function setStatus(msg, ok = true) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = ok ? "" : "#ff8a8a";
}

function editionOptions(selected) {
  return EDITIONS.map((e) => `<option value="${e.id}" ${e.id === selected ? "selected" : ""}>${e.id}</option>`).join("");
}

function render() {
  const rows = $("rows");
  const sorted = [...working].sort((a, b) => a.order - b.order);
  rows.innerHTML = "";
  for (const w of sorted) {
    const row = document.createElement("div");
    row.className = "wm-row";
    row.innerHTML = `
      <input data-id="${w.id}" data-k="slug"  value="${escapeAttr(w.slug)}"  placeholder="slug" />
      <input data-id="${w.id}" data-k="name"  value="${escapeAttr(w.name)}"  placeholder="name" />
      <select data-id="${w.id}" data-k="editionId">${editionOptions(w.editionId)}</select>
      <label><input data-id="${w.id}" data-k="featured" type="checkbox" ${w.featured ? "checked" : ""}/> ★</label>
      <span class="wm-actions">
        <button data-id="${w.id}" data-act="up">↑</button>
        <button data-id="${w.id}" data-act="down">↓</button>
        <button data-id="${w.id}" data-act="del" class="danger">✕</button>
      </span>`;
    rows.appendChild(row);
  }
}

function escapeAttr(s) { return String(s ?? "").replace(/"/g, "&quot;"); }

$("rows").addEventListener("input", (e) => {
  const t = e.target;
  const id = t.getAttribute("data-id"); const k = t.getAttribute("data-k");
  if (!id || !k) return;
  const val = t.type === "checkbox" ? t.checked : t.value;
  working = updateField(working, id, k, val);
});

$("rows").addEventListener("click", (e) => {
  const t = e.target; const id = t.getAttribute("data-id"); const act = t.getAttribute("data-act");
  if (!id || !act) return;
  if (act === "up") working = moveWorld(working, id, -1);
  if (act === "down") working = moveWorld(working, id, +1);
  if (act === "del") { if (confirm("Delete this World?")) working = removeWorld(working, id); }
  render();
});

$("addBtn").addEventListener("click", () => {
  working = addWorld(working, { slug: "new-world", name: "New World", editionId: EDITIONS[0].id });
  render();
});

$("revertBtn").addEventListener("click", async () => {
  if (!confirm("Revert ALL worlds to code defaults? This clears admin overrides.")) return;
  await save({ edits: {}, added: [], deleted: [] }, "Reverted to defaults.");
});

$("saveBtn").addEventListener("click", async () => {
  await save(buildOverrides(working, BASE), "Saved.");
});

async function save(overrides, okMsg) {
  setStatus("Saving…");
  try {
    const res = await fetch("/admin/worlds", { method: "POST", headers: authHeaders(), body: JSON.stringify(overrides) });
    if (res.status === 401) return setStatus("Unauthorized — check the admin token.", false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setStatus(`Save failed: ${body.error || res.status}`, false);
    setStatus(okMsg);
    await load(); // re-pull effective state
  } catch (err) {
    setStatus(`Network error: ${err}`, false);
  }
}

async function load() {
  setStatus("Loading…");
  try {
    const res = await fetch("/admin/worlds", { headers: authHeaders() });
    if (res.status === 401) { setStatus("Enter the admin token to load worlds.", false); return; }
    if (!res.ok) { setStatus(`Load failed: ${res.status}`, false); return; }
    const { base, effective } = await res.json();
    BASE = base; working = effective.map((w) => ({ ...w }));
    render(); setStatus("");
  } catch (err) {
    setStatus(`Network error: ${err}`, false);
  }
}

if (tokenInput.value) load(); else setStatus("Enter the admin token to load worlds.", false);
tokenInput.addEventListener("change", () => { if (tokenInput.value) load(); });
```

- [ ] **Step 3: Link the manager from the Studio** (`public/vibe-studio.html`)

Add a small link near the top of the studio body (e.g. just after the opening header/title element):
```html
<a href="/studio-worlds" class="studio-nav-link">World Manager →</a>
```
(Place it wherever the existing studio header lives; exact selector is whatever wraps the studio title.)

- [ ] **Step 4: Syntax-check the JS**

Run: `node --check public/studio-worlds.js`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add public/studio-worlds.html public/studio-worlds.js public/vibe-studio.html
git commit -m "feat(studio): World Manager page — admin CRUD UI wired to /admin/worlds"
```

---

## Task 9: Full verification + browser smoke

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass (existing 895 + the new world-overrides, worlds-client, studio-worlds-core tests).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (no output).

- [ ] **Step 3: Local dev browser smoke** (the real proof)

Run: `npm run dev` (wrangler dev). Then, in a browser (or the `browse` skill):
1. Visit `/worlds.json` → confirm JSON array of 7 worlds.
2. Set a local `DAILY_ADMIN_TOKEN` for dev (e.g. `.dev.vars` with `DAILY_ADMIN_TOKEN=devtoken`), restart dev.
3. Visit `/studio-worlds`, paste `devtoken`, confirm the 7 worlds load.
4. Rename one (e.g. "Jackpot" → "Jackpot Royale"), toggle a featured flag, **Save** → expect "Saved."
5. Reload `/worlds.json` → confirm the rename + featured change persisted.
6. Visit `/` (home) → confirm the strip shows the new name / featured set (hydration works).
7. Click **Revert all** → confirm `/worlds.json` returns to defaults.

Document the result (pass/fail per step) in the session notes.

- [ ] **Step 4: Final commit (if any smoke fixes were needed)**

```bash
git add -A
git commit -m "fix(studio): world-manager smoke-test corrections"
```

---

## Self-Review notes (author)

- **Spec coverage:** override model (T1), validation (T2), server effective+endpoints+auth (T3,T4), live client hydration (T5,T6), manager UI (T7,T8), testing (T1,T2,T3,T5,T7 + T9 smoke). All spec sections mapped.
- **Type consistency:** `WorldOverrides {edits,added,deleted}` identical across `src/world-overrides.ts`, `studio-worlds-core.buildOverrides`, and the server route. `WorldDef` fields (`id,slug,name,blurb,editionId,featured,order`) consistent throughout. `getEffectiveWorlds(env)` / `getEffectiveWorld(list,slug)` signatures used consistently in T3/T4.
- **Auth:** single `DAILY_ADMIN_TOKEN` bearer on both admin routes; public `/worlds.json` open by design.
- **Known soft spots flagged inline:** (a) sitemap `env` threading (T4 S5 has a fallback); (b) exact app.js/hub.js boot insertion point is described by behavior, not line number, because boot structure must be read at execution time.
