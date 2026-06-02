# COLONY.md — multi-agent push/deploy coordination

Two+ agents push wordul from different machines/timezones. GitHub and prod are
**separate buttons** (`git push` ≠ `wrangler deploy`) and there's **no CI**, so
the danger is twofold: a git race on `main`, and — nastier — a **stale deploy**
that ships old local code over newer prod.

## The two hazards

1. **Git race** — both push to `main` at once. Fix: always rebase, never force.
2. **Stale deploy (the silent one)** — `wrangler deploy` ships your *local* files.
   Deploying from a checkout that isn't synced to latest `origin/main` reverts
   prod to old code, even though GitHub looks fine. **Last deploy wins, blindly.**

## The protocol (every push, every agent)

```bash
# 1. ALWAYS sync before doing anything
git fetch origin main && git rebase origin/main

# 2. gauntlet
npm run typecheck && npm test

# 3. GitHub
git push origin HEAD:main          # if rejected → someone pushed; go back to step 1

# 4. Prod — ONLY from the just-rebased checkout (never a stale tree)
npm run deploy

# 5. log it here (append a line, commit, push)
```

## Rules

- **Never `git push --force` to main.** It's the only remote branch.
- **Never `wrangler deploy` from a tree that isn't freshly rebased on origin/main.**
  Sync first, every single time. A stale deploy is a prod regression with no diff.
- **Whoever pushes the integrating commit deploys it.** Don't assume the other
  agent will deploy your merge — confirm prod's Version ID matches your HEAD.
- If you might both act in the **same minute**, claim the lane below before deploying.

## Deploy lane (claim before deploying if a collision is possible)

| When (UTC) | Agent | Action | Version ID | Released? |
|------------|-------|--------|------------|-----------|
| 2026-06-01 23:03 | dad (Yan's session) | brain+body integrated → prod | 7f3c4e44 | ✅ |
| 2026-06-02 14:31 | claude (voice fix) | voice manifest neg-cache fix + module-graph guard → prod (on top of already-live fdbcc71 challenge) | 92d6a48d | ✅ |

To claim: add a row with `🔒 deploying`, push this file, deploy, then flip to ✅
with the Version ID from `wrangler deploy` output. Clear stale 🔒 rows older than ~15min.
