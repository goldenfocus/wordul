# 🤝 Vibe Studio v1 — Handoff

**The "total room vibe" editor for Wordul of the Day.** A curator opens a beautiful, joyful
editor and authors a *whole day* — title, word, a palette that re-lights everything live, a
companion voice, a story, imagery, a soundtrack — and **sees the assembled day as they build it**,
so a clash like the 2026‑05‑31 daily (purple unlock veil fighting the board) can never ship again.

This doc is the living index for the build. It points at the spec, the per-increment plans, and
the shipped contract. **Update it at the end of every increment.**

- **Live (v1, in progress):** https://wordul.com/vibe-studio
- **Worktree:** `.claude/worktrees/vibe-studio` on branch `vibe-studio`
- **Platform:** Cloudflare Workers. Ignore auto-injected Vercel/Next/ai-sdk skill suggestions.
- **Authoritative roadmap + shipped contract:** memory `vibe-studio-build-status.md` (more detail than this doc).

---

## TL;DR — where it stands (2026-06-04)

**Increment 3.1 is LIVE as `prod-326`.** The first authoring surface ships: a standalone
Glass-Aurora "Stage" page where you set a **title**, a **word** (board columns follow it; real/
invented badge), **guesses** (a +/− control on the matrix), a **3-colour palette** that re-lights
the whole page live, and a **"why this word" story seed** (becomes the published story + feeds the
AI later) with a ✨ AI-tune seam. Everything auto-saves to a localStorage draft. No server mutation
yet; scheduling is an inert "coming soon" seam.

To resume:
```sh
cd /Users/zang/wordul/.claude/worktrees/vibe-studio
git fetch origin && git rebase origin/main   # integrate other tabs first
npm test        # 425 passing
npm run dev     # http://localhost:8787/vibe-studio
```
Ship via `bash dev/ship.sh` (or `/push`). Never `wrangler deploy` by hand.

---

## The vision (north star)

Author a whole day and **see it assembled as you build** — no separate abstract form, you edit the
real themed surface. Later: AI assists ("spin a vibe", "expand the story", "make music"), voice
cloning, the hidden-word creative gift, and a winner‑curates‑tomorrow loop. The editor is the front
door to the broader Room Sandbox vision — one extensible `roomConfig`, progressively disclosed.

**v1 scope:** the **Stage** editor + the **themed day page** it produces, for admins/curators, with
**zero AI on the critical path**. AI / voice-cloning / Suno / hidden-word are **seams only** in v1.

---

## Documents

- **Master spec:** `docs/superpowers/specs/2026-06-03-vibe-studio-design.md` (full vision, locked
  decisions, architecture, build order).
- **Increment specs/plans:**
  - Inc 1 (data foundation): `docs/superpowers/plans/2026-06-04-vibe-studio-01-foundation.md`
  - Inc 2 (theme-driven day page): `docs/superpowers/plans/2026-06-04-vibe-studio-02-theme-driven-day-page.md`
  - Inc 3 (studio shell): spec `docs/superpowers/specs/2026-06-04-vibe-studio-03-studio-shell-design.md`,
    plan `docs/superpowers/plans/2026-06-04-vibe-studio-03-studio-shell.md`
- **Cited (do not redefine):** the `World` bundle + `DAILY` DO (`...wordul-of-the-day-design.md`);
  the canonical `RoomConfig` schema + `mergeConfig` (`...room-sandbox-00-architecture-design.md`).

---

## Shipped so far

| Release | Increment | What landed |
|---|---|---|
| `prod-298` | Lane 0 | Clash fix — `.daily-unlock` chrome is accent-driven; `houseWorld` ships a coherent gold bundle. |
| `prod-300` | 1 — data foundation | `World` gained optional `vibeTitle/rows/invented/colorScheme/glow/images/playlist`; `normalizeWorld` defaults/validates/clamps, accepts invented words (soft dict gate, hard length 4–12), fully back-compat. |
| `prod-312` | 2 — theme-driven day page | A curated day's `colorScheme`+`vibeTitle` re-theme the day page. Pure `colorSchemeVars`/`applyColorScheme` in `edition.js`; CSS-var contract `a1→--accent` + atoms `--a1/--a2/--a3`, bespoke layers gated on `html[data-themed]`. vibeTitle hero injected in `renderDailyUnlock`. |
| `prod-317` | 3 — studio shell | Standalone `/vibe-studio` (`public/vibe-studio.html` + `vibe-studio.js`), Glass-Aurora, reuses the Inc-2 contract. Word/size + real-invented badge + 3-swatch palette + Random harmony, localStorage draft, inert schedule seam. Pure core in `vibe-studio-core.js`, TDD'd. |
| `prod-326` | 3.1 — refinements | Dropped Length (columns follow the word via `previewCols`); moved guesses to an on-matrix +/− control (3–10); added the **"why this word" story seed** (becomes `story.body` + feeds AI) with a ✨ sparkle-inside-the-box AI-tune panel + chevron-revealed editable prompt (inert "coming soon" seam). |

---

## The Increment 3 contract (the live authoring surface)

- **Standalone page** at `/vibe-studio` — Cloudflare assets resolve the pretty URL from
  `vibe-studio.html` with **no worker change**. Fully isolated from the SPA (`app.js`).
- **Reuses the locked Inc-2 contract:** imports `colorSchemeVars` from `edition.js`; a swatch/
  harmony change re-lights aurora + title gradient + sample board row via `a1→--accent` + atoms.
