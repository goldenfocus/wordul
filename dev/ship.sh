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
  echo "   CI deploys on push to main — watching the run..."
  sleep 4
  run_id="$(gh run list --workflow=deploy.yml --branch=main --limit=1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  if [ -n "$run_id" ]; then
    gh run watch "$run_id" --exit-status || {
      echo "✋ CI deploy failed — inspect: gh run view $run_id --log-failed. Prod unchanged." >&2; exit 1; }
  else
    echo "   (couldn't find the CI run — check the Actions tab.)"
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
