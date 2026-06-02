# Wordul of the Day — Design (Spec #1: Engine + World bundle + Home takeover)

**Status:** approved design, pre-implementation.
**Author:** Yan + Claude (Opus 4.8).
**Date:** 2026-06-02. **Revised:** 2026-06-02 (home-page takeover + gated reveal + goodies).

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

**The Daily is the front door.** `wordul.com/` *is* today's Wordul. A returning
player lands straight on the day's puzzle. The puzzle is a sealed box: you must
**complete it** (win or give up) to unlock what's underneath — the leaderboard,
the chat ("what people are saying"), the story behind the word, and a goody (free
gold + a "why this word" note/tip). Then the next logical move is one tap away:
**keep playing live** — jump into rooms where people are worduling right now.

That full vision decomposes into ~4 subsystems:

| # | Subsystem | Depends on |
|---|-----------|-----------|
| **1** | **Daily engine + World bundle + home takeover** (THIS SPEC) | nothing |
| 2 | Bonus-word discovery gameplay | #1 |
| 3 | Daily leaderboard + rich social/browse | #1 |
| 4 | Curator handoff (winner authors a future day) | #1, #2/#3 |

**This spec is #1 only.** It is the foundation, designed so #2–#4 plug into seams
already present.

## Goal of this spec

