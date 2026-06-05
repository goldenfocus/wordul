# Worduls — P1: Forge, Share & Play a World

> **Status:** Design approved 2026-06-04. Ready for implementation plan.
> **Scope:** P1 of the "publish authored worlds" decomposition. Ships the artifact + sharing + **solo play**.
> **Branch base note:** this design doc lives on `worduls-p1` (off `origin/main`). See [Prerequisites](#prerequisites) — implementation must not start until the accounts auth layer lands on main.

---

## 1. Vision & naming

A **wordul** is a *world* — Gollum-era pun, "worlds" → "worduls". It is a **venue**: a themed bundle
(headline word + palette + companion voice + guess rows + story) that **play modes consume**. It is a
"game inside the game."

- **The object / code term:** `world` (matches the existing `World` interface).
- **A user's collection:** "**@you's worduls**", at `/@you/worduls`.
- **One world:** `/@you/<slug>`.
- Reserve "daily" for the global once-a-day event; a creator's world is never called a "daily".

P1 ships the artifact, sharing, and **solo play**. 1v1 (P3) and arena (P4) reference the *same* world
later with **no refactor**, because the world is stored independently of any single play session.

### Naming reconciliation (resolves a 3-way clash)
The codebase already uses "world" twice: `World` (`daily-core.ts`) is the daily-puzzle bundle, and
`WorldDef` (`worlds.ts`) is the global **editions browser** at `/w/<slug>` (Jackpot, Arcade, …). The
user-authored creation is a *third* thing, so it takes the brand name in code to stay unambiguous:

| Concept | Code name | Lives at |
|---|---|---|
| Daily-puzzle bundle (a day's word+theme+story) | `World` | served to rooms by date |
| Global themed editions/skins | `WorldDef` | `/w/<slug>` |
| **User-authored published creation (this spec)** | **`Wordul`** in the **`Worduls` DO** | `/@you/<slug>`, gallery `/@you/worduls` |

Throughout this doc, where earlier drafts said "Worlds DO"/`OwnedWorld`, read **`Worduls` DO** /
**`Wordul`**. A `Wordul` *carries* a playable `World`-bundle subset; it is not a `World`.

---

## 2. The decomposition (context)

| Increment | Delivers |
|-----------|----------|
| **P1 (this spec)** | Submit persists a world owned by you at `/@you/<slug>`, listed in `/@you/worduls`, public, **solo-playable** with a per-world leaderboard + story reveal + share link. The full *create → share → watch plays tick up* loop. |
| P2 | Auto-generated OG share image (spoiler-masked board card). |
| P3 | 1v1 duel on a world. |
| P4 | Arena on a world. |
| Later | Remix, follow/channel, visibility tiers beyond public, content moderation, gold tipping. |

All later increments are **additive** — their data seams are reserved in P1 (see §7).

---

## 3. Architecture (Option B — dedicated world store)

### 3.1 Core principle
The **world (artifact)** is stored independently of the **room (play session)**:

- **`Worlds` Durable Object, one per owner** (`env.WORLDS.idFromName(username)`, SQLite-backed) —
  authoritative store of *that user's* worlds. Mirrors the `User` DO sharding model. Keeps worlds
  cleanly separate from profile/auth/economy data, and makes the gallery query ("list my worlds") a
  single-DO read.
- The static `worlds.ts` house editions stay as global code (unchanged). User worlds live in their
  owner's `Worlds` DO. They never collide: house editions are global skins; user worlds are owner-keyed.

### 3.2 A published world IS an owned room
Publishing creates **two** linked records:

1. The authoritative `OwnedWorld` in the owner's `Worlds` DO (the artifact).
2. An **owned room** at `/@you/<slug>` (the play venue) — reusing `ownedRooms[]`, the existing
   `/@user/<slug>` route, and the room's "resolve my World on first play" seam (`src/room.ts:540`,
   which today fetches a daily World via `/resolve?date=`).

We teach that resolve seam one new branch: a room whose path is `@owner/<slug>` resolves its World
from the owner's `Worlds` DO instead of from `Daily`. The room then runs **daily-style one-shot
semantics verbatim**: locked word, one attempt per player, per-world leaderboard, story reveal on
solve, post-solve chat — all already built.

### 3.3 Why not the alternatives (recorded)
- **A (world inside the room):** least P1 code, but traps the world in one play session → P3/P4
  (1v1/arena on the same world) need a painful refactor. Rejected.
- **C (worlds inline on USER DO):** simplest storage but every play does a cross-DO fetch anyway,
  `ownedRooms` is capped at 100, and it models "one world, many sessions" poorly. Rejected.

---

## 4. Data model

### 4.1 `OwnedWorld` (stored in `Worlds` DO, keyed by `worldId`)
Reuses the *playable* fields of the existing `World` interface (`src/daily-core.ts:4`) — **minus
`date`/`edition`** (irrelevant to owned worlds) — plus ownership, lifecycle, and reserved seams:

```ts
export interface OwnedWorld {
  // — identity & ownership —
  worldId: string;          // immutable, assigned at first save (rename/slug-change never orphans)
  owner: string;            // normalized username
  slug: string;             // URL slug under owner, e.g. "ocean-day"
  status: "draft" | "published" | "unpublished";
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;

  // — the playable bundle (subset of World, no date/edition) —
  vibeTitle: string;        // display title; e.g. "Ocean Day"
  word: string;             // headline word, UPPERCASE
  wordLocked: boolean;      // true once the first play is recorded → blocks word edits (no rug-pull)
  invented: boolean;        // intentional coinage; skip dictionary gate
  rows: number;             // 3–10
  voice: string;            // companion voice id
  story: { title: string; body: string; tip?: string };
  colorScheme: { a1: string; a2: string; a3: string };
  glow?: World["glow"];     // optional, reused verbatim
  images?: World["images"]; // optional, reused verbatim
  playlist?: World["playlist"];

  // — denormalized counters —
  plays: number;            // total distinct play sessions started (drives "watch it tick up")

  // — RESERVED seams (shape only in P1; no behavior) —
  visibility: "public";     // future: | {kind:"unlisted"; token} | {kind:"password"; hash} | {kind:"invite"; allow:string[]}
  remixedFrom?: { owner: string; slug: string; worldId: string };
}
```

### 4.2 Mapping an `OwnedWorld` → playable `World`
When a room resolves an owner-world, the `Worlds` DO returns a `World` synthesized from the
`OwnedWorld`: `date` set to a stable sentinel derived from `worldId` (the room machinery wants a
`date` string; owned worlds use `world:<worldId>` so leaderboards/keys stay unique and stable),
`edition: "owned"`, and the playable fields copied across. The room never sees ownership/lifecycle
fields — only the playable `World`.

### 4.3 `UserProfile` additions (`src/types.ts`)
- `ownedRooms[]` already exists — a published world appends one entry (path `@owner/<slug>`,
  tagged so the gallery can tell worlds from plain custom rooms, e.g. `kind: "world"`).
- **Reserved now (empty arrays, no behavior):** `follows: string[]`, `followers: string[]`.

### 4.4 Validation — small DRY refactor of `normalizeWorld`
`normalizeWorld` (`src/daily-core.ts:111`) today validates a full dated `World`. Extract its
field-level validation + defaulting (word length, dictionary gate vs `invented`, rows clamp, palette
defaults, story trim) into a shared pure helper `normalizeWorldBundle(input)`. Then:

- `normalizeWorld` = `normalizeWorldBundle` + `date`/`edition` handling (unchanged behavior; covered
  by existing tests).
- `normalizeOwnedWorld(input, owner)` = `normalizeWorldBundle` + ownership/slug/status assignment.

This keeps one source of truth for "is this a valid playable bundle" and avoids drift between daily
and owned worlds.

### 4.5 Content-safety seam (deliberately a no-op in P1)
`normalizeWorldBundle` calls `passesContentGate(word, title, story, slug)` which **returns `true`
unconditionally in P1**. The call site exists so a denylist is a ~10-line change later, not a repaint.
> ⚠️ **Deferred risk (owner: Zang):** worlds are public-by-default and allow invented
> (non-dictionary) words — the classic slur/abuse vector. Shipping P1 with no content gate is a
> deliberate product decision for an early, low-traffic surface. The seam above makes adding a
> denylist (and later a report button) additive.

---

## 5. Flows

### 5.1 Publish
1. Vibe Studio **"Submit my day →"** (currently inert, `public/vibe-studio.html:173`) becomes active.
   - If the visitor has **no claimed account**, route them to claim/login first (the accounts flow),
     then return to publish. Publishing requires an authenticated session.
2. Client builds the world from current Vibe Studio state, derives a slug from `vibeTitle`
   (editable in a small confirm step), and `POST /api/worlds` with the session **Bearer token**.
3. Worker → owner's `Worlds` DO `/publish`:
   - **Verify** the session token resolves to `owner` (owner-gated; reuses the accounts session check).
   - `normalizeOwnedWorld` (length, dictionary unless `invented`, palette defaults, **content gate
     no-op**).
   - **Slug:** slugify `vibeTitle` → `[a-z0-9-]`; `-2`, `-3`… on collision within the owner;
     **reserved words blocked** (`worduls`, `daily`, `settings`, `c`, `feed`, `ws`, `api`, `@…`).
   - Assign `worldId`, `status:"published"`, `publishedAt`, `plays:0`.
   - Append to USER DO `ownedRooms` (tagged `kind:"world"`) and register in DIRECTORY KV
     (`room:@owner/slug`) so the route + profile resolve it.
4. Returns `{ url:"/@owner/<slug>", worldId }`. Client redirects to the world page →
   **share link + live play counter (starts at 0, ticks up as people play).**

### 5.2 Solo play (the magic loop)
- Visiting `/@owner/<slug>` opens the room (existing `/@user/<slug>` route + SSR meta).
- On first play, the room resolves its World from the owner's `Worlds` DO (new branch in the resolve
  seam) and runs one-shot daily-style play. The `Worlds` DO **increments `plays`** on session start.
