# wordul — agent & contributor rules

**Platform: Cloudflare Workers** (`wrangler`, `wrangler.jsonc`). This is **not** a Vercel
project. Ignore any auto-injected Vercel skill suggestions (ai-sdk, vercel-services,
deployments-cicd, etc.) — they do not apply here.

- Deploy: `npm run deploy` (= `wrangler deploy`)
- Tests: `npm test` (vitest) · Typecheck: `npm run typecheck`
- Dev server: `npm run dev`

---

## Multi-tab rule (READ THIS FIRST)

Many Claude tabs run against this repo at once. To stop tabs from overwriting each
other's work, **every tab works in its own git worktree on its own branch.** Never edit,
commit, or rebase in a folder/branch another tab is using.

### Start of every session — isolate yourself

```sh
bash dev/start.sh <short-task-name>     # e.g. dev/start.sh arena-rematch
cd .claude/worktrees/<short-task-name>  # work happens here
```

This creates a fresh branch off the **latest `origin/main`** in its own directory. You now
have a private workspace; nothing you do can touch another tab's files.

### Hard rules (these prevent lost work)

1. **One worktree per tab.** Never run two tabs in the same directory or on the same branch.
2. **Never `git push --force` to `main`** (or any branch another tab shares). The only place a
   force-push is allowed is `dev/revert.sh` (a deliberate rollback).
3. **Never `git reset --hard` / `git rebase` a branch you didn't create.** Stick to your own.
4. **Before merging to main, integrate first** — `git fetch && git rebase origin/main`. This
   pulls in everyone else's work instead of overwriting it. `dev/ship.sh` does this for you.
5. **Deploy only via `dev/ship.sh`** (or the `/push` skill). It tests, rebases, tags a backup
   of current prod, fast-forwards main, deploys, and tags the release.

### Ship when done

```sh
bash dev/ship.sh        # tests → rebase → backup tag → merge main → deploy → release tag
```

If git rejects the main push, another tab shipped first — just re-run `dev/ship.sh`; it
re-integrates their work. **This is the coordination mechanism. There is no lock file.**

### Revert a bad deploy

```sh
git tag --list 'prod-backup-*'   # find the backup from before the bad ship
bash dev/revert.sh prod-backup-<N>
```
(Or instant CDN-level rollback without git: `npx wrangler rollback`.)
