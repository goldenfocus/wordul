#!/usr/bin/env bash
# PreToolUse(Edit|Write) guard — block edits made in the PRIMARY checkout, forcing
# every tab into its own git worktree (the multi-tab rule in CLAUDE.md). This is the
# enforcement the colony was missing: the freshness hook only guards push/deploy, so
# nothing stopped two tabs from sharing the root checkout and switching branches /
# clobbering each other's files mid-task. This closes that hole at edit time.
#
# Decision contract: print a JSON permissionDecision on stdout. "deny" blocks the
# tool call and shows the reason to Claude; silence (exit 0) lets it proceed.
# Fails OPEN — any ambiguity (not a repo, parse error, file outside repo) allows,
# so the guard can never wedge legitimate work.
#
# Escape hatch: set WORDUL_ALLOW_ROOT_EDIT=1 to permit a deliberate root edit.

set -euo pipefail

[ "${WORDUL_ALLOW_ROOT_EDIT:-}" = "1" ] && exit 0

payload="$(cat)"

path="$(printf '%s' "$payload" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"
[ -z "$path" ] && exit 0

# Resolve the directory the edit targets (works for not-yet-created files too).
dir="$(dirname "$path")"
while [ ! -d "$dir" ] && [ "$dir" != "/" ] && [ "$dir" != "." ]; do dir="$(dirname "$dir")"; done
[ -d "$dir" ] || exit 0

# Must be inside a git repo with a worktree.
git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# In a LINKED worktree, --git-dir (…/.git/worktrees/<name>) differs from
# --git-common-dir (…/.git). In the PRIMARY checkout they resolve to the same path.
gitdir="$(cd "$dir" && git rev-parse --absolute-git-dir 2>/dev/null || true)"
commondir="$(cd "$dir" && git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
[ -z "$gitdir" ] && exit 0
[ -z "$commondir" ] && exit 0

# Different → it's a worktree → allow.
[ "$gitdir" != "$commondir" ] && exit 0

# Same → primary checkout → deny and point at the convention.
reason="🛑 Worktree guard: you're editing in the PRIMARY checkout ($dir). Multiple tabs share this folder and switch branches in it, which clobbers each other's work. Isolate first: bash dev/start.sh <task-name> && cd .claude/worktrees/<task-name>, then edit there. (Deliberate root edit? Re-run with WORDUL_ALLOW_ROOT_EDIT=1.)"
python3 -c '
import json,sys
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": sys.argv[1]
  }
}))' "$reason"
exit 0
