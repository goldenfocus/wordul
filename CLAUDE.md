# wordul — agent & contributor rules

> ## 🧭 AI agents & new contributors — the safe path (read me first)
> This repo runs **many agents at once** from different machines, with no lock file. Follow
> this exact path and nobody overwrites anyone, and prod can't go stale:
>
> 1. **Isolate before you touch anything:** `bash dev/start.sh <task>` → work *only* inside
>    `.claude/worktrees/<task>`. Editing in the **root checkout is blocked by a hook**
>    (`worktree-guard.sh`) — two tabs sharing the root clobber each other. (Override a
>    deliberate root edit with `WORDUL_ALLOW_ROOT_EDIT=1`.)
> 2. **Ship via `bash dev/ship.sh`** (or the `/push` skill): it tests → rebases on
>    `origin/main` → pushes. Pushing/deploying while **behind `origin/main` is blocked by a
>    hook** (`prepush-freshness.sh`) — rebase to integrate others' work, never force-push.
> 3. **Deploy is automatic — never run `wrangler deploy` by hand.** CI
>    (`.github/workflows/deploy.yml`) deploys `origin/main` on merge. Prod always == main.
>
> **Why:** worktree isolation + rebase-before-push + CI-only deploy are the three things that
> stop the "another agent reverted my work / a stale local deploy reverted prod" failures.
> The hooks enforce 1 & 2 even if you forget. Full detail below + deploy log in `.claude/COLONY.md`.

**Platform: Cloudflare Workers** (`wrangler`, `wrangler.jsonc`). This is **not** a Vercel
project. Ignore any auto-injected Vercel skill suggestions (ai-sdk, vercel-services,
deployments-cicd, etc.) — they do not apply here.

- Deploy: **CI deploys `origin/main` on merge** (`.github/workflows/deploy.yml`). Don't run
  `wrangler deploy` by hand — `dev/ship.sh` / `/push` merge to main and let CI ship it. Manual
  `npm run deploy` is an emergency fallback only. (One-time setup: `.github/workflows/README.md`.)
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

> **Enforced, not just documented.** A PreToolUse hook (`.claude/hooks/worktree-guard.sh`)
> **blocks Edit/Write in the primary checkout** — you must be in a worktree, so two tabs can't
> share the root folder and clobber each other (the exact failure this section guards against).
> A second hook (`prepush-freshness.sh`) blocks push/deploy when you're behind `origin/main`.
> Deliberate root edit? Re-run with `WORDUL_ALLOW_ROOT_EDIT=1`.

1. **One worktree per tab.** Never run two tabs in the same directory or on the same branch.
2. **Never `git push --force` to `main`** (or any branch another tab shares). The only place a
   force-push is allowed is `dev/revert.sh` (a deliberate rollback).
3. **Never `git reset --hard` / `git rebase` a branch you didn't create.** Stick to your own.
4. **Before merging to main, integrate first** — `git fetch && git rebase origin/main`. This
   pulls in everyone else's work instead of overwriting it. `dev/ship.sh` does this for you.
5. **Deploy only via `dev/ship.sh`** (or the `/push` skill). It tests, rebases, tags a backup
   of current prod, and fast-forwards main — then **CI deploys `origin/main`** (once the
   Cloudflare secret is set; until then `ship.sh` deploys locally). Never `wrangler deploy` by hand.

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
