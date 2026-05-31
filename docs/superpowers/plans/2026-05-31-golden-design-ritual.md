# Golden Design Ritual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable `golden-design-ritual` skill that generates playable frontend prototypes and publishes them live to a project's site at `/designs/<slug>`, plus the one-time Wordul plumbing to serve `/designs/*` from R2.

**Architecture:** Three isolated units — (1) Wordul Worker proxy + R2 bucket serving `/designs/*`; (2) a stack-agnostic `publish.sh` that uploads HTML to R2 and maintains a JSON manifest + generated gallery; (3) the global skill `SKILL.md` that orchestrates generate→publish and owns the per-project config. After the one-time Worker deploy, every future design is a pure upload — no git push, no redeploy.

**Tech Stack:** Cloudflare Workers (TypeScript), R2 (S3-compatible, via `aws` CLI), bash, wrangler OAuth token, Claude Code skill (Markdown).

---

## File Structure

- `wordle/src/worker.ts` — add `/designs/*` → R2 proxy ahead of ASSETS fallback (MODIFY).
- `wordle/src/types.ts` — add `DESIGNS: R2Bucket` to `Env` (MODIFY).
- `wordle/wrangler.jsonc` — add `r2_buckets` binding `DESIGNS` → `wudul-designs` (MODIFY).
- `wordle/.claude/design-ritual.json` — per-project publish config (CREATE).
- `~/.claude/skills/golden-design-ritual/SKILL.md` — orchestration skill (CREATE).
- `~/.claude/skills/golden-design-ritual/publish.sh` — R2 publisher (CREATE).
- `~/.claude/skills/golden-design-ritual/test-publish.sh` — bash test for publisher (CREATE).

---

## Task 1: Create the R2 bucket

**Files:** none (infra).

- [ ] **Step 1: Create the bucket**

Run:
```bash
cd /Users/vibeyang/wordle && npx wrangler r2 bucket create wordul-designs
```
Expected: `Created bucket 'wordul-designs'` (or "already exists" — both fine).

- [ ] **Step 2: Verify it exists**

Run:
```bash
npx wrangler r2 bucket list | grep wordul-designs
```
Expected: a line containing `wordul-designs`.

---

## Task 2: Add the R2 binding to config + types

**Files:**
- Modify: `wordle/wrangler.jsonc`
- Modify: `wordle/src/types.ts`

- [ ] **Step 1: Add the binding to `wrangler.jsonc`**

Add this top-level key (sibling of `durable_objects`):
```jsonc
  "r2_buckets": [
    { "binding": "DESIGNS", "bucket_name": "wordul-designs" }
  ],
```

- [ ] **Step 2: Add `DESIGNS` to the `Env` type**

In `wordle/src/types.ts`, add to the `Env` interface:
```typescript
  DESIGNS: R2Bucket;
```

- [ ] **Step 3: Typecheck**