Ship a themed, async, globally-shared daily puzzle that rolls over at **00:00 UTC**,
**takes over the home page** (`/` = today's puzzle, returning players auto-dropped
in), **gates its rewards behind completion** (finish to unlock leaderboard + chat +
story + goody), drops a **goody** on finish (free gold + a "why this word"
note/tip), bridges into **live play** ("keep playing now"), and leaves behind an
eternal, SEO-rich permalink for every day. Worlds are hand-seeded for now via a
runtime store that the curator handoff (#4) will later write into — so no throwaway
architecture.

## Non-goals (reserved seams, deferred to later specs)

- **Bonus-word discovery gameplay** — the `bonusWord` field exists in the data
  shape, but no hinting/finding/scoring behavior is built here (→ #2).
- **Curator handoff & "note from the day's winner"** — `curator` field exists
  (credit + broadcast message), but winner-tracking, the authoring/scheduling/
  promotion flow, and surfacing the note in the unlock are not built here (→ #4).
- **Rich social browse layer** beyond the room's existing scoreboard + chat and the
  minimal "live rooms right now" peek (→ #3).
- **Multi-username farming defense** — out of scope; honest username-level
  one-attempt enforcement only (identity hardening handled by the secured-economy
  / identity work later).

## Decisions (locked)

- **Shape:** one global daily puzzle for the whole world.
- **Front door:** `wordul.com/` **is** today's Wordul (home-page takeover).
  Returning players are dropped straight into today's puzzle. The existing
  room-creation / live-play home moves to a clearly-linked secondary surface
  (`/play`). `/`'s canonical resolves to `/daily/<today-UTC>`.
- **Play model:** **async one-shot** — play once, anytime in the 24h window; result
  posts to that day's leaderboard. No "everyone live at once" requirement.
- **Reveal gate (hard):** while playing you see only your own board. **Completing**
  the day (win OR give up) unlocks the whole "underneath" in one payoff moment:
  leaderboard, chat, story, goody. This *widens the existing per-viewer reveal
  model* — today the room already reveals the answer only once a viewer is
  personally done; the daily extends that same `reveal` gate to cover the rest of
  the experience. Existing race rooms are unaffected.
- **Goody on finish (v1):** (a) a **free gold drop** (a daily completion bonus on
  top of the score-based mint), and (b) the **story** rendered as the cool-vibe
  reveal plus a short **tip** line. The winner's note is deferred (#4).
- **Keep-playing bridge:** the unlock includes a "play live now →" CTA and a small
  peek at rooms with activity right now (read from the room directory). Full browse
  is #3.
- **Anti-cheat (this spec):** the room records **one scored attempt per username per
  day**; a daily room never resets a player's board, so a finished player stays
  finished. New-username farming is knowingly ignored for now.
- **World storage:** a new **`DAILY` Durable Object** holds the schedule
  (date→World) + deterministic fallback. Hand-seeded now; the curator handoff
  writes here later. Worlds and their day-rooms are **eternal artifacts** (never
  deleted) and SEO-optimized.
- **Admin-seed auth:** `Authorization: Bearer <DAILY_ADMIN_TOKEN>` (set via
  `wrangler secret put`); checked in the worker before proxying `POST
  /daily/schedule` to the DAILY DO. If the secret is unset, the route rejects.
- **Fallback word selection:** FNV-1a 32-bit hash over the `YYYY-MM-DD` string,
  modulo the 5-letter answer-pool length. Deterministic, dependency-free, stable
  per date, varies across dates.
- **Bonus word & winner note:** reserve the fields only.

## Architecture

Three pieces: a new conductor DO, the reused room machinery (with a daily-mode
fork), and a home/worker/frontend takeover.

### `DAILY` Durable Object (new, system-singleton)

The conductor. Addressed by a fixed name (`idFromName("daily")`). Owns:

- `schedule`: persisted map `YYYY-MM-DD` → `World` (curated bundles).
- **Today resolution:** the active UTC date string (`YYYY-MM-DD`, UTC), via a shared
  pure `activeDate(nowMs)` used by both the DO and the worker (one definition).
- **Deterministic fallback:** for any date lacking a curated World, derive a stable
  word from the 5-letter answer pool via FNV-1a over the date string (never
  `Math.random`), wrapped in a generic "house" World (default edition/voice,
  auto-generated story stub). Same date always yields the same fallback.
- **Seeding:** admin-only `POST /schedule` writes/overwrites a World for a date.
- **Resolution endpoint** the worker + room call: given a date (defaulting to
  today), return the resolved `World` (curated or fallback), and record the date in
  a `dates` set.
- **Dates endpoint:** sorted list of known dates (curated ∪ resolved) for the
  archive + sitemap.

### Per-day `ROOM` Durable Object (reuse + daily-mode fork)

A "day" is a normal `ROOM` addressed by `idFromName("daily/<YYYY-MM-DD>")`, **never
deleted**, with daily-specific behavior toggled by an `isDaily` marker:

- **Self-seeded:** a room whose path starts with `daily/` detects this on first
  contact and pulls its World from the `DAILY` DO (word + edition + story + voice).
  The word stays server-side (never sent to a still-playing client). The room locks
  to that word for the whole day and goes straight to `playing` (no host "start").
- **Async one-shot, one scored attempt per username:** each player joins, plays
  their guesses, reaches won/lost — that is their single scored result, recorded
  once (gold mint + goody). A daily room never resets a board (no `start`/`rematch`/
  `set_length`/`set_mode`/`set_edition`), so a finished player stays finished and a
  re-join just restores their finished board. No bots in daily rooms.
- **Per-player completion** (not a global room finish): scoring/gold/goody fire when
  *that* player completes, since players arrive asynchronously all day.
- Reuses board, chat, presence, scoreboard, gold as-is.

### Home / worker / frontend takeover

- `/` serves the SPA shell with **today's** daily meta injected (canonical
  `/daily/<today>`); the client renders the daily-home and auto-connects to room
  `daily/<today>`.
- `/daily/<YYYY-MM-DD>` serves the SPA shell with that day's meta + story prose +
  JSON-LD + prev/next injected (the eternal artifact).
- `/play` is the old home (create/join/browse live rooms) — SPA-routed, no special
  meta.
- The client gates the "underneath" (leaderboard, chat, story, goody, bridge) on
  the snapshot's reveal flag — shown only once the viewer is finished.

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
    tip?: string;          // short "advice" line shown with the unlock (goody)
  };
  curator?: {              // RESERVED (#4): credit + broadcast + note; absent today
    username: string;
    message: string;
  };
  createdAt: number;       // epoch ms
}
```

## Flow

1. Player hits `/` (or `/daily`). The worker injects today's daily meta (canonical
   `/daily/<today>`) and serves the shell; the client connects to room
   `daily/<today>`.
2. The room (path `daily/<date>`) self-seeds from `DAILY` on first contact: locks
   the World's word + edition + story + voice, marks `isDaily`, goes to `playing`.
3. Returning players are dropped straight onto the board. The "underneath"
   (leaderboard, chat, story, goody, bridge) is **locked**.
4. Player plays **once**. On completion (win or give up) the room records their
   scored result against their username (a second scored attempt is impossible — the
   board never resets), mints score-based gold **plus the daily goody gold**, and
   the per-viewer snapshot flips `reveal` true for them.
5. The client unlocks the underneath: frozen leaderboard, chat, the story
   (`story.body` + `tip`), the goody confirmation, and the "play live now →" bridge.
6. At 00:00 UTC the active date advances; `/` and `/daily` now resolve to a fresh
   day's room. Yesterday's room is untouched and permalinked at `/daily/<date>`
   forever.

## URLs & SEO

| Path | What |
|------|------|
| `/` | Today's puzzle (home takeover). Canonical → `/daily/<today>`. |
| `/daily` | Convenience → resolves to today (redirect to `/`). |
| `/daily/<YYYY-MM-DD>` | That day's **eternal artifact**: board (spectate/replay), story, leaderboard, chat, prev/next links. Canonical = self. |
| `/daily/archive` | Calendar/index of all past days — internal link farm for crawlers. |
| `/play` | The old home: create/join/browse live rooms. |
| `/ws?room=daily/<YYYY-MM-DD>` | The day room's WebSocket (existing room WS path; no new transport). |

Each day page emits: `title` / `meta description` / OG / `canonical`, JSON-LD
(`WebPage` + `Game`/`CreativeWork`), the `story.body` rendered as real indexable
prose, the curator credit when present, and prev/next day links. `sitemap.xml`
gains `/`, `/daily/archive`, and every `/daily/<date>` (from the `DAILY` DO's dates
list); daily rooms do **not** register as normal `room:` directory entries (so they
don't leak as `/@daily/<date>`). `llms.txt` describes the daily.

## Testing

Vitest runs in a plain **node** environment (not `@cloudflare/vitest-pool-workers`),
so Durable Objects cannot be instantiated in tests — exactly as today, where no
`Room`/`User`/`worker` methods are unit-tested. **All testable logic lives in pure
functions** (in modules that do NOT import `cloudflare:workers`); the DO/worker glue
is thin and verified by build + manual smoke. Pure coverage:

- **Date + fallback:** `activeDate` across UTC midnight boundaries (incl.
  23:59:59 → 00:00:00); FNV-1a + `fallbackWord` (stable per date, varies across
  dates, in range); `houseWorld`/`resolveWorld` (curated overrides fallback);
  `normalizeWorld` (validate/normalize admin payload).
- **Routing/SEO helpers:** `dailyDateFromPathname`, `isValidDateString`,
  `buildDailyMeta`, `buildDailyJsonLd`, `dailyPrevNext`, `dailySitemapUrls`.
- **Daily-room helpers:** word-pick branch (daily uses World word, race uses
  random), per-player score-once guard, daily-lock predicate (which messages are
  rejected in daily mode).
- Follow the repo's vitest patterns (`test/**/*.test.ts`, `/`-aliased imports).

## Open items for the implementation plan (resolved here)

- ~~Admin-seed auth~~ → Bearer `DAILY_ADMIN_TOKEN`, checked in worker.
- ~~Fallback hash~~ → FNV-1a over `YYYY-MM-DD` mod 5-letter pool length.
- ~~Daily-mode storage + seed trigger~~ → `isDaily`/`story`/`voice` on `RoomSnapshot`,
  `scored` on `PlayerState`; lazy self-seed from `DAILY` on first `hello` to a
  `daily/*` room.
- Archive index pagination once day count is large (defer; small for now).
