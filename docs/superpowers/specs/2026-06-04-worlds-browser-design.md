# Worlds — design v1

**Date:** 2026-06-04
**Status:** Approved (brainstorm) → ready for implementation plan
**Owner:** Zang

---

## The core idea

A **World** is a themed place you can visit, share, and play in. It unifies three
concepts wordul currently treats separately:

- a **theme** — its skin (palette, fonts, motion, companion voice)
- a **room** — people can be inside it together
- a **language** (future) — its word pool

This is mostly an *integration* job, not a greenfield build. The engine already
exists: `RoomSnapshot` carries `vibeTitle`, `colorScheme`, `story`, `voice`, and the
Room Durable Object already does "theme applied → everyone in the room sees it." We
are building the **front door** to an engine that's already running.

The one-line strategy: **don't build "themes," "rooms," and "languages" as three
features — they're one `World` primitive.** v1 ships the *browsing front door* for it.

---

## Launch World set

The 7 existing editions (`default`, `jackpot`, `arcade`, `editorial`, `tactile`,
`robot`, `yang`) plus **Daily**, each promoted to a World with a `slug`, display name,
and its existing palette.

### Source of truth (layered)

```
static WORLDS defaults in code   ← safe fallback, always present
        +
admin overrides in KV            ← live edits win
```

A `WORLDS` registry (sibling to `MODES` in `src/modes.ts`) defines the code defaults.
Each World: `id`, `slug`, `name`, `editionId`, `featured: boolean`, `order: number`.
At read time, KV overrides are merged on top (override wins; code default is the
fallback if no override exists).

---

## Three surfaces

### 1. Home strip
A horizontal row of self-painted, themed `wordul-card`s, placed **near** the
Solo / 1v1 / Arena modes grid. Each card renders **in its own World's skin** — name +
that World's palette — so the strip is a *wall of vibes* that sells itself. The card
**is** the preview; no counts/streak clutter on the card itself.

- **Placement:** below the modes grid at launch; order is a **one-line config swap**
  so it can be promoted above the grid (A/B or by decision) if engagement says it's
  fire. Do **not** hardcode the order.
- Ends with a **"Browse all Worlds →"** card linking to `/worlds`.

### 2. `/worlds` — the theater
The full tabbed wall, an indexable destination page (SEO win).

- Tabs: **Active** (default — live heartbeat) · **Featured** (curated set) · **Mine**
  (home set + streaks).
- Layout: wall of the same themed `wordul-card`s.
- "Mine" in v1 = *home set / recently played* (per-World streaks are noted but OUT of
  v1). "Created by me" is a future UGC sub-filter.

### 3. `/w/<slug>` — a World page
A World is a place with a shareable, indexable URL (`wordul.com/w/space-pirates`).
Hybrid model:

- **Play solo in this skin** (always available)
- **Join the live race** (when the World's live room is active)
- Counts surfaced here, not on the wall cards.
- **Never a ghost town:** when live count is 0, fall back to "played today" + bot
  liquidity. The card/page must never read as abandoned.

---

## Skin behavior (the "demoted toggle")

- **Visiting a World applies its skin for that visit only** — you're trying it on, not
  committing.
- It becomes your **default** *only* when you explicitly choose so **from settings
  while inside that World** — a contextual "Make this World my default" action.
- The old "pick from a list of 7 themes" toggle in settings is **removed** and
  **replaced** by this single contextual default-setter. Nobody's look changes without
  asking. The default persists in `localStorage` (`wordul.edition`).

---

## Admin editing

Admins can **fully edit** the default Worlds without a deploy: palette, name, story,
voice, word — the works.

- **Admin accounts (hardcoded for now):** `yan`, `zang`, `yanik`, `antonio`.
- **Auth:** a simple username gate. **Real auth is being built in a separate effort**
  and will replace this gate — do not build auth here.
- **Editor:** reuse the existing **Vibe Studio** (currently draft). "Edit this World"
  appears on `/w/<slug>` for admins → opens Vibe Studio **pre-loaded with that World's
  current config** → saves a **KV override** layered over the code default.
- One editor, two uses: admin-edits-defaults now; public UGC publishing later.

---

## Data flow

- **Card render:** each card reads its World's palette from the (merged) registry and
  self-paints, reusing the `applyEdition` logic scoped to the card element.
- **Live counts (Active tab + World page):** reuse the existing Arena **DIRECTORY
  (KV)** + Room DO connection counts. Each World has a well-known public room path
  `world/<slug>`, seeded by the existing liquidity bots so it's never empty. Count
  feeds "● N playing now"; falls back to "played today" when truly quiet.
- **Entering / setting default:** explicit default-set writes `wordul.edition`; visit
  applies skin transiently.
- **Admin edit:** Vibe Studio save → KV override keyed by World `id`/`slug` → merged
  over code default on next read.

---

## Error / edge handling

- **0 live players** → show "played today" + bot/next-event fallback; never render
  `● 0` as the headline.
- **Unknown slug** → graceful 404 → redirect to `/worlds`.
- **Mid-game theme lock** (already exists) is respected — entering a World mid-game
  queues the skin change rather than repainting an active board.
- **KV override malformed / missing** → fall back to code default for that World.
- **Non-admin hits edit path** → gate blocks; no edit affordance shown.

---

## Testing

- **Unit:** `WORLDS` registry integrity (every World resolves to a valid edition);
  KV-override merge (override wins, missing → default); slug → World resolution + 404;
  card self-paint applies correct palette; admin username gate (allow listed, deny
  others).
- **Integration:** strip renders the featured set in config order; `/worlds` tabs
  filter correctly (Active/Featured/Mine); `/w/<slug>` resolves and applies skin;
  live-count fallback never shows a ghost town; "set as default" persists and survives
  reload; admin "Edit this World" opens Vibe Studio pre-loaded and a save round-trips
  through KV.

---

## Explicitly OUT of v1 (YAGNI)

- **UGC publishing** — admin-edit reuses the editor, but *public* World submission
  stays out.
- **Language-as-World word pools** — `lang` is designed as a future World field; not
  built now.
- **Monetization** (cosmetic/creator/sponsored Worlds).
- **Scheduled live events / countdowns.**
- **Per-World streaks** — the retention hook is noted; the strip/theater ship first.

These are deliberately deferred. The v1 win is: **Worlds are browsable, shareable,
admin-curatable places.** Everything else builds on that primitive.

---

## Why this sequencing

The breakthrough is that the `World` data model is already ~half-built into
`RoomSnapshot`. Shipping the *browser* before more authoring turns existing latent
capability into a visible, shareable, indexable product surface — converting a private
cosmetic preference (a settings toggle) into a **multiplayer + discoverability + viral**
surface, for mostly integration cost.

### Key existing files this builds on
- `src/types.ts` — `RoomSnapshot` fields (`vibeTitle`, `colorScheme`, `story`, voice)
- `src/room.ts` + `src/room-core.ts` — theme-bound-to-room Room DO
- `src/arena.ts` — DIRECTORY (KV) discovery + liquidity-bot seeding (reused for counts)
- `src/modes.ts` — registry pattern the `WORLDS` registry mirrors
- `public/edition.js` / `public/editions/*` — the 7 editions = launch Worlds
- `public/settings.js` — theme picker (transformed into contextual default-setter)
- `public/hub.js` — home shell (gets the strip)
- `public/vibe-studio.{html,js}` — reused as the admin World editor
- `public/i18n.js` — locale engine (future `lang`-as-World)
