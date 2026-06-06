# Admin World Manager — Design Spec

**Date:** 2026-06-06
**Status:** Approved (brainstorming → planning)
**Worktree/branch:** `edit-current-world`
**Slice:** 1 of the unified "studio" vision (World listing/CRUD)

---

## North star (context, not this slice's scope)

Everything configurable in a Wordul "World" should be editable through one studio:
a typed config tree — identity, theme/palette, board, companion voice, word, story,
audio, images — **simple by default, granular when you want it** (progressive disclosure).
One declarative schema drives the editor UI, server validation, and runtime rendering.
Persistence is **layered overrides**: code defaults (base) → admin KV overrides →
(future) user-created worlds. Eventually opened to the public so anyone can make a
quick theme or a complex world.

We build this incrementally. **This spec is slice 1**: the registry + admin-auth +
override + studio-CRUD backbone that every later layer reuses.

## Goal of this slice

An admin can **add / edit / delete / reorder / feature** the existing Worlds (the
themed places at `/w/<slug>`), with changes persisted server-side and reflected live
in the game — without touching code.

## Current state (as found)

- **Worlds registry** is defined twice as a static array: server `src/worlds.ts`
  (`WORLDS: WorldDef[]`, consumed by `worker.ts:513` `getWorld` for the `/w/<slug>`
  page and `worker.ts:591` `listWorlds` for the sitemap) and a hand-synced browser
  twin `public/worlds.js` (consumed by `app.js` home strip/theater Featured+All tabs,
  `hub.js` featured strip, world routing). **The listing UI is entirely client-side**,
  rendered from the static twin.
- `WorldDef = { id, slug, name, blurb, editionId, featured, order }` (`src/worlds.ts:12`).
- 7 launch Worlds, one per shipped edition (`public/editions/*.js`, registry in
  `public/editions/index.js`).
- `worlds.ts:6` already documents the intent: "Plan 3 layers admin KV overrides on top
  of these code defaults."
- Bindings: `DIRECTORY` KV exists (`wrangler.jsonc`). Only admin gate that exists is
  `DAILY_ADMIN_TOKEN` bearer check (`worker.ts:277`). No admin/curator user role.

## Architecture: code base layer + KV override layer

Code stays the **base**. Admin edits are a **KV override layer** merged on top at
runtime. Non-destructive: revert = delete the override.

Override document — one JSON blob in `DIRECTORY` KV under key `worlds:overrides`:

```ts
type WorldOverrides = {
  edits:   Record<string, Partial<WorldDef>>; // field changes to code OR added worlds, keyed by id
  added:   WorldDef[];                          // brand-new worlds not in code
  deleted: string[];                            // ids hidden (tombstone for code worlds; removal for added)
};
```

**Effective list** = `(WORLDS ∪ added) − deleted`, with `edits` applied per id,
sorted by `order`. Implemented as a **pure function** `mergeWorlds(base, overrides)`.

## Data model & validation

Pure `normalizeOverrides(doc): { ok: true, value } | { ok: false, reason }`:

- `slug` matches `^[a-z0-9-]{1,40}$`; **unique** across the effective list.
- `name` non-empty, length-capped (e.g. ≤ 60); `blurb` length-capped (e.g. ≤ 140).
- `editionId` must be a **known edition id** (from the editions registry). New worlds
  reuse an *existing* theme — theme authoring is a later slice.
- `order` finite number; `featured` boolean; `id` non-empty stable string.
- Invalid → reject the **whole** save with a human-readable reason (no partial writes).

Added-world id generation: derive from slug (or a short stable token); must not
collide with an existing effective id.

## Server (`src/worker.ts`) + auth

- `GET /worlds.json` — **public**. Returns effective merged list. Powers the live
  client, the refactored sitemap, and `/w/<slug>` page resolution. Lightly cached.
- `GET /admin/worlds` — **admin**. Returns effective list **+ raw overrides** for the editor.
- `POST /admin/worlds` — **admin**. Body = full `WorldOverrides` doc →
  `normalizeOverrides` → write KV. `400` invalid, `401` bad/missing token, `200` ok.

New helper `getEffectiveWorlds(env)` (async: reads KV overrides, merges with code base,
returns sorted effective list). Replaces direct `listWorlds()`/`getWorld()` use in the
worker's `/w/` page and sitemap paths.

**Auth:** reuse the existing single admin secret `DAILY_ADMIN_TOKEN` as *the* admin
bearer (no new secret to provision). The manager UI holds the token in `localStorage`
and sends `Authorization: Bearer <token>`. The server is the real gate. Public,
per-user creation later swaps this for the account system (out of scope).

## Making edits go live (client wiring)

`public/worlds.js` keeps its static array as the **boot fallback** and gains
`hydrateWorlds(list)` (replaces the internal array + rebuilds the slug map). App/hub
boot fetches `/worlds.json` once and calls `hydrateWorlds` **before** rendering the
Worlds strip — unchanged worlds show no flash; edited worlds reflect immediately. The
synchronous getters (`listWorlds`, `featuredWorlds`, `getWorld`) keep working, now
returning hydrated state. The static twin is the seed/fallback, not the runtime source
of truth.

## The manager UI

Dedicated, isolated page (matches the existing isolated-studio pattern → zero risk to
the live SPA/game):

- `public/studio-worlds.html` + `public/studio-worlds.js` + pure
  `public/studio-worlds-core.js`, served at **`/studio/worlds`** (static-asset pretty
  URL, no worker route). Linked from `/vibe-studio`.
- A table of Worlds: inline-edit `name / blurb / slug / edition / featured / order`;
  reorder (arrows or drag); **+ Add World**; delete with confirm.
- "Save changes" POSTs the whole overrides doc to `/admin/worlds`; "Revert all" clears
  overrides. Admin-token field (stored in `localStorage`). Reuses the studio's
  Glass-Aurora styling.
- `studio-worlds-core.js` holds the pure CRUD state transforms (apply edit, add,
  delete, reorder, build overrides doc from current-vs-base diff) so the UI shell stays
  thin and the logic is unit-tested.

## Testing (TDD)

Pure cores first, tests before implementation:

- `mergeWorlds` — edits applied, added appended, deleted removed (code = tombstone,
  added = drop), order sort, idempotent.
- `normalizeOverrides` — slug format, slug uniqueness (incl. against code worlds),
  unknown editionId rejected, length caps, malformed → reason.
- `studio-worlds-core` CRUD transforms — add/edit/delete/reorder produce a correct
  overrides doc; round-trips through serialize/restore.

Server endpoints typecheck-verified (no DO/worker test harness exists, per repo
convention; vitest env is `node`).

## Out of scope (later slices)

Theme/palette authoring, companion voice editing, daily word/story authoring, public
user-created worlds, per-user admin roles, the generic schema-driven editor. Each is a
later slice built on this backbone.

## Risks / gotchas

- **Twin sync drift:** `src/worlds.ts` and `public/worlds.js` must keep identical base
  arrays. This slice doesn't change the base arrays, only adds the override layer — but
  the `hydrateWorlds` change to `public/worlds.js` has no server counterpart (server
  reads KV directly), which is fine.
- **Deleting a code World:** tombstone hides it from listings and should make
  `/w/<slug>` 404 (or redirect home). Worlds are themed *places*, not daily rooms, so
  no live-room invalidation needed.
- **Cache:** `/worlds.json` caching must be short / invalidated on save so admin edits
  appear promptly.
- **`featured` empty set:** if an admin unfeatures everything, the home "Featured" tab
  is empty — acceptable; UI can note it.
