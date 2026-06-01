# Word Wiki — Design Spec

**Date:** 2026-06-01
**Status:** Approved (brainstorm) → ready for implementation plan
**Author:** brainstormed with Zang

## Summary

Turn the ephemeral end-of-game word reveal into a permanent, indexable mini-wiki.
Each of Wordul's **2,315 answer words** (all 5 letters) gets a static page at
`/word/<word>` that is *both* a genuinely fun learning artifact *and* a long-tail
SEO/AIO discovery engine. The game's most-engaged moment — the reveal — stops
pointing at Google and starts pointing inward, so the game's exhaust becomes its
own acquisition funnel.

Primary goal (decided): **both equally** — a real browsable word wiki *and* a
discovery surface.

## Why now / leverage

- 2,315 pieces of generated content (`def` + `fact` + `quote`) are currently
  trapped inside a modal that vanishes when closed.
- `app.js:2185` sends the highest-intent moment of the game to
  `google.com/search?q=<word>+meaning` — donating intent traffic to Google.
- The architecture already has every pattern we need: SSR meta-injection via
  `HTMLRewriter` (`worker.ts` profile/room routes), a dynamic `/sitemap.xml`
  (`worker.ts:42`), per-name Durable Objects (`ROOM`, `USER` via `idFromName`),
  and R2-backed asset serving (`/designs/*` → `DESIGNS` bucket).

## Scope

### In scope (v1)
- Static page per **answer word** (2,315), `/word/<lowercase-slug>`.
- Full server-rendered content (no JS needed for the core), AEO-shaped.
- Internal link graph (anagrams, ±1-letter neighbors, shared start) computed
  from `wordsbysize.ts` — zero AI.
- Templated per-word **OG card PNG**, built locally → R2 → served via worker.
- **Live per-word solve stats** (new `WORDSTATS` Durable Object) hydrated client-side.
- `/words` A–Z index + `/word/today` permalink.
- Sitemap, JSON-LD, `llms.txt` refresh.
- Flip the end-card "look it up" link inward.

### Out of scope (fast-follow)
- AI-generated illustrations (v1 uses templated OG cards only).
- Multi-sense definitions (v1 ships single `def`; dictionary fallback already
  surfaces multiple senses in-game).
- "Learn a word a day" newsletter.
- Dedicated anagram/solver SEO pages (`words ending in X`, etc.).
- Pages for guess-only (non-answer) words.

## Decisions (locked during brainstorm)

| Decision | Choice |
|---|---|
| Primary goal | Both: learning artifact **and** SEO engine |
| Per-word image | Templated OG card (no AI image model in v1) |
| Rendering | Static pre-render + client-side stats hydration |
| Stats panel | **In v1** (requires new per-word aggregation) |
| OG hosting | Build PNGs locally → R2 bucket → serve via worker (no repo bloat) |

## Architecture

### URL surface
- `/word/<slug>` — one page per answer word. Canonical = lowercase. Uppercase /
  trailing-slash variants 301/canonicalize to lowercase.
- `/word/og/<slug>.png` — OG card image, served from R2.
- `/words` — browsable A–Z index of all word pages.
- `/word/today` — 302/permalink to the current daily answer's page.
- `/api/word/<word>/stats` — JSON read endpoint for the stats panel.
- `/sitemap.xml` — extended to include every `/word/*` URL.

### Components

**1. Content corpus (`public/data/word-intel.js`)**
- Already powers the end-card; only 6 entries seeded so far.
- Run `scripts/gen-word-intel.mjs` to fill all 2,315 (Opus, merge-safe, resumable;
  hand-seeded entries never overwritten; quotes omitted rather than invented).
- Optional schema extension (backward-compatible extra keys): `etymology`,
  `pos` (part of speech), `syllables`, `usage` (2 real sentences), `mnemonic`.
  Missing keys degrade gracefully (section omitted).

**2. Link graph (new pure module, e.g. `scripts/lib/word-graph.mjs` or `src/wordgraph.ts`)**
- Input: the 2,315 answer words.
- Output per word: anagrams (same letters), ±1-letter "ladder" neighbors
  (change exactly one letter → another answer word), and shared-start words
  (same first 2–3 letters), capped to a sane count each.
- Pure + deterministic, no AI. Used at build time to render related-word links.

**3. Page generator (`scripts/gen-word-pages.mjs`)**
- Reads `word-intel.js` + the link graph + a single HTML template.
- Emits `public/word/<slug>.html` per answer word — fully rendered, no hydration
  needed for core content.
- Renders one OG card PNG per word locally (SVG template → PNG) → staged for R2
  upload (a separate `wrangler r2 object put` / upload step, not committed).
- Idempotent + re-runnable. Respects the exclusion blocklist (no page emitted).
- Generated HTML pages are **committed** (diffable, deploy via existing `public/`
  pipeline). OG PNGs are **not** committed — they live in R2.

**4. Worker routing (`src/worker.ts`)**
- `/word/og/<slug>.png` → fetch from new `OG` R2 binding (mirror `/designs/*`).
- `/word/<slug>` → serve the pre-built file from `ASSETS`; case/slash
  canonicalization; friendly 404 (non-answer / excluded word → links to `/words`
  + "play today's Wordul") instead of a bare miss.
- `/word/today` → resolve today's answer, redirect to its page.
- `/api/word/<word>/stats` → proxy to the word's `WORDSTATS` DO.
- `sitemap()` → append all `/word/<slug>` URLs (2,315; well under the 50k limit,
  one sitemap is fine).

