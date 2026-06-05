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

# 5. Prod — CI deploys origin/main on merge. Watch the run FOR THE COMMIT JUST PUSHED.
#    NEVER `--branch=main --limit=1`: it can match a previous, already-completed run, and
#    `gh run watch` on a finished run returns "already completed with success" instantly —
#    a false green that hides a still-in-flight (or failed) deploy. Filter by --commit + poll.
SHA="$(git rev-parse HEAD)"; RUN=""
for _ in $(seq 1 30); do RUN="$(gh run list --workflow=deploy.yml --commit="$SHA" --limit=1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)"; [ -n "$RUN" ] && break; sleep 2; done
gh run watch "$RUN" --exit-status
# (If CLOUDFLARE_API_TOKEN isn't set yet, CI skips the deploy — fall back: npm run deploy)

# 6. Smoke
curl -s -o /dev/null -w 'home %{http_code}\n' https://wordul.com/
curl -s -o /dev/null -w 'room %{http_code}\n' https://wordul.com/@bingo/perky-ocelot

# 7. Cleanup — prod is live, so this worktree + branch are spent. Auto-remove ONLY a clean
#    worktree under .claude/worktrees (never the root, never one with unsaved work). A dirty
#    tree is left in place with a manual hint, so nothing unsaved is ever lost. Run this
#    LAST — only after the smoke curls are 200.
WT="$(git rev-parse --show-toplevel)"; BR="$(git branch --show-current)"
case "$WT" in
  */.claude/worktrees/*)
    cd "${WT%/.claude/worktrees/*}"   # step out to the root checkout BEFORE removing
    if git worktree remove "$WT" 2>/dev/null; then
      git branch -D "$BR" 2>/dev/null || true
      echo "🧹 removed shipped worktree + branch '$BR'"
    else
      echo "⚠️  '$WT' has unsaved work — left in place. Remove when ready:"
      echo "    git worktree remove --force '$WT' && git branch -D '$BR'"
    fi ;;
  *) echo "(not a .claude/worktrees worktree — skipping cleanup)" ;;
esac
```

Both curls must be `200` (run cleanup only after they pass). If you changed a public asset, also `curl -s https://wordul.com/<file>.js | grep -c <new-token>` to confirm the new bundle is live (not a stale cache).

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
- **Cleanup (step 7) only runs after a confirmed prod ship** (smoke 200s). It removes the spent worktree + branch so the `git worktree list` doesn't accrue dead entries. It refuses on any uncommitted/untracked work — so if you have a plan doc or notes you want kept, commit them before pushing (or they'll block cleanup and you'll see the manual hint).
