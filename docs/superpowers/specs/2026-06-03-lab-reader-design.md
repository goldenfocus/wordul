# In-App Living Lab Reader — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorm), pending implementation

## Problem

The Living Lab Feed ships server-rendered HTML for crawlers/AI plus `/feed.json`, but a **human** who opens `/feed` gets the SPA shell, which has no `/feed` screen and falls back to the home view. So the feed link "bounces to home." The deferred piece — a human-readable, in-app reader — is what this adds.

## Goal

Let a person **read the studies in plain language, blog-style**: `/feed` is a list of discovery cards (each with a small intro); tapping one opens that day's full discovery at `/feed/<date>`. Entry point: a link from the daily page.

## Non-goals (YAGNI for v1)

- No pillar filtering, search, or tag navigation.
- No in-app weekly page (`/feed/weekly` stays crawler-only for now).
- No worker changes — this consumes the live `/feed.json` and `/feed/<date>.json` already on prod.
- No new nav in the home launcher (the parallel home-redesign session owns that surface).

## Architecture

Mirror the existing `daily-stats.js` + `showDailyStats()` pattern (a pure view-model file + a thin fetch-and-render screen).

### New file: `public/feed.js` (pure, testable view-models — no DOM, no fetch)

- `computeFeedStreamView(feedJson)` → `{ empty: boolean, cards: Array<{ date, title, intro, pillars }> }`
  - `title` = post.headline. `intro` = `post.editorial?.intro` when an admin wrote one, else a composed lead from the day's findings (join the first 1–2 `finding.text` sentences). `pillars` passed through. `empty` true when no published cards.
- `computeFeedPostView(postJson)` → `{ title, intro, findings: string[], notes: Array<{ title, note, citation?, pillar }>, pillars }`
  - `findings` = `post.findings.map(f => f.text)`. `notes` = `post.brainNotes`. `intro` same rule as above.
- Both are deterministic and import no Cloudflare/DOM APIs → unit-tested in `test/feed-view.test.js`.

### `public/app.js` (minimal, surgical)

- `parseRoute()`: add `/feed` → `{ kind: "feed" }` and `/feed/<YYYY-MM-DD>` → `{ kind: "feed-post", date }` (placed with the other `/daily*` matches; they don't overlap).
- Screen dispatch: add `showFeed()` (fetch `/feed.json`, render stream cards into `#app`; card tap → `navigate("/feed/" + date)`) and `showFeedPost(date)` (fetch `/feed/<date>.json`; on 404 → friendly "not published yet" + link back to `/feed`).
- Both render via the `feed.js` view-models; loading + empty + error states handled.
- **Entry link** on the daily page: a quiet "🧠 See what the lab learned" that calls `navigate("/feed")`. Placed on the per-day **stats** view (`renderDailyStatsBody`) — already a per-day, data-themed page → lowest collision, thematically aligned.

### `public/style.css`

- Additive only: blog-card list styles (`.lab-card`), the post layout (`.lab-post`), brain-note callouts (`.lab-note[data-pillar]`), and the empty state. No edits to existing rules.

## Data flow

`#app` ← `showFeed()` ← `fetch("/feed.json")` ← (live worker, already deployed). The server-rendered crawlable prose is untouched; this is a parallel human surface over the same data.

## Empty state (true today)

Prod science currently has `playerFinishes: 0` for recent days, so `/feed.json` returns an empty stream. The reader shows: *"The lab hasn't published a discovery yet — play a few days and check back."* It comes alive automatically as gameplay data accumulates.

## Testing

- `test/feed-view.test.js`: `computeFeedStreamView` (empty vs populated, editorial-intro vs composed-intro, card shape) and `computeFeedPostView` (findings/notes mapping, intro rule). Pure-logic, like `daily-stats.test.js`.
- `npm run check-graph` covers the new `public/feed.js` import in `app.js`.
- Manual: `wrangler dev` → `/feed` renders cards (or empty state), tap → `/feed/<date>` post, back button works.

## Collision strategy (active parallel session)

The home-redesign session is deploying `app.js`/`hub.js`/`style.css` every ~15 min. Mitigation: all logic in net-new `public/feed.js`; keep `app.js`/`style.css` edits tiny and additive; rebase on `origin/main` immediately before integrating and claim the COLONY deploy lane before any deploy.
