# Room Sandbox — Ladder Index & Overview

**Date:** 2026-06-02
**Status:** Draft for review — 7 design docs (rungs 00–06), consistency-checked.
**What this is:** the entry point to the Room Sandbox spec set. The vision: every room is an open, versioned, infinitely-configurable space — an always-speaking companion on every theme by default, one extensible `roomConfig` override schema, append-only version history, a progressive-disclosure editor a 5-year-old can use and a power user can go deep in, AI-browsable themes, and personal defaults that follow you. Voice clip identity stays Yang globally (`VOICE_EDITION = "yang"`); custom-voice render is "Part C" and out of scope across all rungs.

---

## The ladder (7 docs)

| Rung | Doc | One-line purpose | Ships UI? | Server? |
|------|-----|------------------|-----------|---------|
| **00** | `...room-sandbox-00-architecture-design.md` | **The Keystone.** Canonical `roomConfig` schema, merge chain, versioning, protocol, pure/side-effect split. Cited by all; ships nothing alone. | — | contract only |
| **01** | `...room-sandbox-01-config-foundation-and-always-speak-design.md` | Never-silent companion on **every** theme: `pickGuessEvent` + `mergeConfig` + a new `progress` bank. Reads `roomConfig` as `{}`. | no | no (Tier-C) |
| **02** | `...room-sandbox-02-persist-version-open-editing-design.md` | Lift `roomConfig` + `configHistory` into the Room DO: `set_room_config`/`revert_config`, sanitize gate, append-only versions, broadcast. | no | yes |
| **03** | `...room-sandbox-03-editor-ui-design.md` | First UI: "Companion & Vibe" settings section — preset cards + one chatty dial (simple) / advanced reveal + **read+revert version timeline** + live preview. | yes | no (reuses rung 02) |
| **04** | `...room-sandbox-04-config-sections-expansion-design.md` | Repeatable per-section recipe; promotes `palette` + new `sounds` to live (full), scaffolds `fonts`/`rules`/`creature`; adds `applyRoomConfig` seam. Economy stays Sacred/Tier-A. | yes (Advanced cards) | yes (sanitize) |
| **05** | `...room-sandbox-05-ai-browsable-intel-design.md` | Make themes + versions queryable without a WebSocket: `RoomIndexRecord` KV fan-out, `/api/room/<path>`, `/api/themes`, offline theme-intel miner. | no | yes (API) |
| **06** | `...room-sandbox-06-personal-defaults-and-discovery-design.md` | Activate the `userDefault` layer: per-user `defaultRoomConfig`, the try→stick→fork→invite→evolve loop, and a `/discover` surface. | yes | yes (User DO PUT) |

---

## Dependency graph / recommended build order

Build **strictly in number order 00 → 06.** Each rung's stated dependencies only point backward; there are no forward or circular dependencies after the consistency pass.

```
00 Keystone (schema · merge · versioning · protocol contract)
   │
   ├─► 01 always-speak  (mergeConfig + pickGuessEvent, override = {})        ◄─ ships the silence fix TODAY, no backend
   │      │
   │      └─► 02 persist + version + open editing  (DO storage + 2 messages + broadcast)
   │              │
   │              ├─► 03 editor UI  (presets + chatty dial + advanced + version timeline + live preview)
   │              │       │
   │              │       ├─► 04 config-sections expansion  (palette + sounds live; fonts/rules/creature scaffold; applyRoomConfig)
   │              │       │
   │              │       └─► 06 personal defaults + discovery  (userDefault layer; hosts ★/Fork rows in the rung-03 section)
   │              │               (soft-needs rung-03 version timeline for "fork from a version")
   │              │
   │              └─► 05 AI-browsable intel  (projects roomConfig/configHistory to KV + read API; no UI)
   │                      (can land any time after 02; independent of 03/04/06)
```

**Notes on ordering flexibility:**
- **05 (AI-browsable)** only needs rung 02's persisted `roomConfig`/`configHistory`. It can be built in parallel with 03/04 once 02 lands — it adds no UI and no schema change (only a projection type).
- **06 (personal defaults)** needs rung 02's broadcast and rung 03's editor section to host its `★ Make this my default` / `Fork` controls; it soft-needs rung 03's version timeline for "fork from a version" (forking a live room works without it).
- **01** is independently shippable to prod (Tier-C, no backend) and fixes the companion silence immediately — recommended first ship even before 02 is ready.

---

## Shared `roomConfig` schema reference

**The schema, merge rules, version record, caps, protocol, and preset registry are defined once — in rung 00** (`2026-06-02-room-sandbox-00-architecture-design.md`). Every other rung **cites and consumes; none redefine.** Verified: `RoomConfig`, `VoiceConfig`, `VoiceLineBanks`, `Bank`, `PresetId`, `ConfigVersion`, and `PRESETS` appear as type definitions only in rung 00.

Quick map of who owns what (all anchored in rung 00):

