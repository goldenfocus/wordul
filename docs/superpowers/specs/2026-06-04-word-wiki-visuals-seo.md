# Word-Wiki — Visuals & SEO Completion (follow-ups to the 1–6 ship)

**Date:** 2026-06-04 · **Status:** ✅ Phase 1 SHIPPED (`prod-443`, 2026-06-04) · Phase 2+ ready · **Owner:** next session

This spec captures the **gated follow-ups** after the 2026-06-04 ship that landed items 1–6
(branch `wiki-polish`, merged to `main`). Read this top-to-bottom; it is self-contained.

> **Phase 1 is DONE (2026-06-04, `prod-443`).** All 2,315 OG cards recolored to the
> ultraviolet/gold brand and re-uploaded to `wordul-og`; richer `ImageObject` JSON-LD landed
> on every `/word/<slug>` page. Verified live. **Start at Phase 2.** See the corrected facts
> below (several Phase-1-era notes were stale — fixed inline).

---

## Current state — what is ALREADY shipped & live (do not redo)

The legendary word wiki is live: 2,315 pages at `/word/<slug>`, `/words` (A–Z), `/today`,
per-word OG cards at `/word/og/<slug>.png`, live stats, sitemap. The 2026-06-04 ship added:

- **Security (LIVE, closed):** the daily answer was publicly derivable (the answer pool `A5`
  in `src/wordsbysize.ts` is **alphabetical**, and `/words` + every word page publish that
  order, so `fnv1a(date) % 2315` → today's answer). Fixed with a server secret `DAILY_SALT`
  folded into the seed (`src/daily-core.ts` `fallbackWord`/`saltForDate`, `src/daily.ts`),
  gated behind `SALT_FROM = "2026-06-05"` so enabling it didn't rewrite past/today's
  already-played house words. **The `DAILY_SALT` secret is SET on the `wordul` worker**
  (re-set fresh on 2026-06-05 after the `wordle-race`→`wordul` rename, which created a
  brand-new worker with no secrets — worker secrets are NOT carried by `wrangler deploy`).
  ⚠️ **Do NOT remove the salt or the SALT_FROM cutoff — they are the anti-cheat.**
- **Brand color (LIVE everywhere ✅):** `scripts/lib/og-card.mjs` + `public/share-card.js`
  recolored from NYT green `#6aaa64`/`#538d4e` → ultraviolet `#9d8bff` / gold `#f0c14b` /
  bg `#15101f`. **Phase 1 re-generated + re-uploaded all 2,315 OG cards to `wordul-og`** —
  link previews are now on-brand. (OG responses are NOT Cloudflare-edge-cached — `cf-cache=none` —
  so an R2 overwrite flips the live card instantly; no cache purge needed.)
- **End-card (LIVE):** post-game card shows the word's OG image inline + inward `/word/<slug>` link.
- **ImageObject JSON-LD (LIVE on all pages ✅):** `scripts/lib/word-page.mjs` now emits a proper
  top-level `ImageObject` (`@id "#og"`: `contentUrl`, `caption`, 1200×630) that `DefinedTerm`
  and `WebPage` reference by `@id`. **Phase 1 regenerated all 2,315 pages with it** — verified live.
- **`llms.txt` / `llms-full.txt`:** live.
- **Image pipeline (authored, NOT run):** `scripts/gen-word-images.mjs` (dry-run-safe) +
  `docs/ART-DIRECTION.md` (locked house style).
- **Multi-length plumbing (dormant):** `--length` flag in `scripts/gen-word-intel.mjs` and
  `scripts/gen-word-pages.mjs`; `answerWordsForLength(n)` in `src/words.ts`. Default = 5, unchanged.
- **`/word/img/<key>` route:** serves hero art from the existing `OG` R2 bucket (for Phase 2).

## Key facts a fresh session needs

- **Platform:** Cloudflare Workers. **Worker name = `wordul`** (renamed from the legacy `wordle-race` on 2026-06-05).
- **Deploy:** `bash dev/ship.sh` from a worktree → CI deploys `origin/main`. NEVER `wrangler deploy` by hand.
- **Isolate first:** `bash dev/start.sh <task>` → work in `.claude/worktrees/<task>`. Root edits are hook-blocked.
- **R2 buckets:** `OG` = `wordul-og` (OG cards + future hero art), `DESIGNS` = `wordul-designs`.
- **Workers AI:** the `AI` binding exists in `wrangler.jsonc` (model `@cf/black-forest-labs/flux-1-schnell`).
- **Creds:** `~/golden-cloud/secrets/wordul-prod.env` is **SOPS/age-ENCRYPTED — never `source` it**
  (it loads `ENC[...]` ciphertext and breaks calls). Decrypt with `sops -d`. `wrangler` already has
  **ambient auth** to `wordul` (`wrangler secret list/put`, `deployments list` work without sourcing).
- **R2 uploads — use wrangler, NOT the S3 script (corrected):** the vault only holds
  `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` — it does **NOT** contain the
  `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` S3 keys that `scripts/upload-og.mjs`
  expects, so that script can't run as-is. Phase 1 uploaded via **`wrangler r2 object put
  wordul-og/<slug>.png --file=dist/og/<slug>.png --content-type=image/png --remote`** (ambient
  auth; the `--remote` flag is REQUIRED or it writes to a local sim). Key = bare `<slug>.png`
  (worker route `env.OG.get(key)`). Parallelize ~8-way; one transient failure is normal, retry it.
  The CF API token also lacks **cache-purge** permission (purge returns `code 10000`) — fine,
  since OG isn't edge-cached anyway.
- **`@aws-sdk/client-s3` is now a declared devDependency** (no longer just in the lockfile). But
  the shared `node_modules` (symlinked from the root checkout by `dev/start.sh`) may not have it
  materialized — run `npm install` once in the worktree if `@resvg/resvg-js` / `@aws-sdk` are
  missing (this replaces the symlink with a real, self-contained `node_modules`).
- **Tests:** `npm test` (vitest) · `npm run typecheck`. Scripts: `npm run wiki:pages`, `npm run wiki:og`.

---

## Goals

Finish the visual + SEO layer: real per-word imagery, on-brand link previews, complete
structured data, and (optionally) multi-length coverage — without touching the daily game or the salt.

## Out of scope

The daily game / salt / cutoff. The 12-language expansion. Auth-gated "solved words" views.

---

## Phase 1 — Recolor link previews + land JSON-LD ✅ DONE (`prod-443`, 2026-06-04)

**Why:** made social/link previews on-brand and got the richer `ImageObject` JSON-LD into live
pages. **What actually happened** (the spec below was partly stale — corrected):

1. `@aws-sdk` was already a declared dep; only needed `npm install` to materialize the shared
   `node_modules` (it also pulls `@resvg/resvg-js`, required by `wiki:pages`).
2. `npm run wiki:pages` regenerated `dist/og/*.png` (new colors) + `public/word/*.html`.
   - **Content-preservation gate PASSED:** every page changed exactly one line (the `ld+json`
     `<script>`); 0 non-JSON-LD changes; all 2,315 JSON-LD blocks parsed and resolved `#og`.
     (`data/word-intel-rich.js` is the intel source — present, 2,315 entries.)
3. JSON-LD + sitemap `<image:image>` were ALREADY live before Phase 1 — the only real gap was
   the green OG cards in R2. (The committed pages carried an *older* inline-stub JSON-LD; the
   regen upgraded them to the linked `#og` `ImageObject`.)
4. Uploaded all 2,315 recolored PNGs via **`wrangler r2 object put ... --remote`** (the vault has
   no R2 S3 keys — see corrected facts above). 8-way parallel, 1 transient retry, 0 failures.
5. Committed the regenerated `public/word/*.html` (`package.json` unchanged); `bash dev/ship.sh`.
6. No `sitemap.xml` purge needed (`<image:image>` already live; OG route isn't edge-cached).

**Verified live:** `wordul.com/word/ocean` OG card is UV/gold; page JSON-LD has the top-level
`ImageObject "#og"` (contentUrl + 1200×630) with `DefinedTerm`/`WebPage` linked to it; sitemap
has 2,315 `<image:image>` children.

---

## Phase 2 — Real per-word AI images (the payoff — "actually see BINGO")

**Why:** every page gets real illustrations; the hero doubles as the OG card. Biggest Google
Images / GEO unlock. **Cost:** ~$50–150 one-time. **Time:** a weekend incl. QA.
**Pre-reqs:** `WORDUL_IMG_GEN=1` (the script dry-runs without it), CF token (ambient wrangler),
R2 creds. Style contract lives in `docs/ART-DIRECTION.md`.

1. **Lock the style on a sample.** `node scripts/gen-word-images.mjs --limit 40` (dry-run first
   to read prompts), then with `WORDUL_IMG_GEN=1` on ~40 words. QA vs `ART-DIRECTION.md`;
   iterate the `STYLE_SUFFIX` until 40 images read as one cohesive brand. (~$2.)
2. **Batch all 2,315.** `WORDUL_IMG_GEN=1 node scripts/gen-word-images.mjs` (resumable,
   skip-existing). 3 slots/word (`hero/`, `mnemonic/`, `etymology/` → `wordul-og`). ~6,900 images.
   flux-1-schnell for bulk; gpt-image-1 (~$0.04) fallback for weak gens.
3. **QA pass.** Flag the bottom ~10%: homographs (CRANE bird vs machine → use the verified
   primary `def`), abstract words, sensitive words (deny-list → poster-only). Re-roll.
4. **Wire it in.** Hero image becomes: the on-page hero (`word-page.mjs`), the OG card (replace
   the templated `og-card` with the composited hero → collapses two image systems into one),
   the `ImageObject` `contentUrl`, and the `<image:image>` loc. Regenerate pages + sitemap; ship.

The `/word/img/<key>` route already serves these from `wordul-og`.

---

## Phase 3 — Multi-length expansion (optional; biggest SEO surface)

**Why:** 4-letter (~4,360), 6 (~15k), 7 (~20k)… today the wiki is 5-letter only by design.
Plumbing exists (`--length`, `answerWordsForLength`). Needs a **content-generation run** per
length (an Opus-team workflow like the original 2,315). **Priority: 4-letter → 6 → 7 → lazy 8–12.**

Per length N:
1. Generate intel via the Opus-team workflow over `answerWordsForLength(N)` (5-letter was ~$15–30; scales with count).
2. `node scripts/gen-word-pages.mjs --length N` → pages.
3. Additively wire length N into `ANSWER_WORDS`/`isWordPage`/sitemap (currently 5-only) — non-daily, so the salt doesn't apply.
4. **Cross-link length variants** (BING ↔ BINGO ↔ BINGED) in the related-word graph — the moat.

Don't pre-generate 8–12 (tens of thousands, obscure) — generate lazily on first request, cache in R2.

---

## Phase 4 — SEO finishers

- `<image:image>` `image:loc` is already live in the sitemap (confirmed Phase 1) — no purge needed.
- Tighten `public/llms.txt` to lead with the **wiki** value prop (it currently leads with the multiplayer framing).
- Once hero images exist, add `ImageObject` `license` + `acquireLicensePage` for Google's licensable-image badge.

---

## Recommended order

~~Phase 1~~ ✅ done → **Phase 2 prototype (lock style on 40)** → Phase 2 batch → Phase 3 (4-letter) → Phase 4 polish.

## Gotchas / traps (repeat offenders)

- **Never `source` the encrypted vault** — decrypt with `sops -d`. wrangler has ambient auth anyway.
- **R2 uploads go through `wrangler r2 object put --remote`, NOT `upload-og.mjs`** — the vault has
  no R2 S3 keys (only `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`). The `--remote` flag is
  mandatory; without it wrangler writes to a local sim. The CF token can't purge cache (`code 10000`).
- `@aws-sdk` is now a declared devDep; if the shared symlinked `node_modules` lacks it (or
  `@resvg/resvg-js`), run `npm install` once in the worktree.
- Page regen MUST preserve rich content — verify a single-page render before committing 2,315 files.
  (Quick gate: `git diff --numstat public/word/` should be `1 1` per file = only the `ld+json` line.)
- Worker = **`wordul`**. Don't touch the salt / `SALT_FROM` (anti-cheat).
- **OG card route is NOT edge-cached** (`cf-cache=none`) — overwriting the R2 object flips the live
  card instantly. The `cache-control: max-age=86400` only affects individual browsers + social-side
  caches (which self-heal as platforms re-scrape). No CF purge required.
- The image pipeline **dry-runs by default**; it only spends with `WORDUL_IMG_GEN=1`.