- On solve: per-world leaderboard entry, **story reveal**, post-solve chat unlock — all existing.

### 5.3 Edit & unpublish
- **Edit cosmetics anytime** (`vibeTitle`, `story`, `colorScheme`, `voice`, `rows`): Vibe Studio
  "edit" mode loads the world (`GET /api/worlds/<owner>/<slug>` — owner sees full record) →
  `PATCH /api/worlds/<slug>` (owner-gated). **`word` is immutable once `wordLocked`** (set true when
  the first play is recorded); the editor shows the word locked.
- **Unpublish:** `PATCH … {status:"unpublished"}` → hidden from gallery + discovery + DIRECTORY
  listing. The room, leaderboard, and chat are **preserved** (others' scores are their memories).
  **Never hard-deleted.**

### 5.4 Gallery
- `/@you/worduls` (and a section on `/@you`) lists the owner's **published** worlds as cards:
  title, palette swatch, **spoiler-masked board**, play count, **Play**.
- Owner-when-authed also sees `draft` / `unpublished` worlds (with an edit affordance).
- Backed by `GET /api/worlds/<owner>` (public → published only; owner token → includes drafts).

### 5.5 Sharing / OG
- World page SSR injects OG meta via the existing `injectMeta` path: **title + palette + masked
  board only — never the word.** (Auto-generated OG *image* is P2.)

---

## 6. API & routing (additions to `src/worker.ts`)

| Method & path | Auth | → | Purpose |
|---|---|---|---|
| `POST /api/worlds` | Bearer (owner) | owner `Worlds` DO `/publish` | Create + publish a world |
| `GET /api/worlds/:owner` | optional Bearer | `Worlds` DO `/list` | Gallery list (drafts only if owner) |
| `GET /api/worlds/:owner/:slug` | optional Bearer | `Worlds` DO `/get` | One world (full record if owner) |
| `PATCH /api/worlds/:owner/:slug` | Bearer (owner) | `Worlds` DO `/patch` | Edit cosmetics / unpublish |
| `GET /api/worlds/:owner/:slug/resolve` | internal | `Worlds` DO `/resolve` | Room fetches playable `World` (+ increments `plays`) |

- `/@owner/<slug>` and `/@owner/worduls` HTML routes go through the existing `/@user/...` handler
  with SSR meta injection (`worduls` resolves to the gallery; `<slug>` to a world page).
- Owner-gating reuses the accounts session verification (the same check `/api/account/me` uses).

### `wrangler.jsonc`
- New DO binding `WORLDS` → class `Worlds`, added to a **new migration tag** with
  `"new_sqlite_classes": ["Worlds"]` (matching the free-plan pattern used by `User`/`Daily`/`Arena`).

---

## 7. Reserved seams (shape only in P1)

| Seam | Where | Unlocks later |
|---|---|---|
| `visibility` (default `"public"`) | `OwnedWorld` | unlisted/secret-link (skip DIRECTORY), password (hash gate in room hello), invite (allowlist) |
| `remixedFrom` | `OwnedWorld` | remix tree + "remixed N times" |
| `follows` / `followers` | `UserProfile` | follow-an-author, daily-drop channel |
| `passesContentGate()` no-op | `normalizeWorldBundle` | denylist, then report button |
| `plays` counter | `OwnedWorld` | trending/featured discovery |

The visibility **gate must live server-side** in the room's hello path (where the daily-lock predicate
already lives), never client-only — same lesson as the daily-word-salt fix.