Run:
```bash
cd /Users/vibeyang/wordle && npm run typecheck
```
Expected: no errors (R2Bucket comes from `@cloudflare/workers-types`, already a devDep).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts wrangler.jsonc
git commit -m "feat: add DESIGNS R2 binding for design gallery"
```

---

## Task 3: Add the `/designs/*` proxy to the Worker

**Files:**
- Modify: `wordle/src/worker.ts`

- [ ] **Step 1: Insert the proxy before the ASSETS fallback**

In `src/worker.ts`, immediately before the final `return env.ASSETS.fetch(req);` line, insert:
```typescript
    // Design gallery: serve /designs/* from the DESIGNS R2 bucket (permanent,
    // upload-only — no redeploy needed to publish a new prototype).
    if (url.pathname === "/designs" || url.pathname === "/designs/") {
      const idx = await env.DESIGNS.get("designs/index.html");
      if (idx) {
        return new Response(idx.body, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("No designs yet.", { status: 404 });
    }
    if (url.pathname.startsWith("/designs/")) {
      const key = url.pathname.slice(1); // drop leading "/"
      const obj = await env.DESIGNS.get(key);
      if (obj) {
        const ct = obj.httpMetadata?.contentType ?? "text/html; charset=utf-8";
        return new Response(obj.body, { headers: { "content-type": ct } });
      }
      return new Response(
        "<!doctype html><meta charset=utf-8><title>Design not found</title>" +
          "<body style=font-family:system-ui;padding:3rem><h1>Design not found</h1>" +
          "<p><a href=/designs/>← back to the gallery</a></p>",
        { status: 404, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

```

- [ ] **Step 2: Typecheck**

Run:
```bash
cd /Users/vibeyang/wordle && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Dry-run build**

Run:
```bash
npx wrangler deploy --dry-run 2>&1 | tail -5
```
Expected: dry-run completes, lists the `DESIGNS` R2 binding, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/worker.ts
git commit -m "feat: serve /designs/* from R2 bucket"
```

---

## Task 4: Write the publisher script

**Files:**
- Create: `~/.claude/skills/golden-design-ritual/publish.sh`

- [ ] **Step 1: Write `publish.sh`**

```bash
#!/usr/bin/env bash
# Publish a single design prototype to a project's R2-backed design gallery.
#
# Usage: publish.sh <html-file> <slug> "<title>" [status] [config-path]
#   config-path defaults to ./.claude/design-ritual.json
#
# Reads {site, r2_bucket, designs_prefix} from the config. Uploads the HTML,
# upserts designs/manifest.json by slug, regenerates designs/index.html, and
# prints the live https://<site>/designs/<slug> URL.
set -euo pipefail

FILE="${1:?html file required}"
SLUG="${2:?slug required}"
TITLE="${3:?title required}"
STATUS="${4:-exploring}"
CONFIG="${5:-./.claude/design-ritual.json}"

[ -f "$FILE" ]   || { echo "✗ File not found: $FILE" >&2; exit 1; }
[ -f "$CONFIG" ] || { echo "✗ Config not found: $CONFIG (run the skill to create it)" >&2; exit 1; }

cfg() { python3 -c "import json,sys; print(json.load(open('$CONFIG'))['$1'])"; }
SITE=$(cfg site); BUCKET=$(cfg r2_bucket); PREFIX=$(cfg designs_prefix)

# R2 S3 credentials from wrangler OAuth account + golden-cloud R2 keys.
ACCT=$(npx wrangler whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1)
[ -n "$ACCT" ] || { echo "✗ Cloudflare account id not found (wrangler login?)" >&2; exit 1; }
R2_KEY="${R2_ACCESS_KEY_ID:-$(sops -d ~/golden-cloud/secrets/p69-prod.env 2>/dev/null | sed -n 's/^R2_ACCESS_KEY_ID=//p' | tr -d '\"')}"
R2_SECRET="${R2_SECRET_ACCESS_KEY:-$(sops -d ~/golden-cloud/secrets/p69-prod.env 2>/dev/null | sed -n 's/^R2_SECRET_ACCESS_KEY=//p' | tr -d '\"')}"
[ -n "$R2_KEY" ] && [ -n "$R2_SECRET" ] || { echo "✗ R2 credentials unavailable (golden-cloud enrollment?)" >&2; exit 1; }

ENDPOINT="https://${ACCT}.r2.cloudflarestorage.com"
s3() { AWS_ACCESS_KEY_ID="$R2_KEY" AWS_SECRET_ACCESS_KEY="$R2_SECRET" \
       aws s3 "$@" --endpoint-url "$ENDPOINT" --region auto; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "→ Uploading $FILE → r2://$BUCKET/${PREFIX}${SLUG}.html"
s3 cp "$FILE" "s3://${BUCKET}/${PREFIX}${SLUG}.html" --content-type "text/html" >/dev/null

# Upsert manifest.json by slug (download if present, merge, re-upload).
s3 cp "s3://${BUCKET}/${PREFIX}manifest.json" "$TMP/manifest.json" >/dev/null 2>&1 || echo "[]" > "$TMP/manifest.json"
DATE=$(date +%Y-%m-%d)
python3 - "$TMP/manifest.json" "$SLUG" "$TITLE" "$STATUS" "$DATE" <<'PY'
import json,sys
path,slug,title,status,date = sys.argv[1:6]
items=json.load(open(path))
items=[x for x in items if x.get("slug")!=slug]
items.append({"slug":slug,"title":title,"status":status,"date":date})
items.sort(key=lambda x:(x["date"],x["slug"]),reverse=True)
json.dump(items,open(path,"w"),indent=2)
PY
s3 cp "$TMP/manifest.json" "s3://${BUCKET}/${PREFIX}manifest.json" --content-type "application/json" >/dev/null

# Regenerate index.html from the manifest.
python3 - "$TMP/manifest.json" "$TMP/index.html" "$SITE" <<'PY'
import json,sys,html
manifest,out,site = sys.argv[1:4]
items=json.load(open(manifest))
cards="".join(
 f'<a class=card href="/designs/{html.escape(i["slug"])}">'
 f'<span class=badge data-s="{html.escape(i["status"])}">{html.escape(i["status"])}</span>'
 f'<h2>{html.escape(i["title"])}</h2><time>{html.escape(i["date"])}</time></a>'
 for i in items) or "<p>No designs yet.</p>"
open(out,"w").write(f"""<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Designs · {html.escape(site)}</title>
<style>body{{font-family:system-ui;margin:0;padding:3rem 1.5rem;background:#0f1115;color:#e7e9ee}}
h1{{font-size:1.4rem;margin:0 0 1.5rem}}.grid{{display:grid;gap:1rem;max-width:780px;margin:0 auto;
grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}}.card{{display:block;padding:1.25rem;border-radius:14px;
background:#1a1d25;color:inherit;text-decoration:none;border:1px solid #262a35;transition:.15s}}
.card:hover{{border-color:#3a86ff;transform:translateY(-2px)}}.card h2{{font-size:1rem;margin:.4rem 0 .2rem}}
time{{font-size:.8rem;color:#8b92a5}}.badge{{font-size:.65rem;text-transform:uppercase;letter-spacing:.05em;
padding:.15rem .5rem;border-radius:999px;background:#262a35;color:#8b92a5}}
.badge[data-s=shipped]{{background:#0f3d2e;color:#4ade80}}</style>
<h1>Designs · {html.escape(site)}</h1><div class=grid>{cards}</div>""")
PY
s3 cp "$TMP/index.html" "s3://${BUCKET}/${PREFIX}index.html" --content-type "text/html" >/dev/null

echo "✓ Shipped: https://${SITE}/designs/${SLUG}"
echo "  Gallery: https://${SITE}/designs/"
```

- [ ] **Step 2: Make it executable**

Run:
```bash
chmod +x ~/.claude/skills/golden-design-ritual/publish.sh
```
Expected: no output.

---

## Task 5: Test the publisher's manifest logic (offline)

**Files:**
- Create: `~/.claude/skills/golden-design-ritual/test-publish.sh`

This isolates and tests the pure logic (manifest upsert + index generation) without R2, by running the embedded Python the same way `publish.sh` does.

- [ ] **Step 1: Write the test**

```bash
#!/usr/bin/env bash
# Tests the manifest upsert idempotency + index generation used by publish.sh.
set -euo pipefail
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
M="$TMP/manifest.json"; echo "[]" > "$M"

upsert() { python3 - "$M" "$1" "$2" "$3" "$4" <<'PY'
import json,sys
path,slug,title,status,date=sys.argv[1:6]
items=json.load(open(path)); items=[x for x in items if x.get("slug")!=slug]
items.append({"slug":slug,"title":title,"status":status,"date":date})
items.sort(key=lambda x:(x["date"],x["slug"]),reverse=True)
json.dump(items,open(path,"w"),indent=2)
PY
}

upsert board-neon "Neon Board" exploring 2026-05-31
upsert board-neon "Neon Board v2" shipped 2026-05-31   # same slug → must replace, not dupe
upsert board-soft "Soft Board" exploring 2026-05-30

COUNT=$(python3 -c "import json;print(len(json.load(open('$M'))))")
[ "$COUNT" = "2" ] || { echo "FAIL: expected 2 entries, got $COUNT" >&2; exit 1; }
TITLE=$(python3 -c "import json;print([x for x in json.load(open('$M')) if x['slug']=='board-neon'][0]['title'])")
[ "$TITLE" = "Neon Board v2" ] || { echo "FAIL: slug not upserted, title=$TITLE" >&2; exit 1; }
FIRST=$(python3 -c "import json;print(json.load(open('$M'))[0]['slug'])")
[ "$FIRST" = "board-neon" ] || { echo "FAIL: sort wrong, first=$FIRST" >&2; exit 1; }
echo "PASS: upsert idempotent (2 entries), slug replaced, sort by date desc"
```

- [ ] **Step 2: Run the test, expect FAIL first (sanity)**

Temporarily change the assertion `[ "$COUNT" = "2" ]` to `= "3"`, run:
```bash
chmod +x ~/.claude/skills/golden-design-ritual/test-publish.sh
~/.claude/skills/golden-design-ritual/test-publish.sh
```
Expected: `FAIL: expected 3 entries, got 2`. Then revert `3` back to `2`.

- [ ] **Step 3: Run the test, expect PASS**

Run:
```bash
~/.claude/skills/golden-design-ritual/test-publish.sh
```
Expected: `PASS: upsert idempotent (2 entries), slug replaced, sort by date desc`.

---

## Task 6: Write the Wordul per-project config

**Files:**
- Create: `wordle/.claude/design-ritual.json`

- [ ] **Step 1: Write the config**

```json
{
  "site": "wordul.com",
  "publisher": "r2-worker",
  "r2_bucket": "wordul-designs",
  "designs_prefix": "designs/"
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/vibeyang/wordle
git add .claude/design-ritual.json
git commit -m "chore: design-ritual config for wordul"
```

---

## Task 7: Write the skill

**Files:**
- Create: `~/.claude/skills/golden-design-ritual/SKILL.md`

- [ ] **Step 1: Write `SKILL.md`**

```markdown
---
name: golden-design-ritual
description: Use when the user wants to explore, prototype, or redesign a UI/UX surface and see it live — generates 2-4 distinct, PLAYABLE frontend prototypes and publishes them to the project's own site at /designs/<slug> for instant shareable preview. Triggers: "design ritual", "spin up designs", "prototype the X screen", "redesign the X", "show me design options live".
---

# Golden Design Ritual

Turn a "redesign X" request into several playable, production-grade prototypes
published LIVE to the project's site at `/designs/<slug>`. Previews are instantly
shareable, permanent, and real code — the winner can be promoted into the app fast.

## Config

Read `./.claude/design-ritual.json` from the repo root. Required keys:
`site`, `publisher`, `r2_bucket`, `designs_prefix`. If the file is MISSING, ask the
user for the values once, write the file, then continue. Never guess the bucket/site.

Only `publisher: "r2-worker"` is supported in v1 (upload to R2, served by the
project's Worker at `/designs/*`).

## Ritual

1. **Frame** — ask, tightly: which surface? vibe / references? must-keeps?
   how many directions (default 3)? One short volley, not an interrogation.
2. **Generate** — invoke the `frontend-design` skill to produce N DISTINCT
   directions. Each prototype MUST be a single self-contained `.html` file with
   inline CSS/JS and REAL interactions (e.g. a Wordle board you can type into).
   Write them to `/tmp/<slug>.html`. Choose short kebab-case slugs.
3. **Publish** — for each prototype, run:
   `~/.claude/skills/golden-design-ritual/publish.sh /tmp/<slug>.html <slug> "<Title>" exploring`
   Run from the repo root so it finds `.claude/design-ritual.json`.
4. **Report** — give the user the live `https://<site>/designs/<slug>` links and
   the gallery link `https://<site>/designs/`. If any slug failed to publish, say
   which — never imply a partial gallery is complete.

## Promotion

When the user picks a winner, lifting its HTML/CSS/JS into the live app is a normal
dev task (not automated here). Optionally re-publish that slug with status `shipped`
to badge it in the gallery.

## Notes

- Prototypes never go to git — they live in R2 forever. Only the config file is
  committed.
- Credentials come from wrangler OAuth + golden-cloud R2 keys; never prompt the
  user to paste secrets.
```

- [ ] **Step 2: Verify the skill is discoverable**

Run:
```bash
ls ~/.claude/skills/golden-design-ritual/
```
Expected: `SKILL.md  publish.sh  test-publish.sh`.

---

## Task 8: One-time deploy + end-to-end verification

**Files:** none (deploy + smoke).

> **COORDINATION (Sacred):** The live `wordle-race` Worker is also being changed by another agent (in worktree `.claude/worktrees/username-identity`). Before deploying, check `.claude/COLONY.md` and the other agent's state. Either (a) let their merge-to-main carry this proxy change out in their deploy, or (b) deploy now and have them rebase. Do NOT double-deploy blindly. Confirm with Yan before this deploy if the other agent's work is mid-flight.

- [ ] **Step 1: Deploy the Worker (coordinated)**

Run:
```bash
cd /Users/vibeyang/wordle && npx wrangler deploy 2>&1 | tail -8
```
Expected: deploy succeeds, output lists the `DESIGNS` R2 binding and the `wordle-race` script.

- [ ] **Step 2: Publish a smoke-test prototype**

```bash
printf '<!doctype html><meta charset=utf-8><title>Hello Wordul</title><h1 style="font-family:system-ui">It works.</h1>' > /tmp/smoke-test.html
~/.claude/skills/golden-design-ritual/publish.sh /tmp/smoke-test.html smoke-test "Smoke Test" exploring
```
Expected: `✓ Shipped: https://wordul.com/designs/smoke-test`.

- [ ] **Step 3: Verify the live URLs**

```bash
echo "design:"; curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://wordul.com/designs/smoke-test
echo "gallery:"; curl -s -o /dev/null -w "%{http_code}\n" https://wordul.com/designs/
echo "404:"; curl -s -o /dev/null -w "%{http_code}\n" https://wordul.com/designs/does-not-exist
echo "game still works:"; curl -s -o /dev/null -w "%{http_code}\n" https://wordul.com/
```
Expected: design `200 text/html`, gallery `200`, 404 path `404`, game root `200`.

- [ ] **Step 4: Clean up the smoke test (optional)**

```bash
ACCT=$(npx wrangler whoami | grep -oE '[0-9a-f]{32}' | head -1)
# Remove the smoke object; re-run publish on a real design to regenerate the gallery.
npx wrangler r2 object delete wordul-designs/designs/smoke-test.html
```
Expected: object deleted. (Manifest/index will refresh on the next real publish.)

---

## Self-Review Notes

- **Spec coverage:** skill (Task 7) ✓, publisher + manifest + gallery (Tasks 4–5) ✓, R2 bucket (Task 1) ✓, Worker proxy + binding (Tasks 2–3) ✓, config contract (Tasks 6–7) ✓, error handling (404 page in Task 3, abort-loud + missing-config + creds in Task 4) ✓, testing (Task 5 bash test + Task 8 curl) ✓, promotion-manual (Task 7) ✓, reusability via config (Tasks 6–7) ✓.
- **Naming consistency:** binding `DESIGNS`, bucket `wordul-designs`, prefix `designs/`, config keys `site/publisher/r2_bucket/designs_prefix` — consistent across Tasks 2, 4, 6, 7.
- **Coordination risk** with the other agent's Worker work is called out as a Sacred checkpoint in Task 8.
