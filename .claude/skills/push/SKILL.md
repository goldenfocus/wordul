---
name: push
description: Full GitHub + Cloudflare prod sync for wordul, then a one-line live summary. Trigger when Yan says "push", "go", "ship it", "push it to GitHub prod smoke", or otherwise authorizes a deploy. Keeps GitHub and prod in lockstep (they are decoupled — no CI auto-deploy).
---

# push — sync wordul to GitHub + prod

On wordul, **GitHub and prod are two separate buttons** (`git push` updates GitHub, `wrangler deploy` updates Cloudflare prod) and there is **no `.github/workflows` CI** wiring them together. This skill always does BOTH so they never drift. Incident this guards: "Wordle Race live on Cloudflare with no repo" (May 31 2026).

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

# 5. Prod
npm run deploy

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
- `npm run deploy` ships from LOCAL files, so always push to GitHub in the same run.
