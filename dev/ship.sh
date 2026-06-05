#!/usr/bin/env bash
# Safe ship: tests -> integrate latest main -> backup prod -> fast-forward main -> deploy -> tag.
# Run from inside your feature-branch worktree. Usage: bash dev/ship.sh
set -euo pipefail

BRANCH="$(git branch --show-current)"
case "$BRANCH" in
  main|"") echo "✋ Run dev/ship.sh from a feature-branch worktree, not '$BRANCH'." >&2; exit 1 ;;
esac

echo "▶ [1/6] Tests + typecheck (must pass to ship)..."
npm test
npm run typecheck

echo "▶ [2/6] Integrating latest origin/main (rebase)..."
git fetch origin
if ! git rebase origin/main; then
  echo "✋ Rebase hit conflicts. Resolve them, run 'git rebase --continue', then re-run dev/ship.sh." >&2
  exit 1
fi

echo "▶ [3/6] Backing up current prod tip before changing it..."
BK="prod-backup-$(git rev-list --count origin/main)"
git tag -f "$BK" origin/main
git push -f origin "refs/tags/$BK"
echo "   backup tag: $BK -> $(git rev-parse --short origin/main)"

echo "▶ [4/6] Fast-forwarding main on origin..."
if ! git push origin "HEAD:main"; then
  echo "✋ Another tab shipped first. Re-run dev/ship.sh — it will re-integrate their work." >&2
  exit 1
fi

echo "▶ [5/6] Deploying..."
# Self-adjusting: once CI (.github/workflows/deploy.yml + the CLOUDFLARE_API_TOKEN
# secret) is set up, prod is deployed by CI on push to main — so we just watch it,
# never run wrangler locally (that was the stale-deploy hazard). Until the secret
# exists, fall back to the old local deploy so there's never a "nobody can deploy" gap.
ci_deploys=false
if [ -f .github/workflows/deploy.yml ] && command -v gh >/dev/null 2>&1 \
   && gh secret list 2>/dev/null | grep -q '^CLOUDFLARE_API_TOKEN'; then
  ci_deploys=true
fi
if [ "$ci_deploys" = true ]; then
  # Watch the run for THE COMMIT WE JUST PUSHED — never `--branch=main --limit=1`,
  # which matches whatever run is newest and can grab a PREVIOUS, already-completed
  # run. `gh run watch` on a finished run returns "already completed with success"
  # instantly — a false green that hides a still-in-flight (or failed) deploy.
  # Filter by --commit <HEAD sha> and poll until the push registers its run.
  head_sha="$(git rev-parse HEAD)"; head_short="$(git rev-parse --short HEAD)"
  echo "   CI deploys on push to main — locating the run for $head_short..."
  run_id=""
  for _ in $(seq 1 30); do   # poll up to ~60s for the push to register a run
    run_id="$(gh run list --workflow=deploy.yml --commit="$head_sha" --limit=1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
    [ -n "$run_id" ] && break
    sleep 2
  done
  if [ -n "$run_id" ]; then
    echo "   watching run $run_id..."
    gh run watch "$run_id" --exit-status || {
      echo "✋ CI deploy failed — inspect: gh run view $run_id --log-failed. Prod unchanged." >&2; exit 1; }
  else
    echo "   (couldn't find a CI run for $head_short after 60s — check the Actions tab.)"
  fi
else
  echo "   (CI not configured yet — deploying locally. Add the CLOUDFLARE_API_TOKEN secret"
  echo "    per .github/workflows/README.md to switch to CI deploys.)"
  npm run deploy
fi

echo "▶ [6/6] Tagging release..."
REL="prod-$(git rev-list --count HEAD)"
git tag -f "$REL"
git push -f origin "refs/tags/$REL"

echo
echo "✅ Shipped '$BRANCH' -> main -> prod."
echo "   release tag: $REL"
echo "   revert with: bash dev/revert.sh $BK   (or: npx wrangler rollback)"

echo "▶ Cleanup: this worktree + branch are shipped & spent — removing them..."
# Only auto-remove a CLEAN worktree under .claude/worktrees (never the root, never one
# with unsaved work). A dirty tree is left in place with a manual hint, so nothing
# unsaved is ever lost. Runs last — main is already updated + deployed by here.
WT="$(git rev-parse --show-toplevel)"
case "$WT" in
  */.claude/worktrees/*)
    cd "${WT%/.claude/worktrees/*}"   # step out to the root checkout BEFORE removing
    if git worktree remove "$WT" 2>/dev/null; then
      git branch -D "$BRANCH" 2>/dev/null || true
      echo "   🧹 removed shipped worktree + branch '$BRANCH'."
    else
      echo "   ⚠️  '$WT' has unsaved work — left in place. Remove when ready:"
      echo "       git worktree remove --force '$WT' && git branch -D '$BRANCH'"
    fi ;;
  *) echo "   (not a .claude/worktrees worktree — skipping cleanup.)" ;;
esac
