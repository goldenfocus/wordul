#!/usr/bin/env bash
# Deliberate rollback: force main back to a backup tag and redeploy.
# Usage: bash dev/revert.sh <backup-tag>   (e.g. prod-backup-42)
set -euo pipefail

TAG="${1:-}"
if [ -z "$TAG" ]; then
  echo "usage: bash dev/revert.sh <backup-tag>" >&2
  echo "available backups:" >&2
  git tag --list 'prod-backup-*' --sort=-creatordate | head -10 >&2
  exit 1
fi

git fetch origin --tags
if ! git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo "✋ Tag '$TAG' not found." >&2; exit 1
fi

echo "▶ Rolling main back to $TAG ($(git rev-parse --short "$TAG")) and redeploying..."
git push -f origin "$TAG:main"        # the one sanctioned force-push: a deliberate rollback
git checkout -B "revert-$TAG" "$TAG"
npm run deploy

echo
echo "✅ Prod reverted to $TAG and redeployed (you're now on branch revert-$TAG)."
