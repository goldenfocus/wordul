# Word-Wiki — Visuals & SEO Completion (follow-ups to the 1–6 ship)

**Date:** 2026-06-04 · **Status:** ready to execute · **Owner:** next session (context cleared)

This spec captures the **gated follow-ups** after the 2026-06-04 ship that landed items 1–6
(branch `wiki-polish`, merged to `main`). Read this top-to-bottom; it is self-contained.

---

## Current state — what is ALREADY shipped & live (do not redo)

The legendary word wiki is live: 2,315 pages at `/word/<slug>`, `/words` (A–Z), `/today`,
per-word OG cards at `/word/og/<slug>.png`, live stats, sitemap. The 2026-06-04 ship added:

- **Security (LIVE, closed):** the daily answer was publicly derivable (the answer pool `A5`
  in `src/wordsbysize.ts` is **alphabetical**, and `/words` + every word page publish that
  order, so `fnv1a(date) % 2315` → today's answer). Fixed with a server secret `DAILY_SALT`
  folded into the seed (`src/daily-core.ts` `fallbackWord`/`saltForDate`, `src/daily.ts`),
  gated behind `SALT_FROM = "2026-06-05"` so enabling it didn't rewrite past/today's
  already-played house words. **The secret is SET on the `wordle-race` worker.**
  ⚠️ **Do NOT remove the salt or the SALT_FROM cutoff — they are the anti-cheat.**
- **Brand color (code LIVE, R2 NOT):** `scripts/lib/og-card.mjs` + `public/share-card.js`
  recolored from NYT green `#6aaa64`/`#538d4e` → ultraviolet `#9d8bff` / gold `#f0c14b` /
  bg `#15101f`. The **in-app share card is live**, but the **2,315 OG cards in R2 are still
  old green** until re-generated + re-uploaded (Phase 1).
- **End-card (LIVE):** post-game card shows the word's OG image inline + inward `/word/<slug>` link.
- **ImageObject JSON-LD (template LIVE, pages NOT):** added to `scripts/lib/word-page.mjs`,
  pointing at `/word/og/<slug>.png`. **Not in the live static pages** until they're regenerated (Phase 1).
- **`llms.txt` / `llms-full.txt`:** live.
- **Image pipeline (authored, NOT run):** `scripts/gen-word-images.mjs` (dry-run-safe) +
  `docs/ART-DIRECTION.md` (locked house style).
- **Multi-length plumbing (dormant):** `--length` flag in `scripts/gen-word-intel.mjs` and
  `scripts/gen-word-pages.mjs`; `answerWordsForLength(n)` in `src/words.ts`. Default = 5, unchanged.
- **`/word/img/<key>` route:** serves hero art from the existing `OG` R2 bucket (for Phase 2).

## Key facts a fresh session needs

- **Platform:** Cloudflare Workers. **Worker name = `wordle-race`** (not "wordul").
- **Deploy:** `bash dev/ship.sh` from a worktree → CI deploys `origin/main`. NEVER `wrangler deploy` by hand.
- **Isolate first:** `bash dev/start.sh <task>` → work in `.claude/worktrees/<task>`. Root edits are hook-blocked.
- **R2 buckets:** `OG` = `wordul-og` (OG cards + future hero art), `DESIGNS` = `wordul-designs`.
- **Workers AI:** the `AI` binding exists in `wrangler.jsonc` (model `@cf/black-forest-labs/flux-1-schnell`).
- **Creds:** `~/golden-cloud/secrets/wordul-prod.env` is **SOPS/age-ENCRYPTED — never `source` it**
  (it loads `ENC[...]` ciphertext and breaks calls). Decrypt with `sops -d`. `wrangler` already has
  **ambient auth** to `wordle-race` (`wrangler secret list/put`, `deployments list` work without sourcing).
- **R2 upload creds:** `scripts/upload-og.mjs` needs `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` (S3 API) — in the encrypted vault.
- **Trap:** `@aws-sdk/client-s3` is in `package-lock.json` but **not** `package.json` deps →
  `npm i @aws-sdk/client-s3` before any R2 upload.
- **Tests:** `npm test` (vitest) · `npm run typecheck`. Scripts: `npm run wiki:pages`, `npm run wiki:og`.

---

## Goals

Finish the visual + SEO layer: real per-word imagery, on-brand link previews, complete
structured data, and (optionally) multi-length coverage — without touching the daily game or the salt.

## Out of scope

The daily game / salt / cutoff. The 12-language expansion. Auth-gated "solved words" views.

---

## Phase 1 — Recolor link previews + land JSON-LD (cheap, no AI, DO FIRST)

**Why:** makes social/link previews on-brand and gets `ImageObject` JSON-LD into live pages.
**Cost:** ~$0 (compute only). **Time:** ~30 min.

1. `npm i @aws-sdk/client-s3` (add to `package.json` deps — currently only in the lockfile).
2. `npm run wiki:pages` — regenerates `dist/og/*.png` (new brand colors) **and**
   `public/word/*.html` (now carrying the `ImageObject` JSON-LD).
   - **SAFETY:** before committing 2,315 regenerated HTML files, render ONE page and diff vs
     the committed `public/word/ocean.html` to confirm the rich content (definition/poem/etc.)
     is preserved — i.e. the intel data source is present. Only proceed if content is intact.
3. Decrypt R2 creds (`sops -d ~/golden-cloud/secrets/wordul-prod.env`), export
   `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (stream, never echo).
4. `npm run wiki:og` — re-uploads the recolored PNGs to the `wordul-og` bucket.
5. Commit regenerated `public/word/*.html` + `package.json`; `bash dev/ship.sh`.
6. Purge the `sitemap.xml` edge cache (or wait the TTL) so the `<image:image>` entries appear.

**Verify:** share `wordul.com/word/ocean` → preview is UV/gold (not green); page source has
`ImageObject` JSON-LD; `sitemap.xml` has `<image:image>` children.

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

- Confirm `<image:image>` `image:loc` is live after the sitemap cache purge.
- Tighten `public/llms.txt` to lead with the **wiki** value prop (it currently leads with the multiplayer framing).
- Once hero images exist, add `ImageObject` `license` + `acquireLicensePage` for Google's licensable-image badge.

---

## Recommended order

Phase 1 (cheap, today) → Phase 2 prototype (lock style on 40) → Phase 2 batch → Phase 3 (4-letter) → Phase 4 polish.

## Gotchas / traps (repeat offenders)

- **Never `source` the encrypted vault** — decrypt with `sops -d`. wrangler has ambient auth anyway.
- `@aws-sdk/client-s3` missing from `package.json` deps → install before R2 upload.
- Page regen MUST preserve rich content — verify a single-page render before committing 2,315 files.
- Worker = **`wordle-race`**. Don't touch the salt / `SALT_FROM` (anti-cheat).
- Brand color won't show on link previews until the OG cards are **re-uploaded** (code change alone is not enough).
- `sitemap.xml` is edge-cached.
- The image pipeline **dry-runs by default**; it only spends with `WORDUL_IMG_GEN=1`.
