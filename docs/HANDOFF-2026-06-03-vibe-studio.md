# Wordul — Vibe Studio Handoff (2026-06-03)

Continuity document for the **total room vibe studio** (theme / vibe editor for consistent rooms + Wordul of the Day curation).

This captures the full requirements, design exploration via golden-design-ritual prototypes, iterations from feedback, and the path forward. The work was done in a dedicated brainstorming + design-ritual session after the initial screenshot of the 2026-05-31 daily (house fallback with visible clash between purple daily-unlock veil and board/theme).

## Where we stand
- **Live prototypes** (playable, self-contained HTML, published to R2 and served at wordul.com/designs/):
  - Primary (refined workshop after feedback): https://wordul.com/designs/vibe-studio-workshop
  - Editorial direction: https://wordul.com/designs/vibe-studio-editorial
  - Arcane / mystical direction: https://wordul.com/designs/vibe-studio-arcane
  - Gallery: https://wordul.com/designs/
- All prototypes include:
  - Prominent vibe/room **title** + word selector (first manifestation).
  - Quick AI "Spin Vibe" (agent simulation) that shows the exact prompt used (teaches users how to prompt the real backend).
  - 3-color quick scheme with randomizer, "sparkle from title", and eyedropper (screen color pick where supported).
  - Live interactive board preview + companion reactions pulled from the *current* edited config (real Wordle-style feedback + escalating mistake tiers).
  - Story starter with **auto-suggest** + purpose chips ("Empower builders", "Ignite creativity", "Unlock magic") for the "empower humanity" angle.
  - Expand to full rich SEO artifact (blog post + generated images + simulated video for the magical hidden-word creative gift).
  - "View as Daily Artifact" showing the beautiful themed day page (rich post + media + leaderboard + chat + winner/curator celebration with "warded by", avatar, B.E.O. link placeholder).
  - Fine-tune (voice lines, frequency, escalating repeats) hidden behind gear for progressive disclosure.
