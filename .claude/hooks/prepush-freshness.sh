#!/usr/bin/env bash
# PreToolUse(Bash) guard — block a push/deploy when the local branch is behind
# origin/main. Prevents the "my work got reverted" colony clobber: a stale tab
# pushing over (or lossily rebasing past) another session's already-merged work.
#
# Decision contract: print a JSON permissionDecision on stdout. "deny" blocks the
# tool call and shows the reason to Claude; silence (exit 0) lets it proceed.
# Fails OPEN — if anything is ambiguous (offline, no upstream, parse error) we
# allow, so the guard can never wedge a legitimate push.

set -euo pipefail

payload="$(cat)"

cmd="$(printf '%s' "$payload" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

# Only guard real deploys: a push to main, or a Cloudflare deploy.
if ! printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push|wrangler[[:space:]]+([a-z]+[[:space:]]+)*deploy'; then
  exit 0
fi

# Must be in a git repo with an origin.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
git remote get-url origin >/dev/null 2>&1 || exit 0

# Refresh origin/main quietly; if the fetch fails (offline), fail open.
if ! git fetch origin main --quiet 2>/dev/null; then
  exit 0
fi

behind="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"

if [ "${behind:-0}" -gt 0 ]; then
  reason="🛑 Colony guard: origin/main is ${behind} commit(s) AHEAD of your local HEAD. Pushing/deploying now risks clobbering another session's merged work (or a lossy rebase). Rebase first: git fetch origin main && git rebase origin/main — resolve any conflicts, re-run the build, then push."
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
fi

exit 0
