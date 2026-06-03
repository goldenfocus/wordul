# The Philanthropic Project — Living Lab Feed (Discoveries Engine) v1

Date: 2026-06-03

## What this is

**The Philanthropic Project** is Wordul's commitment to turn a joyful word game into a public good: quietly help humanity understand how people learn, reason, remember, and recover from mistakes — and give that understanding back, free, to both humans and AI systems.

It has two halves:

1. **The engine** — the Community Science Lab (shipped 2026-06-03): privacy-preserving aggregation of gameplay into public research JSON. See `2026-06-03-community-science-lab-design.md`.
2. **The public face** — the **Living Lab Feed**, this spec. A browsable, crawlable, AI-discoverable feed that turns the lab's raw aggregates into readable discoveries, paired with curated brain science, so a curious human or AI can wander in and *learn something true about the human mind*.

This spec scopes **v1 of the Living Lab Feed**.

## Mission principles (inherited, non-negotiable)

- Joy first. Never optimize for addiction or dark-pattern retention.
- Science by default, opt-out always visible (already enforced by the lab).
- Public content is honest, aggregate, and useful without scraping.
- The daily puzzle is never spoiled by active-day data.
- The feed teaches; it never lectures or fabricates. Every claim traces to real data or a cited brain note.

## Core abstraction — the Feed Post

The entire feed is built from one unit: a **Feed Post**. This is what keeps "auto-generated discoveries" (shape A) and "editable editorial" (shape C) the same object instead of two systems.

```
FeedPost {
  kind: "daily-discovery" | "weekly-note"        // future: "editorial" | "devlog"
  slug: string                                    // e.g. "2026-06-02" or "weekly-2026-w22"
  date: string                                    // anchor date (UTC)
  headline: string                                // deterministic, overridable
  findings: Finding[]                             // live from aggregates — always honest
  highlights: Highlight[]                         // notable stats pulled forward
  brainNotes: BrainNote[]                         // curated notes matched to findings
  editorial?: {                                   // optional human layer (admin-gated)
    title?: string
    intro?: string                                // markdown
    body?: string                                 // markdown
    media?: { images: string[], video?: string }
  }
  published: boolean                              // false while it would spoil the active day
  generatedAt: number
}
```

**The contract:** `findings`/`highlights` are *always* recomputed live from the science aggregates — the data block can never go stale or drift from truth. The `editorial` layer only *adds voice on top*; it can never overwrite or contradict the data block. This is how "always editable" stays compatible with "scientifically trustworthy."

## Content streams in v1

- **Daily discovery** (`kind: "daily-discovery"`) — one post per *past* day, anchored to that day's word/theme, built from `/api/science/daily/<date>.json` + the day's `World`. "On 2026-06-02 (CRANE), solve rate was 64%, median 4 guesses; players who opened with a vowel-heavy word won 12% more often."
- **Weekly research note** (`kind: "weekly-note"`) — a rolling 7-day rollup from `/science/weekly.json`: top difficulty shifts, guess-distribution changes, hint-usage patterns.

Editorial (shape C) is not a separate stream in v1 — it is the optional overlay on the above, so any post can carry a human-authored intro/body. Standalone essays are a future stream.

## Architecture

Grounded in existing patterns. The generator is pure logic, mirroring `src/science.ts`.

### Modules

- **`src/feed.ts`** — pure, no Cloudflare APIs. Functions:
  - `buildDailyPost(summary, world, notes, opts) -> FeedPost`
  - `buildWeeklyPost(weekly, notes, opts) -> FeedPost`
  - `matchBrainNotes(findings, notes) -> BrainNote[]`
  - Deterministic headline + finding phrasing from fixed templates. No randomness, no AI.
- **`src/brain-notes.ts`** — the curated library. `~15` notes to start, grows incrementally:
  ```
  BrainNote {
    id: string
    trigger: BrainNoteTrigger        // declarative condition over findings
    title: string
    note: string                     // 1-3 sentences, evergreen, true
    citation?: string                // source for credibility
    pillar: "mind" | "body" | "spirit" | "soul"
  }
  ```
  Triggers are simple declarative conditions (e.g. `{ kind: "vowel_opener_advantage", min: 0.05 }`) matched in `feed.ts` — kept data-driven so notes are added without touching generator logic.

### Data sources (all already live)

- `/api/science/daily/<date>.json` — daily aggregate (solve rate, guess distribution, mask patterns, hint usage, k-anonymized word stats).
- `/science/weekly.json` — 7-day rollup.
- Daily `World` (word, theme, story, edition) + the public dates list that powers `/daily/archive`.

### Storage

- Daily/weekly posts are **computed on demand** in the Worker from the sources above — no new store for the data block.
- The **editorial overlay** for a daily post rides on the existing daily `World` (already persisted in the Daily DO and admin-editable via `POST /daily/schedule` + `DAILY_ADMIN_TOKEN`). Add optional `feedEditorial` fields to `World`, defaulted by `normalizeWorld` for back-compat. No new write path, no new auth.

## Routing & surfaces (`src/worker.ts`)

