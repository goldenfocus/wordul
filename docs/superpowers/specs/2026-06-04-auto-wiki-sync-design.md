# Auto Wiki Sync — Design Spec

**Date:** 2026-06-04
**Status:** Approved (brainstorm) → ready for implementation plan
**Author:** brainstormed with Zang
**Depends on:** the legendary-English wiki (Phase 1) being live — i.e. `data/word-intel-rich.js`
populated, `public/word/*.html` generated, pages deployed.

## Summary

Make the word wiki **self-healing**: every word the game can use always has a verified wiki
page, with no manual run. The wiki becomes a **pure function of the word set** — an idempotent
`wiki:sync` primitive generates+verifies+renders only the *missing* words, and a daily scheduled
routine keeps coverage complete as the word set changes. Nothing unverified ever reaches a page,
so "auto" means **scheduled/queued generation**, never synchronous-at-reveal.

## The key realization

After the Phase-1 run, **every possible game word is already covered.** The only words the game
can set as an answer are drawn from the fixed pools (`room.ts:375` → `pool.answers[random]`), and
the 5-letter answer pool (all 2,315) is exactly what Phase 1 generates. There is therefore **no
per-game runtime generation needed**. The job of this feature is to *keep* coverage complete when:

1. the answer pool **grows** (a word is added to `src/wordsbysize.ts`), and
2. (future) a human-overwrite feature ever sets a word **outside** a covered pool.

The two triggers Zang named map cleanly:
- **Word-of-the-day (auto):** `wordOfTheDay(date)` is deterministic and always a pool word → already covered.
- **Human overwrite:** a pool word → already covered; a genuinely off-pool word → handled later (see *Future / Approach B*).

## Scope

### In scope (v1)
- `coverage.mjs` — pure: `targetWords()` + `missingWords(corpus, target)`.
- `scripts/wiki-sync.mjs` — deterministic orchestrator with `--check` and `--build` modes.
- `package.json` → `wiki:sync` script.
- A **daily scheduled routine** (via `/schedule`) that runs check → verified-generation (for any
  missing) → build → commit → deploy through the gauntlet.
- A lightweight `/push` pre-deploy hook: always regenerate pages from the current corpus, and
  **warn** (never block) if any target word lacks intel.

### Out of scope (fast-follow)
- **Approach B** — runtime lazy thin-page for genuinely off-pool words (only worth building once a
  human-overwrite-to-arbitrary-word feature exists).
- Covering non-5-letter pools (lengths 4, 6–12). The wiki is 5-letter-only today; extending
  `targetWords()` to other pools is a later opt-in, not v1.
- Pruning pages for words removed from the pool (we keep them as stable permalinks/SEO).

## Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Wiki coverage is a **pure function of the word set**; `wiki:sync` is idempotent (full coverage → zero LLM calls, no diff). | One primitive, trivially correct, safe to run anywhere/anytime. |
| D2 | "Covered" = the word is a key in the committed **`data/word-intel-rich.js`** (the durable rich corpus). The `.intel-staging/` dir is build scratch, not the source of truth. | The committed corpus is the single durable record; render is derived from it. |
| D3 | Generation of missing intel uses the **same adversarial Opus generate→verify pipeline** as Phase 1 (the Workflow agent-team), invoked by the routine — *not* a lower-quality single-call path. | Legendary parity + the no-fabrication gate apply to auto-generated words exactly as to the batch. Missing counts are tiny (0–handful), so cost is negligible. |
| D4 | `wiki-sync.mjs` itself is **node-only + deterministic** (`--check` lists missing; `--build` merges staging → renders pages/OG → uploads). The *LLM generation* lives in the routine (a Claude Code scheduled agent that can launch the Workflow). | Keeps the node script pure/testable; the "brain" (LLM + orchestration) is the routine, where it belongs. |
| D5 | The routine **deploys only through the gauntlet** (qa-gatekeeper → Vercel/CF preview → preview-verifier → post-deploy-verifier). Wiki content is **Tier C** (auto-merge after gauntlet). | Unattended deploys are safe only behind the kill-switch; wiki copy touches no money path. |
| D6 | `/push` runs `wiki:pages` (cheap, deterministic) + `wiki:sync --check` and **warns** on gaps; it never blocks the deploy on LLM work. | Keeps human-driven deploys fast + non-interactive; heavy gen is the routine's job. |

## Architecture

```
                target word set (answerWords − exclusions)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                     ▼
   wiki:sync --check                       committed corpus
   missing = target − keys(rich)           data/word-intel-rich.js
            │                                     │
   (routine) missing > 0 ?                        │
            │ yes                                 │
            ▼                                     │
   Workflow: generate→verify (D3)  ─────► .intel-staging/en/<slug>.verified.json
            │                                     │
            ▼                                     ▼
   wiki:sync --build:  merge staging → rich + slim data → wiki:pages → wiki:og upload
            │
            ▼
   commit + deploy through the gauntlet (D5)
```

