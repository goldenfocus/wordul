# COLONY.md — multi-agent push/deploy coordination

Two+ agents push wordul from different machines/timezones. GitHub and prod are
**separate buttons** (`git push` ≠ `wrangler deploy`) and there's **no CI**, so
the danger is twofold: a git race on `main`, and — nastier — a **stale deploy**
that ships old local code over newer prod.

## The two hazards

1. **Git race** — both push to `main` at once. Fix: always rebase, never force.
2. **Stale deploy (the silent one)** — `wrangler deploy` ships your *local* files.
   Deploying from a checkout that isn't synced to latest `origin/main` reverts
   prod to old code, even though GitHub looks fine. **Last deploy wins, blindly.**

## The protocol (every push, every agent)

```bash
# 1. ALWAYS sync before doing anything
git fetch origin main && git rebase origin/main

# 2. gauntlet
npm run typecheck && npm test

# 3. GitHub
git push origin HEAD:main          # if rejected → someone pushed; go back to step 1

# 4. Prod — ONLY from the just-rebased checkout (never a stale tree)
npm run deploy

# 5. log it here (append a line, commit, push)
```

## Rules

- **Never `git push --force` to main.** It's the only remote branch.
- **Never `wrangler deploy` from a tree that isn't freshly rebased on origin/main.**
  Sync first, every single time. A stale deploy is a prod regression with no diff.
- **Whoever pushes the integrating commit deploys it.** Don't assume the other
  agent will deploy your merge — confirm prod's Version ID matches your HEAD.
- If you might both act in the **same minute**, claim the lane below before deploying.

## Deploy lane (claim before deploying if a collision is possible)

