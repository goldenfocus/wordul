#!/usr/bin/env bash
# Isolate this tab: create a private worktree + branch off the latest origin/main.
# Usage: bash dev/start.sh <short-task-name>
set -euo pipefail

NAME="${1:-}"
if [ -z "$NAME" ]; then
  echo "usage: bash dev/start.sh <short-task-name>   (e.g. arena-rematch)" >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
WT="$ROOT/.claude/worktrees/$NAME"   # .claude/worktrees is already gitignored

echo "▶ Fetching latest origin/main..."
git fetch origin --prune

if [ -e "$WT" ]; then
  echo "✅ Worktree already exists: $WT"
elif git show-ref --verify --quiet "refs/heads/$NAME"; then
  echo "▶ Branch '$NAME' exists — checking it out in a worktree..."
  git worktree add "$WT" "$NAME"
else
  echo "▶ Creating branch '$NAME' off origin/main in a new worktree..."
  git worktree add "$WT" -b "$NAME" origin/main
fi

# Speed: share the main checkout's node_modules instead of reinstalling.
if [ ! -e "$WT/node_modules" ] && [ -d "$ROOT/node_modules" ]; then
  ln -s "$ROOT/node_modules" "$WT/node_modules"
  echo "▶ Linked node_modules (no reinstall needed)."
fi

echo
echo "✅ Isolated workspace ready."
echo "   branch:  $NAME  (based on latest origin/main)"
echo "   cd $WT"
echo "   ...do your work, commit on '$NAME', then: bash dev/ship.sh"