### Components

**1. `scripts/lib/coverage.mjs` (new, pure)**
- `targetWords()` → the words that *should* have a page: `answerWords()` minus `exclusions()`
  (reuse the existing build-side `scripts/lib/words.mjs`). Extensible later to other pools.
- `missingWords(corpusKeys, target)` → `target` words not present in `corpusKeys`. Pure set diff.

**2. `scripts/wiki-sync.mjs` (new orchestrator, node-only)**
- `--check` → prints `missing` (and counts) as JSON. Reads `targetWords()` + the keys of
  `data/word-intel-rich.js`. No LLM, no writes. Exit non-zero iff missing > 0 (so `/push` + CI can branch on it).
- `--build` → merge any `.intel-staging/en/*.verified.json` into `data/word-intel-rich.js`
  (rich) + `public/data/word-intel.js` (slim game file), then `npm run wiki:pages`, then
  (if R2 creds present) `npm run wiki:og`. Idempotent; safe to re-run.
- Reuses the existing merge/render logic from the Phase-1 pipeline (factor the merge into a shared
  helper so the workflow's merge agent and `wiki-sync --build` share one implementation).

**3. `package.json`**
- `"wiki:sync": "node scripts/wiki-sync.mjs"`.

**4. The daily routine (via `/schedule`)**
A Claude Code scheduled remote agent, ~daily. Task:
> Run `wiki:sync --check` in `/Users/theoutsider/wordul-wiki`. If it reports missing words,
> launch the verified generate→verify Workflow for exactly those words, then `wiki:sync --build`,
> commit, and deploy through the gauntlet. If nothing is missing, exit (no-op).

After Phase 1 it is a near-no-op safety net that quietly fills any word added to the pool.

**5. `/push` hook**
Add to the deploy flow: `npm run wiki:pages` (regenerate HTML from the current corpus so committed
pages never drift) and `wiki:sync --check` — print a warning listing any target words without intel.
Never blocks.

## Data flow

1. Word set changes (pool grows, or a future off-pool override) → some target word lacks a rich entry.
2. `wiki:sync --check` surfaces it (routine on a schedule, or `/push` as a warning).
3. Routine runs the verified Workflow over the missing words → `.verified.json` stamps.
4. `wiki:sync --build` merges → renders pages + OG → uploads.
5. Routine commits + deploys through the gauntlet.

## Edge cases

- **Excluded word:** not in `targetWords()` → never generated, no page — consistent with `isWordPage`.
- **Word removed from the pool:** its page is kept (stable permalink/SEO); it simply stops being a
  target. No auto-delete (D-scope).
- **Generation fails for a missing word:** it stays missing; the next routine run retries; logged.
  Render still succeeds for everything covered (build never blocks on a gap).
- **Rich entry exists but page not rendered:** `--build` always re-renders *all* pages from the
  corpus → self-heals on the next sync.
- **R2 creds absent:** `--build` skips OG upload with a notice; pages still ship (OG `og:image`
  404s gracefully, as today).
- **Concurrent routine + human `/push`:** both are idempotent and gauntlet-gated; last-writer pages
  are identical given the same corpus.

## Testing

- **Pure units (vitest):** `targetWords()` (excludes exclusions), `missingWords()` (covered excluded,
  new detected, empty when corpus ⊇ target).
- **Idempotency:** `wiki:sync --build` twice on a complete corpus → no diff, no LLM calls.
- **`--check` contract:** empty missing + exit 0 when corpus complete; lists + exit ≠ 0 when a word
  is removed from the corpus.

## Build sequence (phasing for the plan)

1. **Coverage core** — `coverage.mjs` (pure) + tests.
2. **Sync engine** — factor the Phase-1 merge into a shared helper; `wiki-sync.mjs` `--check`/`--build`;
   `wiki:sync` script; idempotency test.
3. **`/push` hook** — pages regen + `--check` warning.
4. **Daily routine** — author + register the `/schedule` routine; document its prompt in
   `docs/routines/`.

## Risks / notes

- **Unattended deploy** — mitigated by D5 (gauntlet) + Tier-C classification (no money path).
- **Generation cost** — bounded by `missing` count (≈0 in steady state); D3's quality bar is the same
  verified pipeline, so no trust regression.
- **Engine drift** — the workflow merge and `wiki-sync --build` must share ONE merge implementation
  (D4) or the slim/rich files could diverge; the plan factors it into a single helper.

## Future / Approach B (out of scope)

If a feature ever lets a human set a genuinely **off-pool** word, add a worker path: on a
`/word/<slug>` miss for a valid word, serve a *thin* immediate page (dictionary def + mechanical FAQ
+ live stats) and enqueue the async verified generation that upgrades it. Deferred until that feature
exists — until then, every settable word is a pool word and is already covered.
