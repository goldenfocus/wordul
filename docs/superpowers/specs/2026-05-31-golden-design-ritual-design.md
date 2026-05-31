# Golden Design Ritual — Design Spec (v1)

**Date:** 2026-05-31
**Status:** approved, pre-implementation
**First consumer:** Wordul (`wordul.com`)

## Summary

A **global, reusable skill** (`golden-design-ritual`) that turns a "redesign X"
request into 2–4 playable, production-grade frontend prototypes and publishes them
**live** to the project's own website at `/designs/<slug>`. Previews are instantly
shareable, persist forever, and are built as real HTML/CSS/JS so the winning
direction can be promoted into the app in one pass.

It is the spiritual successor to brainstorming's *visual companion* (a throwaway
local browser preview) — but instead of localhost, it ships to the owner's live
site. Wordul is the first consumer; any project adopts it by dropping one config
file.

## Goals

- One command → several distinct, **clickable/playable** design directions.
- Published **live** to `<site>/designs/<slug>` — no local-only previews.
- **Insta**: after one-time setup, publishing is a pure upload — no git push, no
  redeploy.
- **Permanent**: prototypes live forever (durable object storage).
- **Reusable**: skill is global, behaviour driven by a per-project config file.
- **Promotable**: output is real frontend code, not a picture.

## Non-Goals (YAGNI)

- Auth / private previews.
- Per-slug version history.
- Comments, voting, analytics.
- Multi-bucket / multi-environment publishing.
- Automated promotion of a winning design into the app (stays a manual dev task).

## Architecture

Three isolated units, each with one purpose and a clear interface.

### Unit 1 — The skill

`~/.claude/skills/golden-design-ritual/SKILL.md`

Orchestrates the ritual and owns the per-project config contract.

Flow when invoked:

1. **Frame** — short clarifying volley: which surface, vibe/references, must-keeps,
   number of directions (default 3). Reuses brainstorming / visual-companion
   instincts. Keep it tight.
2. **Generate** — invoke the `frontend-design` skill to produce N *distinct*
   directions. Each prototype is a **single self-contained `.html`** file with
   inline CSS/JS and real interactions (e.g. a Wordle board you can type into).
   Written to `/tmp/`.
3. **Publish** — call `publish.sh` once per prototype; receive live URLs.
4. **Gallery** — `publish.sh` regenerates the index gallery.
5. **Report** — return the live links for click-through judging, plus the gallery
   URL.

Config contract: reads `.claude/design-ritual.json` from the repo root. If absent,
the skill asks the user for the values once and writes the file (never guesses the
bucket/site). Shape:

```json
{
  "site": "wordul.com",
  "publisher": "r2-worker",
  "r2_bucket": "wordul-designs",
  "designs_prefix": "designs/"
}
```

### Unit 2 — The publisher

`~/.claude/skills/golden-design-ritual/publish.sh`

Stack-agnostic upload script. Interface:

```
publish.sh <html-file> <slug> "<title>" [status]
```

For `publisher: "r2-worker"`:

- Uploads `<html-file>` → `s3://<r2_bucket>/<designs_prefix><slug>.html`
  (`text/html`) via `aws s3 cp` against the R2 S3 endpoint. Credentials resolved
  from wrangler OAuth token / golden-cloud secrets (never prompt for paste).
- Maintains `<designs_prefix>manifest.json` in the bucket: an array of
  `{ slug, title, date, status }`, idempotent upsert by `slug` (download, merge,
  re-upload).
- Regenerates `<designs_prefix>index.html` from the manifest: a simple card
  gallery (title, date, status badge, live link). Self-contained HTML.
- Prints the live `https://<site>/designs/<slug>` URL on success.

`status` defaults to `exploring`; the only other value is `shipped`.

Failure handling: a failed upload for one slug aborts **that** slug loudly
(non-zero exit, stderr) but does not corrupt the manifest or silently produce a
partial gallery. The skill surfaces which slugs published and which failed.

### Unit 3 — Wordul serving plumbing (one-time)

The live `wordle-race` Worker gains the ability to serve `/designs/*` from R2.

- Create R2 bucket `wordul-designs` (durable, permanent).
- `wrangler.jsonc`: add an R2 binding named `DESIGNS` → bucket `wordul-designs`.
- `worker.ts`: ahead of the existing ASSETS / `/ws` routing, add:
  - `path === "/designs" || path === "/designs/"` → serve `designs/index.html`
    from `DESIGNS`.
  - `path.startsWith("/designs/")` → strip leading `/`, fetch that object from
    `DESIGNS`; serve with its content type; on miss return a small 404
    "design not found" page (never fall through to the SPA/ASSETS handler).
  - all other paths → unchanged (existing behaviour).
- Deploy once, **coordinated with the other agent** working on the Worker (check
  their state / `.claude/COLONY.md` before editing + deploying so the change
  doesn't collide with in-flight game work).

After this one-time deploy, every future design is a pure R2 upload — no git push,
no redeploy, persistent forever.

## Data Flow

```
skill
  → frontend-design  → /tmp/<slug>.html (×N)
  → publish.sh       → R2: designs/<slug>.html
                            designs/manifest.json   (upsert)
                            designs/index.html      (regenerated)
  → Worker /designs/* proxy
  → https://wordul.com/designs/<slug>   (live, shareable, permanent)
```

## Error Handling

- **Missing config** → prompt for values and write `.claude/design-ritual.json`;
  do not guess bucket/site.
- **R2 upload failure** → abort that slug loudly (non-zero exit + stderr); keep
  successfully-published slugs; report the split. No silent partial gallery.
- **Worker proxy miss** → 404 with a tiny "design not found" page; never leak the
  ASSETS/SPA routing or serve the game shell for a bad `/designs/` path.
- **Credentials unavailable** → fail with a clear message pointing at wrangler
  login / golden-cloud enrollment; never prompt to paste secrets.

## Testing

- **publish.sh**: dry-run / unit check that it computes correct object keys,
  upserts the manifest by slug (no dupes), and regenerates valid `index.html`.
  Verify idempotency: publishing the same slug twice yields one manifest entry.
- **Worker proxy**: after the one-time deploy, `curl` `wordul.com/designs/`
  (gallery), a known `wordul.com/designs/<slug>` (200 + `text/html`), and a
  bogus slug (404 "design not found", not the game shell). Confirm non-`/designs/`
  routes (`/`, `/ws`) are unchanged.
- **End-to-end**: run the ritual for a throwaway slug, confirm the live URL serves
  the prototype and the gallery lists it.

## Promotion Path (manual, v1)

Because prototypes are real HTML/CSS/JS, "promote" means lifting the winning
markup/styles into Wordul's `public/` + game code as a normal dev task. The skill
stops at *publish*. Marking a design `shipped` in the manifest is a cue, not an
automation.

## Reusability

Any project adopts the ritual by adding `.claude/design-ritual.json` and providing
a `publisher` the script supports (`r2-worker` in v1). New publishers (e.g.
`r2-subdomain`, `vercel`, `netlify`) can be added to `publish.sh` later without
touching the skill or consumers.
