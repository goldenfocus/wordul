# Wordul of the Day — Design (Spec #1: Engine + World bundle)

**Status:** approved design, pre-implementation.
**Author:** Yan + Claude (Opus 4.8).
**Date:** 2026-06-02.

## North star (the full vision, for context)

"Wordul of the Day" is a living, curated, 24-hour global event. Each day the whole
world gets **one curated puzzle** — not just a word, but a *world*: its own vibe,
voice, design skin, a main word, an optional hidden bonus word, and a story (why
this word, what it means, how it might improve your day). The day is a global
contest; eventually the **winner becomes the curator of a future day** — choosing
the next word, writing the broadcast message, picking the quirks, even spinning a
design ritual from the app. Past days never die: each is an **eternal, SEO-rich
permalinked artifact** — the word, the story, the curator credit, the frozen
leaderboard, the chat — indexed forever. Play → win → curate → your friends show up
to beat your word → they win → they curate. The puzzle generates its own next
puzzle *and* its own next audience.

That full vision decomposes into ~4 subsystems:

| # | Subsystem | Depends on |
|---|-----------|-----------|
| **1** | **Daily engine + World bundle** (THIS SPEC) | nothing |
| 2 | Bonus-word discovery gameplay | #1 |
| 3 | Daily leaderboard + rich social/browse | #1 |
| 4 | Curator handoff (winner authors a future day) | #1, #2/#3 |

**This spec is #1 only.** It is the foundation, designed so #2–#4 plug into seams
already present.

## Goal of this spec