**5. Per-word stats (`WORDSTATS` Durable Object)**
- New DO class, one instance per word via `env.WORDSTATS.idFromName(word)` —
  naturally sharded, same pattern as `USER`.
- State: `answered` count, `wins`, `guessDistribution` (Record<number, number>),
  derived `solveRate` + `avgGuesses`.
- Reuse the pure `applyGame` shape from `stats.ts` where possible.
- Bumped from `room.ts` at game-finish: alongside the existing
  `buildGameRecords` / `summarizeRoomGame` / `USER` fan-out (`room.ts:274`),
  fan out each finished player's `(result, guesses)` to the word's DO.
  - Idempotency: bump once per (player, finished round) — guard against double
    fan-out the same way the room already guards finish.
- Read endpoint returns `{ answered, solveRate, avgGuesses, guessDistribution }`
  or a `neverPlayed: true` sentinel.
- Requires `wrangler.jsonc` migration tag `v3` with
  `new_sqlite_classes: ["WordStats"]` (free plan requires new DOs be SQLite-backed,
  as `User` is on `v2`). Add `WORDSTATS` to the `durable_objects` bindings and to
  the `Env` interface in `src/types.ts`.

**6. Client (`public/app.js`)**
- Flip the "look it up" link (`app.js:2185`) from Google to `/word/<word>` when the
  word has a page (answer word + not excluded); otherwise keep the existing
  dictionary fallback link.
- On the word page itself, hydrate the stats panel: fetch `/api/word/<word>/stats`,
  fill numbers, render the "be the first to solve it" state for `neverPlayed`.
  Skeleton placeholder to avoid layout shift.

### Page anatomy (rendered HTML)
AEO-shaped headings so snippets / voice / AI lift cleanly:
1. **Hero** — word as Wordul tiles + pronunciation · part of speech · syllables.
2. **"What does <WORD> mean?"** — `def`.
3. **Did you know?** — `fact`.
4. **In the words of…** — `quote` + author (omitted when absent).
5. **Word origin** — `etymology` (omitted when absent).
6. **Quick facts (FAQ)** — "Is <WORD> a valid word?", "How many letters?",
   "What can you spell with these letters?" → drives `FAQPage` schema + snippets.
7. **Related words** — anagrams · ladder neighbors · shared start (internal links).
8. **How players do** — live stats panel (hydrated).
9. **CTA** — "Play today's Wordul →".
10. **Footer** — link to `/words` index.

### SEO / discovery plumbing
- Per page `<head>`: title `What does "<WORD>" mean? — definition, facts & word game`,
  meta description from `def`, canonical, OG (title/description/image/url), twitter card.
- JSON-LD per page: `DefinedTerm` + `WebPage` + `FAQPage` + `ImageObject` + breadcrumb.
- OG image: `og:image` → `/word/og/<slug>.png`, descriptive `alt` + filename (VEO).
- `/sitemap.xml` includes all word pages + `/words`.
- Refresh `public/llms.txt` / `public/llms-full.txt` to advertise the wiki + index.

## Edge cases

- **Exclusion blocklist** — answer words too sensitive to index get no public page;
  they still play in-game and their end-card keeps the dictionary fallback. Single
  source of truth (a list the generator + the end-card link logic both read).
- **Never-played word** — stats panel shows "be the first to solve it", not empty
  zeros (avoids thin-content feel).
- **No quote / no etymology** — section omitted, no empty headers.
- **Multiple meanings** — v1 ships single `def`; multi-sense is fast-follow.
- **Case / trailing slash** — canonicalize to lowercase, no trailing slash.
- **Recurring answers** — stats accumulate by word (DO keyed by word), never by date.
- **Quote integrity** — generator already refuses to invent quotes; keep that
  guardrail (a fabricated citation on a public indexed page is a real trust risk).

## Build sequence (phasing for the plan)

1. **Corpus** — extend intel schema (optional fields) + run `gen-word-intel.mjs`
   for all 2,315; spot-check a sample.
2. **Link graph** — pure module computing anagrams / ladder / shared-start.
3. **Page generator** — HTML template + `gen-word-pages.mjs` → committed pages;
   OG PNG render → R2 upload step.
4. **Worker serving** — `/word/*`, `/word/og/*`, `/words`, `/word/today`, sitemap,
   friendly 404; R2 `OG` binding.
5. **Stats DO** — `WORDSTATS` class + `v3` migration + `room.ts` finish-hook
   fan-out + `/api/word/<w>/stats` read endpoint.
6. **Client + SEO** — flip end-card link; hydrate stats panel; JSON-LD; OG;
   `llms.txt` refresh.

## Testing

- **Pure units (vitest):** link-graph (anagrams/ladder correctness, caps),
  `WordStats` aggregation (`applyGame`-style: answered/wins/dist/derived rates),
  slug canonicalization, exclusion-list filtering.
- **Generator:** golden-file test on a couple words (HTML contains expected
  sections, JSON-LD valid, omits absent quote/etymology).
- **Worker:** route resolution for `/word/<slug>` (hit), excluded/non-answer
  (friendly 404), `/word/today` redirect, sitemap includes word URLs.
- **Manual / browse:** render a sample page, verify OG card, verify end-card link
  now lands on `/word/<word>`, verify stats hydrate + never-played state.

## Open questions for the plan

- Exact R2 binding name + bucket (`OG` / `wordul-og`) and upload step ergonomics.
- Caps for related-word lists (how many anagrams/neighbors to show).
- Whether `/word/today` reads the daily answer from the same source the home page uses.
- Cost/time budget for the full `gen-word-intel` run (Opus × ~2,309 words).
