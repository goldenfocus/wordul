---
name: push
description: Full GitHub + Cloudflare prod sync for wordul, then a one-line live summary. Trigger when Yan says "push", "go", "ship it", "push it to GitHub prod smoke", or otherwise authorizes a deploy. Pushes to main; CI (.github/workflows/deploy.yml) then deploys origin/main, so GitHub and prod stay in lockstep.
---

# push — sync wordul to GitHub + prod

On wordul, **CI now wires GitHub → prod**: pushing to `main` triggers `.github/workflows/deploy.yml`, which deploys `origin/main` to Cloudflare. So this skill pushes to main and lets CI deploy — **no hand-run `wrangler deploy`** (that was the stale-deploy hazard: it ships your local files and can silently revert prod). Incidents this guards: "Wordle Race live on Cloudflare with no repo" (May 31 2026) and the stale-deploy reverts logged in `.claude/COLONY.md`. **Until the `CLOUDFLARE_API_TOKEN` repo secret is set** (see `.github/workflows/README.md`), CI skips the deploy and you fall back to `npm run deploy`.

Run when Yan says **push / go / ship it / push it to GitHub prod smoke**. Tier-C frontend + worker only (no migrations, no `calculate_*`/`*_payout*`). If a change is Tier A, stop and confirm instead.

## Pipeline — run top to bottom, stop on first failure

```bash
# 1. Commit anything staged/unstaged (conventional message + Claude co-author trailer)
git add -A && git commit -F - <<'MSG'
<type(scope): summary>

<body>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
MSG

# 2. Sync with main
git fetch origin main -q && git rebase origin/main

# 3. Gauntlet — all must pass. check-graph runs FIRST: a <1s static scan that
#    fast-fails if any public/ JS import OR HTML <script>/<link> ref points at a
#    missing file — the exact class that blanked the site (share-card.js, Jun 2 2026).
npm run check-graph && npm run typecheck && npm test

# 4. GitHub
git push origin HEAD:main

# 5. Prod — CI deploys origin/main on merge. Watch the run:
gh run watch "$(gh run list --workflow=deploy.yml --branch=main --limit=1 --json databaseId --jq '.[0].databaseId')" --exit-status
# (If CLOUDFLARE_API_TOKEN isn't set yet, CI skips the deploy — fall back: npm run deploy)

# 6. Smoke
curl -s -o /dev/null -w 'home %{http_code}\n' https://wordul.com/
curl -s -o /dev/null -w 'room %{http_code}\n' https://wordul.com/@bingo/perky-ocelot
```

Both curls must be `200`. If you changed a public asset, also `curl -s https://wordul.com/<file>.js | grep -c <new-token>` to confirm the new bundle is live (not a stale cache).

## Then: the summary

End with a Post-Deploy Summary led by a **cool emoji** (rotate — 🚀 ⚡️ 🛸 🌊 🔥 ✨), naming exactly what is now live on prod and a 60-second test. Max 5 bullets, max 3 test steps. Example:

```
🚀 Live on wordul.com — <one-line>

What's live:
- <area>: <what + why>

Test (60s):
1. <action>  2. <expected>  3. <expected>
```

## Notes
- Never force-push. `main` is the only remote branch.
- If the gauntlet fails, fix or report — never `--no-verify`.
- CI deploys `origin/main`, so prod always matches main. Manual `npm run deploy` is an emergency-only fallback (it ships LOCAL files — the stale-deploy hazard).