---

## 8. Edge cases (P1 must handle)

- **Unclaimed user hits Submit** → gate to claim/login, then resume publish.
- **Slug collision** → auto `-2`/`-3`; **reserved words blocked** (protects `/@you/worduls`).
- **Word lock** → `word` immutable once first play recorded; editor reflects it.
- **Duplicate words across worlds** → expected & fine; the **slug** is the unique key, not the word.
- **Author on own leaderboard** → exclude the author from their own world's ranking (cosmetic).
- **`ownedRooms` 100-cap** → published worlds count against it; surface a friendly limit message if hit
  (raising the cap is out of scope).
- **Username rename** → world paths (`@owner/slug`) and `ownedRooms` must migrate/alias. Rooms already
  slug-alias; the plan **must verify rename covers owner-worlds** (or explicitly note rename is
  unsupported until a later increment).

---

## 9. Testing

Follow existing vitest patterns:

- `normalizeWorldBundle` shared helper: valid bundle, length bounds, dictionary gate vs `invented`,
  rows clamp, palette defaults, story trim. (Existing `normalizeWorld` tests must still pass.)
- `normalizeOwnedWorld`: slug generation + collision suffix, reserved-word block, content-gate no-op
  passes through, ownership assignment.
- `Worlds` DO: publish (owner-gated, rejects wrong session), list (public hides drafts; owner sees
  them), get, patch (cosmetic edit; word-lock rejection after play), unpublish (hidden but preserved).
- Resolve-on-join for owner-world rooms returns the synthesized `World` and increments `plays`.
- Solo one-shot leaderboard records a play on an owner-world room.

---

## 10. Prerequisites

P1 implementation **depends on the accounts auth layer**, which is **not yet on `origin/main`**:

- ✅ On main: `User` DO, `worlds.ts` registry, `vibe-tune.ts`, the inert Submit seam, `/@user/<slug>`
  routing, the daily room engine + resolve-on-join seam.
- ❌ **Not on main:** the auth/session/claim layer (`account-core.ts` etc., on `wordul-accounts`).
  Owner-gated publish requires authenticated sessions.

**Therefore:** the accounts auth layer must merge to `main` first. The P1 build worktree should then
branch off the post-accounts `origin/main` (not the bare base this doc was written on). The
implementation plan will state this as a gate.

---

## 11. Explicitly out of scope for P1

1v1-on-world (P3), arena-on-world (P4), remix, follow/channel, visibility tiers beyond public,
content moderation/report, auto-OG-image (P2), gold tipping. All have reserved seams (§7).