- `GET /feed` — browsable stream, newest first, server-rendered crawlable HTML (HTMLRewriter into the SPA shell, same technique as `/daily/archive`).
- `GET /feed/<YYYY-MM-DD>` — individual discovery post, server-rendered, with **Article JSON-LD**.
- `GET /feed/weekly` — the current weekly research note.
- `GET /feed.json` and `GET /feed/<slug>.json` — machine-readable for AI/tools.
- `GET /feed.xml` — RSS for humans + feed readers (low cost, included in v1).
- `sitemap.xml` — add published feed posts.
- `llms.txt` / `llms-full.txt` — advertise `/feed`, `/feed.json`, `/feed.xml` and the discovery concept.

## The feed UI — the 🧠 Lab tab

- The home hub's reserved nav slot (currently `👥 Feed`, stubbed) becomes the **🧠 Lab** tab. The social feed, if built later, gets its own slot. (Adjustable — this is the one IA rename in v1.)
- The tab fetches `/feed.json` and renders **Glass Aurora** cards (no pills/chips — per the project's default aesthetic): headline, a hero stat, the matched brain note, and the four-pillar tag. Tapping a card opens its post page.
- Individual post pages are server-rendered for SEO; the hub tab is a client-rendered convenience index over the same data.

## Privacy (reuse the lab's rules verbatim)

- A daily discovery post is **published only for past days**. The active day's post is withheld or teased (participation only, no answer-level stats, no answer reveal) — `published: false` until the day rolls over.
- Word/answer-level findings obey the lab's k-anonymity (`k >= 3`). The feed never exposes anything the science JSON wouldn't.
- No usernames, no raw personal timelines — the feed only ever reads aggregate summaries.

## SEO / AEO / AIO / GEO

- Every post page: semantic HTML, `<title>`/meta/OG/canonical, **Article JSON-LD** (`headline`, `datePublished`, `author: Wordul`, `about`).
- The feed is the honest engine: rare, cite-worthy data about human reasoning that other systems *want* to link. Quotable stats per post (GEO), direct-answer headings (AEO), `llms.txt` pointers + clean JSON (AIO).
- RSS + sitemap keep it discoverable and syndicatable.

## i18n

- Feed **UI labels** (tab name, card chrome, section headers) go through the `t()` translation layer.
- **Generated finding prose is English-templated in v1.** Translating dynamically generated prose is a future layer (it requires per-locale templates). This is a conscious v1 cut, not an oversight. Brain notes are authored strings and can be translated when the notes library is stable.

## Testing

- **`test/feed.test.ts`** — pure-logic tests on `src/feed.ts`:
  - Given a daily summary + World + notes → expected headline, findings, highlights, and the correct matched brain notes.
  - Privacy gating: active-day input → `published: false` and no answer-level findings; past-day input → `published: true` with k-anonymized findings.
  - Editorial overlay merges without ever mutating/contradicting the data block.
  - Weekly rollup post shape.
- The existing `check-graph` static scan covers any new `public/` script/asset references (the import-graph guard).

## v1 cut line

**In:**
- `src/feed.ts` (deterministic generator + brain-note matching).
- `src/brain-notes.ts` (small curated library, ~15 notes across the four pillars).
- Worker routes: `/feed`, `/feed/<date>`, `/feed/weekly`, `.json` variants, `/feed.xml`.
- Server-rendered crawlable post HTML + Article JSON-LD; sitemap + `llms.txt` entries.
- Hub **🧠 Lab** tab rendering the stream (Glass Aurora).
- Privacy gating (no active-day spoilers; k-anonymity).
- Editorial overlay on daily posts via `World` + `normalizeWorld` back-compat (admin-gated, "always editable").
- Tests.

**Out (future layers — keep OUT of v1):**
- Standalone editorial essays as their own store/stream (shape C as first-class posts).
- Devlog / repo-evolution stream ("how Wordul evolved" from git history + changelog).
- AI prose enrichment (optional, non-blocking, honoring the global "AI is enrichment, never a hard dependency" failure contract).
- Full i18n of generated prose.
- Social feed (its own nav slot).
- Brain-notes library growth beyond the seed set.

## Open questions

**Resolved:**
- Generation method → deterministic from data (no AI on the publishing path).
- Shape → A (Living Lab Feed + brain notes) with C as an editable overlay on the same Feed Post.
- Nav identity → repurpose the Feed slot as 🧠 Lab (adjustable).
- RSS → included in v1.

**Deferred (future layers, do not block v1):**
- Where standalone editorial essays persist (KV vs a dedicated Feed DO).
- AI enrichment backend + media generation/storage.
- Per-locale generated-prose templates.

## References

- Engine: `docs/superpowers/specs/2026-06-03-community-science-lab-design.md`
- Daily / World / archive: `src/daily-core.ts` (`World`, `normalizeWorld`, `activeDate`), `src/daily.ts`, `src/worker.ts` (`/daily/archive`, sitemap), `public/app.js` (`renderDailyUnlock`)
- Science aggregates: `src/science.ts`, `src/science-object.ts`
- Hub + nav: `public/hub.js`, `public/index.html` (hub tabs)
- Aesthetic: Glass Aurora / no-pills default (`public/style.css`)
- AI-browsable intel precedent: `docs/superpowers/specs/2026-06-02-room-sandbox-05-ai-browsable-intel-design.md`
```