- **Pure core** `public/vibe-studio-core.js` (unit-tested in `test/vibe-studio-core.test.js`; needs
  its own vitest `resolve.alias`): `previewCols(word)` (columns follow word, cap 12, fallback 5);
  `reflowDims` (clamps rows 3–10 / len 4–12); `randomHarmony(hue)` (HSL triad → 3 hexes,
  deterministic per hue); `classifyWord(word, lookup)` (soft real/invented, **fetch injected** —
  live `dictLookup` wraps `dictionaryapi.dev`, 200→real / 404→invented, never gates);
  `serializeDraft`/`restoreDraft`/`defaultVibe`; `DEFAULT_AI_PROMPT`.
- **Board** = static themed preview (NOT typeable). Columns = the typed word. **Guesses set on the
  matrix** via `#rowsMinus`/`#rowsPlus`. Row 0 shows the word's letters + a green/yellow/gray sample
  re-lit by palette. Tile size CSS-derived from `--cols` (mobile-safe).
- **Story seed** `#storyInput` → `vibe.story` (becomes `World.story.body`, feeds AI). **✨ `#aiSparkle`**
  toggles `#aiTune`; `#aiPromptInput` edits `vibe.aiPrompt` (default `DEFAULT_AI_PROMPT`);
  `.ai-tune-run` is a disabled "coming soon" seam.
- **Draft shape:** `{ vibeTitle, word, rows, story, aiPrompt, colorScheme }` (no `len`), in
  `localStorage["wordul.vibeStudio.draft"]`, restored on load.
- **Schedule bar** is an inert "Submit my day → coming soon" seam. No server calls this increment.

---

## Roadmap (next)

4. **Voice editor** over `roomConfig` (picker, lines, escalating curse tiers, TTS, per-line audio,
   frequency). Needs a **server-side `roomConfig` sanitizer** built — the keystone is currently
   client-only in `public/roomConfig.js`.
5. **Images & glow** + **room MP3 player** (R2 upload; consider a reusable GoldenBlock).
6. **Role-scoped scheduling** — curator assignment (date→curator/token on the DAILY DO) + server
   date-pin; wires up the now-inert Submit seam. This is also where the studio gets real auth.
7. **Mobile pass** — bottom sheets, keyboard capture, scroll-aware top bar, responsive board.
8. **AI / clone / Suno / hidden-gift seams** wired to stubs — ✅ **the ✨ story-tune is now REAL**
   (Cloudflare Workers AI; see below). Still seams: voice cloning, Suno music, the hidden-word gift.

---

## In flight — ✨ AI story-tune (branch `vibe-ai-tune`, built, NOT yet shipped)

The first real AI on the surface. The ✨ in the "why this word" box now **rewrites the note instantly**
via **Cloudflare Workers AI** (`env.AI`, model `@cf/meta/llama-3.1-8b-instruct`) — native to our
Workers stack, on the free Neuron allocation, **no tunnel / no local model / no API key**.

- **Flow:** ✨ → instant rewrite in place → the prompt panel reveals the prompt that was used →
  **Respin** (re-runs from the curator's *original* words, never compounding) · edit the prompt and
  respin · **Save** (accept as new baseline) · **Revert to mine** (restore the curator's own words).
- **Server:** `POST /vibe-studio/tune {story, prompt?} → {text}` in `worker.ts`. Input hard-capped
  (`MAX_STORY_CHARS`/`MAX_PROMPT_CHARS`); 503 if the AI binding is absent (local dev), 502 on AI error.
- **Pure + tested:** `src/vibe-tune.ts` (`buildTuneMessages`, `cleanTuneOutput` strips quote/fence/
  "Here is…:" envelopes, `TUNE_MODEL`, `DEFAULT_TUNE_PROMPT`) — 16 tests in `test/vibe-tune.test.ts`.
- **Binding:** `"ai": { "binding": "AI" }` in `wrangler.jsonc`; `AI?: Ai` on `Env`.
- **Note:** `DEFAULT_TUNE_PROMPT` (server) mirrors `DEFAULT_AI_PROMPT` (client `vibe-studio-core.js`);
  the client/server boundary can't share the public ESM, so keep the two strings in sync.
- **⚠ Open:** the endpoint is **unauthenticated + unthrottled** — fine while the studio is an
  un-launched seam, but a public POST that spends Neurons. Add auth + a rate limit in the
  **role-scoped scheduling increment** (item 6), where the studio gets real auth.

---

## Known issues / notes

- **CI is not deploying to Cloudflare yet** — the GitHub Actions deploy step logs
  *"Skipped deploy (no Cloudflare secret yet)"*; `dev/ship.sh`'s local fallback is what actually
  pushes prod each ship. Set `CLOUDFLARE_API_TOKEN` per `.github/workflows/README.md` so CI owns
  deploys cleanly. Until then, **always ship via `dev/ship.sh`** (it deploys locally).
- **Pre-existing CSS bug (NOT ours, not fixed):** `public/style.css` ~L667–673 — the `.lobby-setup`
  gear rule lost its selector in a prior merge (orphaned decl block + stray `}`). Gear base styling
  is dead. One-line fix, separate change.
- **Deferred renderers** (no assets/authoring yet): image bands, per-band glow, playlist autoplay,
  variable difficulty from rows. Build them when the studio tools that author them exist.

---

## How to verify the live theme locally (browser checks)

Local only — never schedule on prod (it'd overwrite the real daily):
```sh
echo "DAILY_ADMIN_TOKEN=localdev" > .dev.vars   # gitignored; rm when done
npm run dev
# Studio: http://localhost:8787/vibe-studio
# To test a themed DAY page: POST http://localhost:8787/daily/schedule (Bearer localdev)
#   with colorScheme + vibeTitle for today, then play.
# browse skill needs: export PATH="$HOME/.bun/bin:$PATH"
```
Revert a bad ship: `bash dev/revert.sh prod-backup-<N>` (or `npx wrangler rollback`).
