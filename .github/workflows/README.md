# CI — deploy on merge

`deploy.yml` runs on every push to `main`: install → `check-graph` → `typecheck`
→ `test` → `wrangler deploy` → smoke. **Prod is whatever is on `origin/main`.**

This replaces hand-run `wrangler deploy`. Why: the old model had every agent
holding the deploy button, and `wrangler deploy` ships your *local* files — so a
stale checkout could silently revert prod to old code (the #1 hazard in
`.claude/COLONY.md`). CI always deploys exactly `origin/main`, so that can't happen.

## Deploy secrets (already set — for rotation/recreation only)

The two repo secrets below are **already configured** (`CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID`, set 2026-06-05; `gh secret list` to confirm), so CI
deploys `origin/main` automatically on every push to `main`. The steps here are
only for **rotating or recreating** them.

1. **Create a scoped Cloudflare API token** — Cloudflare dashboard → My Profile →
   API Tokens → Create Token → *Edit Cloudflare Workers* template. Scope it to the
   account that owns the `wordul` Worker. Copy the token (shown once).

2. **Find the account ID** — Cloudflare dashboard → Workers & Pages → right sidebar
   *Account ID* (or `npx wrangler whoami`).

3. **Add both as GitHub Actions secrets:**
   ```sh
   gh secret set CLOUDFLARE_API_TOKEN     # paste the token when prompted
   gh secret set CLOUDFLARE_ACCOUNT_ID    # paste the account id
   ```

After rotating, the next push to `main` uses the new credentials automatically.

## Manual re-deploy / rollback

- Re-deploy current `main`: Actions tab → **deploy** → *Run workflow*.
- Emergency local deploy (e.g. CI down): `npx wrangler deploy` from a checkout
  freshly rebased on `origin/main`.
- Instant rollback: `npx wrangler rollback`.