- **`RoomConfig`** = one extensible override object; additive optional sections. `{}` ≡ pure edition default.
  - `voice` — fully specified, the only live consumer in rungs 00–03.
  - `palette`, `sounds` — promoted to live in **rung 04** (`sounds` was added to rung 00's canonical schema during this pass, per the citation rule).
  - `fonts`, `rules`, `creature` — scaffolded in rung 04; full hooks deferred to their own rungs.
  - `economy` — **Sacred / Tier A**, deferred to its own gated rung; never touched in 00–06.
- **Merge chain (LOCKED):** `editionDefault ← roomOverride ← userDefault ← session`, resolved client-side by the variadic `mergeConfig`. Rungs 00–02 implement the first two layers; rung 06 activates `userDefault` (via the owned-room **seed path**, held out of the guest merge); `session` stays reserved.
- **Merge rules:** sections fall through independently; objects shallow-merge one level; `voice.react` **deep-merges** by every sub-key (`voiceBudget`/`win`/`greens`/`mistake`); `events`/`priority` replace; **line banks append unless wrapped `{replace}`**.
- **Versioning:** append-only `configHistory: ConfigVersion[]` in the Room DO blob; revert is forward-only. `v` is a **monotone counter** (`lastEntry.v + 1`), not array index (rung-02 correction to the keystone sketch — needs Yan's blessing).
- **Caps (`CONFIG_CAPS`):** `historyMax = 50` (FIFO), `bankMax = 24` lines/leaf, `lineMax = 140` chars/line.
- **Protocol:** two `ClientMessage`s — `set_room_config`, `revert_config` — plus optional `roomConfig` seed on `hello`. Kindness model: any present player may edit; `by` records authorship.
- **Default-preserving guarantee (regression contract):** `mergeConfig(editionDefault, {})` ≡ `editionDefault`, byte-for-byte today's Yang-global behavior. Must be tested in every rung that touches the merge.

---

## Open questions for Yan (aggregated, ranked)

The load-bearing ones first — these shape implementation plans:

1. **Personal-default precedence semantics (rung 06, the big one).** The keystone orders `roomOverride ← userDefault`, i.e. a user default would *outrank* a room's vibe. Rung 06 resolves this by realizing your default **through the seed path for rooms you own** and holding it **out of the guest merge** — your default follows you without a guest clobbering a host. Confirm that "follows you = seed-only for owned rooms" is the intended semantic, or whether personal talkativeness should subtly win even as a guest.

2. **Open-by-default publishing (rung 05).** `/api/themes` exposes every room's config **and** the `by` usernames with no auth (consistent with the already-public `/api/user`). Confirm public authorship enumeration is intended before the read API ships.

3. **`v` numbering post-FIFO drop (rung 02).** The keystone sketch numbers versions `configHistory.length + 1`, which breaks `revert(v)`/`parent` after the 50-entry FIFO drop. Rung 02 proposes a **monotone counter** (`lastEntry.v + 1`). One-line blessing needed — it diverges from the keystone example (now flagged in the keystone too).

4. **Progress voice budget (rung 01).** `progress` currently **always-speaks** (the point of "never silent"), so a fast game could surface a line nearly every guess. Keep always-speak (rung-03's talkativeness dial is the off-ramp), or budget it like routine `wrong`? Specs lean always-speak.

5. **Editor scope + commit model (rung 03).** (a) The keystone split version-history into its own rung; rung 03 folds a **read+revert timeline** in (full diff/label UX stays later) — confirm the merge. (b) Advanced edits commit behind an explicit **"Save changes"** button (version-frugal) vs. instant-commit — confirm for the playground feel.

Secondary taste calls (won't block plans): preset re-pick after advanced edits = hard-reset-with-confirm (keystone OQ #3); system-chat noise debounce (chat on preset-pick + revert only, keystone OQ #4); palette default surface = curated-5 swatches vs. all ~14 vars (rung 04); fonts bundled into the "Colors & Skin" card (rung 04).

---

## Consistency pass — what was checked & fixed

All seven docs were cross-read for schema-name, merge/version/message, and rung-numbering consistency. Findings fixed inline:

- **Rung-numbering drift (the big one).** The keystone's dependency table and several cross-references used a stale numbering (04 = version-history-UI, 05 = personal-defaults, AI-browsable = "later") that disagreed with the actual docs written (03 folds in the timeline, 04 = config-sections, 05 = AI-browsable, 06 = personal-defaults + discovery). Rewrote the keystone dependency table and reconciled every cross-doc reference in rungs 01–06 to the canonical 00–06 numbering.
- **`sounds` section missing from the keystone.** Rung 04 ships `sounds` as a new section and (per the citation rule) required it be added to rung 00 first. Added the `sounds?: SoundConfig` stub to the keystone's `RoomConfig` and the stub-shape list.
- **`react` deep-merge sub-key list.** Keystone listed `win/greens/mistake`; rung 01 listed `win/greens/mistake/voiceBudget`. Since `react.voiceBudget` is a real sub-key in the keystone's own `react` shape comment, aligned the keystone to deep-merge **every** sub-key including `voiceBudget`.
- **Endpoint verb/path nits.** Keystone said `PATCH /api/user/<name>/config`; rung 06 uses `PUT`. Aligned keystone to `PUT` (rung 06). Fixed rung 06's economy-spec citation to the full path.
- **No type redefinitions** found outside rung 00 — the citation rule holds across all consumers (`RoomConfig`, `VoiceConfig`, `Bank`, `VoiceLineBanks`, `PresetId`, `ConfigVersion`, `PRESETS`).
- **No scope gaps or overlaps** remain: voice (01–03) → persistence (02) → editor+timeline (03) → other sections (04) → AI index (05) → personal defaults+discovery (06). Economy, rules-migration, creature-skins, the session layer, and Part-C voice render are consistently deferred with named owning rungs.