Ship a themed, async, globally-shared daily puzzle that rolls over at **00:00 UTC**
and leaves behind an eternal, SEO-rich permalink for every day. Worlds are
hand-seeded for now via a runtime store that the curator handoff (#4) will later
write into — so no throwaway architecture.

## Non-goals (reserved seams, deferred to later specs)

- **Bonus-word discovery gameplay** — the `bonusWord` field exists in the data
  shape, but no hinting/finding/scoring behavior is built here (→ #2).
- **Curator handoff** — `curator` field exists (credit + broadcast message), but
  the authoring/scheduling/winner-promotion flow is not built (→ #4).
- **Rich social browse layer** beyond the room's existing scoreboard + chat (→ #3).
- **Multi-username farming defense** — out of scope; honest username-level
  one-attempt enforcement only (identity hardening handled by the secured-economy
  / identity work later).

## Decisions (locked)

- **Shape:** one global daily puzzle for the whole world.
- **Play model:** **async one-shot** — play once, anytime in the 24h window; result
  posts to that day's leaderboard. No "everyone live at once" requirement.
- **Anti-cheat (this spec):** server records **one scored attempt per username per
  day**; a second scored attempt is rejected. New-username farming is knowingly
  ignored for now.
- **World storage:** a new **`DAILY` Durable Object** holds the schedule
  (date→World) + deterministic fallback. Hand-seeded now; the curator handoff
  writes here later. Worlds and their day-rooms are **eternal artifacts** (never
  deleted) and SEO-optimized.
- **Bonus word:** reserve the field only.

## Architecture

Two pieces, reusing the existing room machinery.

### `DAILY` Durable Object (new, system-singleton)

The conductor. Addressed by a fixed name (e.g. `idFromName("daily")`). Owns:

- `schedule`: persisted map `YYYY-MM-DD` → `World` (curated bundles).
- **Today resolution:** given the current instant, compute the active UTC date
  string (`YYYY-MM-DD`, UTC).
- **Deterministic fallback:** for any date lacking a curated World, derive a stable
  word from the 5-letter answer pool via a seeded hash of the date string (stable,
  never `Math.random`), wrapped in a generic "house" World (default edition/voice,
  auto-generated story stub). Same date always yields the same fallback.
- **Seeding:** an admin-only `POST /daily/schedule` route writes/overwrites a
  World for a date. (Auth: a shared secret via `wrangler secret`, checked in the
  worker before proxying. Detail finalized in the plan.)
- Resolution endpoint the worker calls: given a date (defaulting to today),
  return the resolved `World` (curated or fallback).

### Per-day `ROOM` Durable Object (reuse)

A "day" is a normal `ROOM` addressed by `idFromName("daily/<YYYY-MM-DD>")`, **never
deleted**, with daily-specific behavior:

- **Seeded** by the worker/DAILY with the day's `word` + `World` (edition, voice,
  story, etc.) on first access. The room locks to that word for the whole day.
- **Async-scored, one attempt per username:** the room tracks which usernames have
  a *scored* result; a second scored attempt is rejected (the player may still
  spectate/chat). This is a daily-mode flag on the room, not a change to live-race
  rooms.
- Reuses board, chat, presence, scoreboard, gold as-is.

> The `ROOM` gains a "daily mode" marker (set at seed time) that flips it from
> live-race semantics to async one-shot. Existing race rooms are unaffected.

## Data shape — the `World` bundle (the contract)

```ts
interface World {
  date: string;            // "2026-06-02" — UTC day it belongs to
  word: string;            // main answer (UPPERCASE); length implied by string
  bonusWord?: string;      // RESERVED (#2): hidden word to discover; no behavior yet
  edition: string;         // design skin id (e.g. "yang", "obsidian")
  voice: string;           // companion voice id (e.g. "yang")
  story: {
    title: string;         // "Why EMBER?"
    body: string;          // markdown: meaning, why chosen, how it helps your day
  };
  curator?: {              // RESERVED (#4): credit + broadcast; null/absent today
    username: string;
    message: string;
  };
  createdAt: number;       // epoch ms
}
```

## Flow

1. Player hits `/daily`. The worker asks `DAILY` for today's UTC date + resolved
   `World`.
2. Worker resolves the `ROOM` `daily/<date>`; if unseeded, seeds it with the
   World (word + edition + voice + story, daily-mode on).
3. Worker serves the themed board (edition/voice from the World; story available).
4. Player plays **once**. The room records their scored result against their
   username; a second scored attempt is rejected.
5. Result posts to that day's leaderboard (lives in the day's room). Player may
   then spectate/browse/chat.
6. At 00:00 UTC the active date advances; `/daily` now resolves to a fresh day's
   room. Yesterday's room is untouched and permalinked at `/daily/<date>` forever.

## URLs & SEO

| Path | What |
|------|------|
| `/daily` | Today's puzzle. Canonical resolves to today's date. |
| `/daily/<YYYY-MM-DD>` | That day's **eternal artifact**: board (spectate/replay), story, curator credit, frozen leaderboard, chat, prev/next links. |
| `/daily/archive` | Calendar/index of all past days — internal link farm for crawlers. |
| `/ws?room=daily/<YYYY-MM-DD>` | The day room's WebSocket (existing room WS path; no new transport). |

Each day page emits: `title` / `meta description` / OG / `canonical`, JSON-LD
(`WebPage` + likely `Game`/`CreativeWork`), the `story.body` rendered as real
indexable prose, the curator credit when present, and prev/next day links.
`sitemap.xml` already auto-generates from rooms — daily rooms slot in (filter to
`daily/*` plus the archive index). `llms.txt` updated to describe the daily.

## Testing

- **DAILY DO unit tests:** today-date computation across UTC midnight boundaries
  (incl. rollover edge: 23:59:59 → 00:00:00); deterministic fallback is stable per
  date and varies across dates; schedule write/read; curated overrides fallback.
- **ROOM daily-mode tests:** seed locks the word; one scored attempt per username
  (second rejected); spectate/chat still allowed post-attempt; live-race rooms
  unaffected by the daily flag.
- **Worker routing tests:** `/daily` → today's room; `/daily/<date>` → that room;
  `/daily/archive` renders; SEO tags + JSON-LD present; sitemap includes daily.
- Follow the repo's vitest patterns (backend + frontend, `/`-aliased imports).

## Open items for the implementation plan (not blockers)

- Exact admin-seed auth mechanism (shared secret header vs. signed).
- Fallback word-selection hash function (e.g. FNV/CRC over the date → index).
- Archive index pagination once day count is large.
- Where "daily mode" flag is stored on `ROOM` state and how seed is triggered
  (lazy on first `/daily/<date>` hit vs. explicit seed call from DAILY).