| When (UTC) | Agent | Action | Version ID | Released? |
|------------|-------|--------|------------|-----------|
| 2026-06-01 23:03 | dad (Yan's session) | brain+body integrated → prod | 7f3c4e44 | ✅ |
| 2026-06-02 14:31 | claude (voice fix) | voice manifest neg-cache fix + module-graph guard → prod (on top of already-live fdbcc71 challenge) | 92d6a48d | ✅ |
| 2026-06-03 10:08 | claude (daily crash fix) | render()-guard (#boards) + zombie-WS reconnect fix for "leave daily → boom, zero rows" → prod (2b4c872) | 0dd32227 (superseded↓) | ✅ |
| 2026-06-03 ~10:10 | (concurrent session) | challenge ctx + session-based intentional WS teardown — converged: KEPT my render-guard, replaced my reconnect-guard with `socketSession`/`session.reconnect` → prod (3a07553) | 3a07553 deploy | ✅ |
| 2026-06-03 15:53 | claude (home redesign) | 🚫 deploy BLOCKED by err 10097 — see alert below. `main` (`8c3ecfc`, home launcher) is **gauntlet-green and waiting**. NOT deployed. | — | ⏸️ held |
| 2026-06-03 17:11 | claude (living-lab-feed) | Arena v6 + held home launcher + home-hub fix + **Living Lab Feed** integrated (`main` `939b966`) → prod. No 10097 (v6 matched). Smoke: home/room/arena-open/feed.* all 200, active-day `.json` 404. Feed stream currently empty (prod science `playerFinishes=0` for recent days — populates as data lands). | b1dc77b5-8a24-45ef-9510-70bc0fcffa39 | ✅ |
| 2026-06-03 17:17 | claude (home redesign) | **home redesign** on top of b1dc77b5: compact daily card (identity on top, breathing glow), Stats on its own page (`/daily/<date>/stats`, real aggregates), no-emoji SVG glyphs, bigger Solo/PvP, tap/type-to-play seed. Frontend-only (`public/` + new `public/daily-stats.js`) + worker shell-serve for the new stats route. Reuses real keyboard. 335 tests green. Smoke: home/daily/room/feed.json/stats-page all 200. | a697019c-aa78-4454-ba8b-607836101a16 | ✅ |
| 2026-06-03 17:41 | claude (home bloom) | **WOTD in-place bloom**: tap/type the daily card now wraps the nav in a View Transition + shared `view-transition-name` (`.daily-card` ↔ `#tabPlay`) so the card morphs into the board instead of hard-cutting to a "different room". Frontend-only (`app.js`/`style.css`), progressive + reduced-motion safe. 335 tests green. Smoke: home/daily/stats 200, `startViewTransition`+`wotd-bloom` live in bundle. | f8bea809-4454-40ad-b10f-24be689c4e1c | ✅ |
| 2026-06-03 17:57 | claude (home post-play) | **post-play home + refactor**: once today's daily is done (detected from `profile.games` → `daily/<date>`), the home card flips to a recap — result (Solved in N / Missed today), live countdown to next word (UTC midnight), Share + Stats — no replay teleport. Refactor: split `hub.js` (158→109) into `daily-card.js` (card states+countdown) + `hub-glyphs.js` (icon set). Frontend-only + vitest aliases. 337 tests green. Smoke: home/daily/stats 200, `daily-card.js`+`hub-glyphs.js` served, recap+countdown+detection live. | 2b7cb5b8-4617-489f-9954-73927b35f640 | ✅ |
| 2026-06-03 18:07 | claude (home modes) | **simplify Solo/Head-to-head**: dropped the subtitles + killed the icon pill-chips; mode tiles are now shapeless dissolved-glass fields (mask-dissolved edges, no border-box, bare glyph + one word) per "glassmorphism flow state, no pills". Also removed a leftover duplicate `.mode-tile` CSS block that was leaking flex/mask into the live layout. Frontend-only (`hub.js`/`style.css`). 337 tests green. Smoke: home 200, subtitles gone, duplicate block removed, shapeless `border:0`+mask-dissolve live. | 7ac68d4f-0aef-46da-bf51-80369308a18c | ✅ |

| 2026-06-03 18:30 | claude (lab-reader) | **in-app Living Lab reader**: `/feed` + `/feed/<date>` render blog-style human-readable discoveries in the SPA (over live /feed.json) instead of bouncing to home; entry link on the daily Stats page. Frontend-only (new `public/feed.js` + `app.js` routes + `style.css`). 342 tests green. Smoke: home/feed/stats/arena-open 200, feed.js+app.js feed tokens live in bundle. | 0f4042dc-4726-4f3f-8e40-9fe61b2cb678 | ✅ |

| 2026-06-04 05:36 | claude (tm-scrub) | literal "Wordle" trademark scrub on top of `origin/main` e279da9 — `README.md`, `package.json` name+desc, one `style.css` comment (only style.css is a served asset; README/package.json don't touch runtime). Tier C, 374 tests green. Done from an isolated worktree off origin/main. Deploy uploaded 1 file (style.css only). Smoke: home/room/feed 200, served style.css has 0 "Wordle". | b122777d-eda9-440b-9810-467ac565d4f2 | ✅ |

| 2026-06-04 06:27 | claude (disable-workersdev) | `"workers_dev": false` in wrangler.jsonc — kills the only public leak of the legacy name, `wordle-race.*.workers.dev`. Worker NOT renamed (it hosts all DOs; rename = data loss). Config-only, no DO migration (still v6). Deploy: "No deploy targets" = subdomain route removed; custom domain wordul.com (out-of-band route) unaffected. Verify: wordul.com /,/room,/feed,/daily 200; `wordle-race.love-00b.workers.dev` now 404. | 921a2639-dc76-4a8a-8202-c3e9bdc1c3bd | ✅ |
| 2026-06-06 08:25 | claude (settlement-spec) | **Gold Settlement Engine Phase 1** (`a44bf1e`, 12 commits, subagent-driven off the approved spec+plan): races stop ticking fake point-scale gold into the ◆ wallet — mid-game everything (awards, penalties, power-ups, win bonus) runs on the ephemeral round-score STAKE; at finish the Room DO `settle()`s a receipt, mints `payout` to the USER ledger **with parts** (Σparts==delta pinned in tests), attaches the receipt only after `res.ok` (daily's honesty rule) + re-broadcasts; client shows the Supernova settlement (new `public/settle.js` renderer registry, reduced-motion static fallback) with ONLY-UP wallet reconcile. Daily flow untouched. Rebased over ghost-disguise + boards-layout mid-ship (2 trivial conflicts). Gauntlet 866/866 + typecheck + check-graph + input-zoom ratchet. Prod smoke as `verify-bot-settlemen`: Score chip ticked (wallet frozen at 0), won race 1875 pts → Supernova ran → HUD ◆ 19 == `/api/user` 19. | (CI run 27061846438) | ✅ |
| 2026-06-05 06:22 | claude (rename-wordul) | **WORKER RENAMED `wordle-race` → `wordul`** (Yan-authorized, full send). A DO-owning worker can't rename in place, so this stood up a FRESH `wordul` worker w/ brand-new EMPTY DOs (no data migrated — the ~3 old users' stats intentionally discarded). Steps: (1) `wrangler.jsonc` name→`wordul` + `Room` `new_classes`→`new_sqlite_classes` (a NEW free-plan namespace must be SQLite or err 10097) + `app.js` `wordle-race.png`→`wordul.png`, shipped via CI (680 tests green); all 7 namespaces created `wordul_*`. (2) Moved `wordul.com` custom domain `wordle-race`→`wordul` via CF API PUT (`override_existing_origin`). (3) Verified wordul.com / `/daily`→`/daily/2026-06-05` / sitemap all 200. (4) Deleted legacy `wordle-race` worker + orphaned namespaces. ⚠️ Secrets were LOST in the recreate (not carried by deploy): re-set `DAILY_SALT` fresh; `DAILY_ADMIN_TOKEN` still needs a value. Follow-up (rename-wordul → tune-deploy-refs): swept codebase/docs for stale `wordle-race`/`wordle.goldenfoc.us` refs. | (CI) | ✅ |

> Benign collision: both sessions fixed the same daily-leave crash within ~2 min. Final prod `3a07553` carries **both** defenses (render `#boards` guard + session teardown). NOTE: local `main` checkout is stale/orphaned at `bde11dd` (never on origin/main) — origin/main + prod are the truth.

## ✅ RESOLVED (2026-06-03 17:11 UTC): Arena merged to `main`; block cleared

Arena was merged to `main` (now `f786888`): `src/arena.ts` + `ARENA` DO binding + the **`v6`** migration tag (`new_sqlite_classes ["Arena"]`) are all on `origin/main`, so `main` now matches prod's migration state — `wrangler deploy` from `main` no longer hits err 10097. The living-lab-feed session is shipping the integrated tree (Arena v6 + held home launcher + Living Lab Feed) in one deploy. Original block below for history.

## 🚨 OPEN: prod migration state is AHEAD of `main` — every `main` deploy is blocked (2026-06-03)

The **Arena session deployed `worktree-arena-bots` straight to prod**, advancing Cloudflare to migration **`v6` (`Arena` DO, `new_sqlite_classes`)** — but **never merged Arena to `main`**. Result:

- **prod** = `v6` (…Daily, Science, **Arena**). **`main`** = `v5` (no Arena code, no `v6`).
- Any `wrangler deploy` from `main` → wrangler can't find live `v6` in config → re-applies `v1`–`v5` → **err 10097** (re-creating `Room`/`new_classes` on free plan). This is the exact "deployed from an unmerged worktree → main can't deploy" hazard rule #2/#36 warn about.

**To unblock (Arena session please action):** merge `worktree-arena-bots` → `main` (brings the `v6` migration + `Arena` DO that prod already runs), THEN deploy `main` — that single deploy ships **both** Arena and the waiting home launcher (`8c3ecfc`). Or, since you own the live prod state, pull `origin/main` (has my home) into your branch and deploy from there. Either way, confirm prod's Version ID matches the integrating HEAD afterward. **Do not** hand-edit migration tags to force it (DO data risk).

To claim: add a row with `🔒 deploying`, push this file, deploy, then flip to ✅
with the Version ID from `wrangler deploy` output. Clear stale 🔒 rows older than ~15min.