- Reduced visual noise (fewer pills/badges). "Lock + Forge" language removed in favor of clear "Lock Word" + title-driven flow.
- Ties directly to existing systems:
  - Room Sandbox (rung 00 keystone + rung 03 editor UI vision): `roomConfig` for voice lines/banks/events/react (including mistake escalation tiers 1/2/3+), `mergeConfig`, presets for quick path, `voiceBudget` / talkativeness for frequency / "less noise".
  - Editions (public/editions/*.js) for base designs (palette, fonts, motion, effects, companion personality).
  - Daily (src/daily-core.ts `World`, src/daily.ts, public/app.js `renderDailyUnlock`, style.css daily-unlock veil).
- Current pain point addressed (from screenshot): houseWorld always forced mismatched `edition: "default"` (ultraviolet) + `voice: "yang"` (warm gold), plus hardcoded purple daily-unlock styles causing visible clashes. The studio enforces consistency and will let us set proper defaults + rich artifacts.

**Tests / build**: No new code shipped yet (pure design exploration + prototypes). Existing `npm test` and typecheck remain green from prior work.

## Requirements & Vision (synthesized from conversation)
**Core goal**: Super easy for people (starting with admins, later winners/community) to create their own consistent style ("total room vibe"). A theme = designs (palette/fonts/motion/effects via edition or overrides) + vibe/story tone + voices (deep line editing) that feel coherent. No more clashes like the 2026-05-31 daily.

**First use case (admins curating daily for tomorrow)**:
- Select the word (validated).
- Spin up cheap/prompt-driven agent (API or tunneling) → generates a full vibe/theme based on prompt (title + word + description).
- Human selects preferred generated theme, fine-tunes a little.
- Provides short personal story starter ("I chose this word because...").
- AI reprompts/expands starter into super elaborate SEO-optimized blog post (about Wordul world, worduling, empowerment).
- AI also generates images + optional video.
- The whole thing (word + full vibe config + rich story + media) becomes the permanent artifact for that day.
- Next day: players see beautiful themed UI (rich post + media gallery + video + leaderboard + chat) after finishing. Celebration for winner/curator (avatar, "warded by", credit, B.E.O. link, etc.).

**Longer term**:
- Persistent rooms can use the same vibes (or fork them).
- Winner of the day gets to curate (choose word + vibe for a future day or week).
- "Super hidden word" (existing reserved `bonusWord` in World) triggers magical creative gift mode (Minecraft + Roblox + Wordle + SimCity creativity — letters become blocks, tiny city builds, pure playful empowerment). Studio/preview should surface this.
- Repeat mistake handling: escalating gold penalties (already in rules/gold.js) + escalating voice lines (1st / 2nd / 3rd+ same dead letter) authored in granular editor.
- Voice clone frequency: controllable via budgets/talkativeness (less noise option).
- Themes can be promoted to "of the day" or live on as rooms.

**Studio UX principles** (from feedback + prototypes):
- **Dual path**: Quick/fast (presets + "Spin AI Vibe" that feels magical/random + instant preview) **or** super granular (fine-tune everything).
- Prominent **title** for the vibe/room (drives sparkle colors, prompt, story tone).
- Word + title + quick 3-color scheme = "first manifestation" (instant visual feedback).
- Spin agent shows the prompt it used → teaches users the prompting language.
- Color tools: 3 swatches, random, title-based sparkle, eyedropper (screen pick).
- Granular (voice lines per event + tiers for repeats, frequency slider) hidden behind gear / progressive disclosure.
- Story: starter + auto-suggest + quick purpose chips for different empowerment angles.
- Live previews everywhere: playable board (with real companion lines from current config) + simulated daily artifact card/page (so you see consistency/no clash immediately).
- Reduce pills/badges. Joyful, premium, playful, creative feel (not corporate admin tool).
- Output is schedulable to daily (via existing /daily/schedule) or usable for rooms.

## Scope — the v1 cut line (read this before building)
The vision above is ~6 separable products with wildly different cost and certainty. Building them as one "studio" balloons the spec and ships nothing. Split by risk:

- **In v1 (cheap, certain, all manual — no AI on the critical path):**
  - World schema additions + `normalizeWorld` defaults (back-compat for already-scheduled days).
  - Studio UI: prominent **title**, validated **word**, quick **3-color** scheme, **granular voice-line** editing (reuse Room Sandbox rung 03), **manual** story body.
  - **Theme-driven** daily artifact rendering (kills the clash) + schedule via existing `/daily/schedule`.
  - Admin-only, behind the existing `DAILY_ADMIN_TOKEN` (auth already solved — see Open Questions).
- **v2 (AI enrichment — spike separately, each OPTIONAL; manual fields always work standalone):**
  - "Spin Vibe" agent (prompt → vibe + starter), story → SEO-blog expand, image/video generation. These have real latency, cost, and failure modes — they enrich, they are never a hard dependency.
- **Vision (NOT scoped — do not let these into the v1 spec):**
  - The "magical hidden-word creative gift" (Minecraft+Roblox+SimCity letters-as-blocks). Note: this rides on `World.bonusWord`, which `daily-core.ts` marks **RESERVED, "no behavior yet"** — it's a whole product, not a studio feature.
  - Winner-of-the-day curation loop, persistent-room vibe forking, version history.

## Architecture & Integration Pointers
- **Data model**: Extend `World` in `src/daily-core.ts` (and normalize/schedule paths) to include:
  - `roomConfig` (full from Room Sandbox keystone — voice.lines banks, react, events, priority, talkativeness, plus future palette/sounds/etc.).
  - Rich story: keep `story` but support longer markdown body + `media?: { images: string[], video?: string }` (R2 keys or similar).
  - `vibeTitle?: string`, `colorScheme?: {accent1, accent2, accent3}` (for quick manifestation + daily chrome).
  - **Back-compat (required):** these are all additive/optional. `normalizeWorld` must default them so days already scheduled (which have no `roomConfig`/`vibeTitle`/`colorScheme`) still render correctly — don't break in-flight Worlds.
- Daily rooms already pull edition/voice/story from World and lock them. Add `roomConfig` seeding (like current edition/voice) so companion reactions use the curated lines.
- Daily unlock / artifact rendering (`public/app.js` renderDailyUnlock + `#dailyStory` + style.css) needs to become fully theme-driven:
  - Pull CSS vars / data-edition + new data-vibe or inline styles from the World config.
  - Support rich content (long prose, image gallery, video embed, "hidden gift" section).
  - The purple hardcoded veil/rim/kicker in `.daily-unlock` must go or be overridden per-vibe (this was the clash source in the screenshot).
- Studio itself: Builds on Room Sandbox rung 03 vision (`public/roomEditor.js` or new `vibe-studio.js` + settings integration). Live preview reuses board rendering + `pickGuessEvent`/`companionReact` + `mergeConfig`. "Spin agent" and "Expand story" are UI affordances that will call real backend (future agent endpoints).
- Agent flows (future):
  - Vibe gen: prompt (title + word + description) → edition choice + roomConfig voice overrides + suggested starter + color hints. Must produce consistent bundles.
  - Story expand: starter + word + vibe context → full SEO blog (Wordul lore, internal links, empowerment angle) + calls to image_gen / image_to_video for media.
  - **Failure contract (don't let this be a silent failure):** agent calls are enrichment, never a hard dependency. On timeout/error the studio keeps the human's manual title/word/colors/story and surfaces a clear "AI step failed, your work is saved" state — a half-generated vibe must never overwrite or block a manual one.
- Scheduling: Existing `POST /daily/schedule` (admin token) will accept the enriched World. House fallback should use a proper consistent default vibe (not mismatched default + yang).
- Media storage: R2 (wordul-designs or new bucket) referenced from World. Serve in daily permalinks for SEO.
- Previews in studio must support the "magical gift" creative mode (bonusWord trigger → special animation / mode in board preview).
- Future: Personal defaults, discovery, winner handoff (curator field already reserved), version history on vibes.

## What the Prototypes Validate
- The dual quick/granular path works and feels delightful.
- Live previews (board + daily card) are essential for "see the consistency" and catching clashes early.
- Showing the agent prompt teaches prompting without docs.
- Title-driven sparkle + 3-color + empowerment story chips directly address the "easy for people to create their own style" + "empower humanity" goals.
- The rich artifact (blog + media + beautiful UI + celebration) turns a daily into a permalinked, SEO-rich, shareable creative object (as originally envisioned in the 2026-06-02 Wordul-of-the-Day spec).

## Open Questions / Decisions Needed

**Already resolved — do not re-litigate** (locked in `2026-06-02-wordul-of-the-day-design.md`):
- ~~Admin auth / "scope for v1"~~ → admin-only, `Authorization: Bearer DAILY_ADMIN_TOKEN`, checked in the worker. The studio lives behind that token (settings/admin surface); winners/rooms come later.
- ~~Scheduling contract~~ → `POST /daily/schedule` + `normalizeWorld` is the validated entry point. The studio produces a `World`; it does not invent a new write path.

**Genuinely open — v1 blockers (answer in the spec):**
- **Default "house" vibe:** pick/author ONE strong consistent default (proper Wordul edition + tuned voice lines) to replace the current mismatched `default`+`yang`. This is also the Lane-0 fix below.
- **Daily chrome inheritance:** full theme inheritance (incl. `colorScheme` driving the veil) vs. per-edition CSS overrides. Decide before building artifact rendering.
- **B.E.O.:** undefined acronym currently rendered in the artifact UI. **Define it or cut it from v1** — don't ship a UI element no one can name.
- **Fine-tune exposure:** gear/progressive-disclosure is decided; open sub-question is whether power users also get the raw `roomConfig` JSON editor (per Room Sandbox).

**Open but deferred — v2 / vision (keep OUT of the v1 spec):**
- Agent backend for "Spin Vibe" (local LLM? external API? subagent/MCP?) and studio iteration UX.
- Media generation path (direct `image_gen`/`image_to_video` vs. dedicated worker) + R2 storage keys in `World`.
- Winner-of-the-day curation loop ("warded by" credit UI, multi-day word choice).
- Hidden-word creative gift surfacing + gold/celebration ties.

## Recommended Next Steps — three lanes, in priority order

The lanes are independently shippable. Do NOT block Lane 0 on the studio, and do NOT block the studio on AI.

**Lane 0 — ship today (Tier-C, decoupled from everything else).** This is the original pain from the screenshot and it doesn't need the studio:
- Make `.daily-unlock`'s hardcoded purple veil/rim/kicker use `var(--accent)` + edition-scoped overrides (`public/style.css`).
- Fix `houseWorld` in `src/daily-core.ts` so the fallback uses a coherent edition+voice pairing (not `default`+`yang`).
- Verify on the live daily, ship via `/push`. Closes the clash regardless of when the studio lands.

**Lane 1 — studio v1 (admin, no AI).** Spec → plan → build:
1. Pick a prototype direction (workshop is primary) — source now lives in-repo at `docs/prototypes/vibe-studio/`.
2. Write `docs/superpowers/specs/2026-06-03-vibe-studio-design.md`, **scoped to the v1 cut line above**, citing Room Sandbox (00 keystone + 03 editor) and the Wordul-of-the-Day spec. Cover: World schema + `normalizeWorld` defaults (back-compat), studio UI flows, theme-driven artifact rendering, consistency rules. Leave agents as stub seams.
3. `writing-plans` → implementation tasks: World enrichment + schedule wiring → studio UI component → daily artifact rendering → prototype-to-real-code promotion.
4. Update `GAME_RULES.md` + how-to-play only for mechanics actually finalized in the v1 editor (repeat-mistake escalation, frequency). Hidden-gift stays out.

**Lane 2 — AI enrichment (spike separately, after v1 is real).** Each is optional and must honor the failure contract above: "Spin Vibe" agent, story→SEO expand, image/video gen. Settle agent backend + media storage when you start this lane, not before.

## References
- Original daily vision: docs/superpowers/specs/2026-06-02-wordul-of-the-day-design.md
- Room Sandbox (the deep voice/granular foundation): docs/superpowers/specs/2026-06-02-room-sandbox-*-*.md (especially 00 keystone + 03 editor UI)
- Current daily code: src/daily-core.ts, src/daily.ts, src/room.ts (seedDailyIfNeeded), public/app.js (renderDailyUnlock), public/style.css (.daily-unlock)
- Editions & voice: public/editions/, public/edition.js, public/roomConfig.js
- Prototypes source (for promotion): `docs/prototypes/vibe-studio/{workshop,editorial,arcane}.html` (copied into the repo so they survive — `/tmp` is wiped on reboot). `workshop.html` is byte-identical to the live `/designs/vibe-studio-workshop` and carries the latest feedback.
- Existing handoff style: docs/HANDOFF-2026-06-01.md

This session was pure exploration + visual prototyping (no production code changes). Everything is reversible and captured in the live designs.

Ready when you are — just say "go", "write the spec", "plan it", or point to a specific prototype/direction. 🚀

(Last reconciled with conversation: 2026-06-03)