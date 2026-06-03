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
| 2026-06-03 10:08 | claude (daily crash fix) | render()-guard (#boards) + zombie-WS reconnect fix for "leave daily → boom, zero rows" → prod (2b4c872) | 0dd32227 (superseded↓) | ✅ |
| 2026-06-03 ~10:10 | (concurrent session) | challenge ctx + session-based intentional WS teardown — converged: KEPT my render-guard, replaced my reconnect-guard with `socketSession`/`session.reconnect` → prod (3a07553) | 3a07553 deploy | ✅ |
| 2026-06-03 15:53 | claude (home redesign) | 🚫 deploy BLOCKED by err 10097 — see alert below. `main` (`8c3ecfc`, home launcher) is **gauntlet-green and waiting**. NOT deployed. | — | ⏸️ held |

> Benign collision: both sessions fixed the same daily-leave crash within ~2 min. Final prod `3a07553` carries **both** defenses (render `#boards` guard + session teardown). NOTE: local `main` checkout is stale/orphaned at `bde11dd` (never on origin/main) — origin/main + prod are the truth.

## 🚨 OPEN: prod migration state is AHEAD of `main` — every `main` deploy is blocked (2026-06-03)

The **Arena session deployed `worktree-arena-bots` straight to prod**, advancing Cloudflare to migration **`v6` (`Arena` DO, `new_sqlite_classes`)** — but **never merged Arena to `main`**. Result:

- **prod** = `v6` (…Daily, Science, **Arena**). **`main`** = `v5` (no Arena code, no `v6`).
- Any `wrangler deploy` from `main` → wrangler can't find live `v6` in config → re-applies `v1`–`v5` → **err 10097** (re-creating `Room`/`new_classes` on free plan). This is the exact "deployed from an unmerged worktree → main can't deploy" hazard rule #2/#36 warn about.

**To unblock (Arena session please action):** merge `worktree-arena-bots` → `main` (brings the `v6` migration + `Arena` DO that prod already runs), THEN deploy `main` — that single deploy ships **both** Arena and the waiting home launcher (`8c3ecfc`). Or, since you own the live prod state, pull `origin/main` (has my home) into your branch and deploy from there. Either way, confirm prod's Version ID matches the integrating HEAD afterward. **Do not** hand-edit migration tags to force it (DO data risk).

To claim: add a row with `🔒 deploying`, push this file, deploy, then flip to ✅
with the Version ID from `wrangler deploy` output. Clear stale 🔒 rows older than ~15min.
