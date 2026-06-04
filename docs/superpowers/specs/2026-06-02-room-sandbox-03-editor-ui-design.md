# Room Sandbox — The Editor UI (Rung 3)

**Date:** 2026-06-02
**Status:** Draft for review
**Part of:** Room Sandbox ladder — **rung 03**. This rung ships the human-facing editor for the persisted `roomConfig`: a chevron-categorized settings panel built on the `public/settings.js` patterns. It is the **first rung with UI** — rungs 01/02 wired the engine and protocol; this rung exposes them.

> **Citation rule.** This spec consumes the canonical schema, merge contract, version record, and protocol from `docs/superpowers/specs/2026-06-02-room-sandbox-00-architecture-design.md`. It does **not** redefine `RoomConfig`, `mergeConfig`, `resolvePreset`, `PRESETS`, `ConfigVersion`, `set_room_config`, or `revert_config` — it builds the screen that drives them.

---

## Problem

By the end of rung 02 a room can carry a persisted `roomConfig.voice` override, the server stores/broadcasts it, `mergeConfig(editionDefault, snapshot.roomConfig?.voice)` resolves the effective config, and `pickGuessEvent` makes the companion always-speak. But there is **no way for a player to change any of it from the screen.** Today's settings modal (`#settingsModal` in `public/index.html`, wired by `public/settings.js`) exposes only theme, color-blind, hard-mode, reduced-motion, and keyboard layout — all `localStorage`-backed personal toggles. Room-bound state (edition, mode, length) is edited from separate lobby pickers in `public/app.js` (`syncLobbyEdition` / `syncModePicker` / `syncLengthSelect`), each its own bespoke control.

The vision demands the opposite of "more bespoke pickers": **one progressive-disclosure editor** where a 5-year-old taps a preset card and is done, while a power user reveals raw config — per-category toggles, priority ordering, custom line banks — and browses/reverts an append-only version timeline, all with a **live preview** (the companion reacts to a sample guess), all **forgiving and undo-friendly**. "Hard to break" is a feature, not a hope.

## Goal

Ship a **"Companion & Vibe" chevron section** in the settings modal that edits `snapshot.roomConfig` via the rung-02 protocol, with two clearly separated tiers:

- **Simple mode (default, always visible):** big tappable **preset cards** (one tap = done) + one **"How chatty"** talkativeness dial. Nothing else required; sensible defaults everywhere.
- **Advanced mode (revealed on demand, never in your face):** a single clear "Advanced" reveal opening nested sub-subcategories — **priority ordering**, **per-category toggles**, **custom line add/edit** — plus **reserved stub rows** (skins / graphics / custom sounds) that rungs 4+ flesh out.
- **Live preview:** a sample-guess companion reaction that re-fires whenever the working config changes, so you *hear/see* the vibe before committing.
- **Version timeline:** browse the append-only `configHistory` and one-tap **revert**.
- **Robot-voice hint:** any custom line shows a "will use robot voice until rendered" note (per the smart-companion split-voice / `speechSynthesis` fallback).

The whole thing must read as a **creative playground**: joyful copy, forgiving inputs (clamp, never reject), and reversible everything (every change is a version).

---

## Design

### Architecture

```
public/settings.js  ── openSettings() gains roomConfig callbacks ──┐
  (modal chrome, chevron sections, nested sub-chevrons)            │
                                                                   ▼
public/roomEditor.js  (NEW — pure-ish view module)                 renders into
  renderCompanionSection(rootEl, { roomConfig, history, edition,   #companionSection
                                   locked, on* })                  (NEW mount in index.html)
  ├─ renderPresetCards()        — simple: PRESETS chips-as-cards
  ├─ renderChattyDial()         — simple: talkativeness slider
  ├─ renderAdvancedPanel()      — nested sub-chevrons (toggles/priority/lines/stubs)
  └─ renderVersionTimeline()    — configHistory list + revert buttons
                                                                   │
        emits via injected callbacks ──────────────────────────────┘
            onApplyConfig(workingConfig, label?)  ─► app.js send({type:"set_room_config"})
            onRevert(v)                           ─► app.js send({type:"revert_config", v})
            onPreview(workingConfig)              ─► app.js firePreviewReaction()

public/app.js  ── showSettings() injects the callbacks + supplies snapshot data;
                  firePreviewReaction() drives the live preview (reuses showCompanion path)
```

- **`roomEditor.js` owns the editor DOM**, mirroring how `edition.js` owns `renderEditionPicker`. It is handed data + callbacks; it does not import `app.js` or touch the WebSocket. Selection/expand state lives in a module-level **working-config draft** (not committed until Apply / preset tap), so editing is a sandbox you can abandon by closing the modal.
- **`settings.js` stays the chrome owner.** It already wires the outer chevron accordion (`wireSectionToggles`, delegated on the modal). Rung 03 adds the new section's mount call into `openSettings()` and a **nested sub-chevron** delegated handler (the settings-ui exploration flagged this as a ~3-line addition + a CSS class pair).
- **`app.js` stays the orchestrator + the only sender.** `showSettings()` passes the current `snapshot.roomConfig`, `snapshot.configHistory`, active edition, a `locked` flag (mid-game / rules-touching guard), and the three `on*` callbacks. All three resolve to existing `send(...)` calls (rung 02 messages) or the existing companion-reaction path.
- **No new server work.** Everything the editor sends is a rung-02 `set_room_config` / `revert_config`. The snapshot already carries `roomConfig` + `configHistory`.

### Components / files (exact paths)

**New — `public/roomEditor.js`** (view module; importable by `settings.js`/`app.js`, the heavy logic is delegated to the pure `public/roomConfig.js`):
- `renderCompanionSection(rootEl, opts)` — top-level mount. `opts = { roomConfig, configHistory, edition, locked, presetId, on: { applyConfig, revert, preview } }`. Builds simple block, then the collapsed Advanced sub-section, then the version timeline. Imperative-build like `renderEditionPicker` (clears `innerHTML`, appends fresh nodes — avoids the re-open handler-stacking risk).
- `renderPresetCards(rootEl, current, onPick)` — the simple path. One card per `PRESETS` entry (consume `PRESETS` + `resolvePreset` from `roomConfig.js`; never hardcode a preset here). Active card = `roomConfig.preset` (or `"default"` when absent). Tap → confirm-if-diverged (see Error handling) → `onPick(resolvePreset(id))`.
- `renderChattyDial(rootEl, value, onInput)` — an `<input type="range" min=0 max=1 step=0.05>` bound to `voice.talkativeness` (falls back to the edition's routine budget, e.g. yang `0.33`, when absent). Label maps numeric → words ("Silent · Calm · Chatty · Nonstop") so a kid reads vibes, not numbers. `onInput` updates the working draft + fires preview (debounced); commit on release.
- `renderAdvancedPanel(rootEl, working, edition, on)` — the on-demand depth. Nested `.settings-subsection` chevrons:
  - **Reactions** → per-category toggles for `voice.events` (`greens` / `progress` / `wrong`) as `.switch` rows; "off" mutes that event (schema: `events[x] = false`).
  - **Priority** → reorderable list of the three `GuessEvent`s editing `voice.priority` (up/down buttons — no drag dependency; touch-safe; defaults to `["greens","progress","wrong"]`).
  - **Lines** → per-event/tier custom-line editor writing `voice.lines.*` **append banks** (schema: append-by-default; a "Replace edition lines" checkbox wraps the leaf as `{ replace: [...] }`). Each added line shows the **robot-voice hint** + live char counter against `CONFIG_CAPS.lineMax` (140).
  - **Reserved stub rows** → disabled/"Coming soon" rows for Skins, Colors & Fonts, Custom Sounds — visible placeholders that name the section keys (`creature`, `palette`/`fonts`) so the disclosure shape exists; **rungs 4+ fill them** (see Non-goals).
- `renderVersionTimeline(rootEl, history, currentV, onRevert)` — reverse-chron list of `ConfigVersion`s (`v`, relative time from `at`, `by`, `label`, "based on <preset>" provenance). Current version pinned/badged. Each older entry gets a **Revert** button → `onRevert(v)`. Empty history → a friendly "No saved versions yet — every change you make is saved here."

**`public/index.html`** — add one `<section class="settings-section">` block ("Companion & Vibe") between Gameplay and Advanced, containing a single mount `<div id="companionSection" class="setting-row stack">`. (Per extension-point #1: the outer accordion needs no JS change.) Reuse `.modal-card` width; if the editor feels cramped at 420px, add `.settings-card--wide` (a one-rule CSS modifier, extension-point #7) — flag as an open question, not a default.

**`public/settings.js`** — in `openSettings(opts)`:
- Call `renderCompanionSection(...)` into `#companionSection` with the injected room callbacks (new entries in the options bag: `roomConfig`, `configHistory`, `editionForCompanion`, `companionLocked`, `onApplyConfig`, `onRevertConfig`, `onPreviewConfig`). Backward-compatible additive args (the options-bag absorbs them; settings-ui risk #4).
- Add a **nested sub-chevron** delegated handler for `.settings-subsection-head` (mirror `wireSectionToggles`; idempotent via a `dataset.subsectionsWired` guard) and **collapse Advanced to calm on every open** (consistent with the outer-section reset).

**`public/app.js`** — in `showSettings()`:
- Pass `snapshot.roomConfig`, `snapshot.configHistory`, the active edition, and `companionLocked = (phase === "playing")` (rules-section guard; voice-only edits may stay live — open question).
- Wire `onApplyConfig(cfg, label) → send({ type: "set_room_config", config: cfg, label })`, `onRevertConfig(v) → send({ type: "revert_config", v })` (both rung-02 messages).
- Add `firePreviewReaction(workingConfig)` — resolves `mergeConfig(editionDefault, workingConfig.voice)` and drives a **sample** companion reaction through the existing `showCompanion`/`speakLine` path with a canned `ctx` (e.g. a 2-green sample → `greens` tier 2), so the preview uses the real engine, not a mock. Preview is local-only; it never sends.
- On snapshot receipt while the modal is open, **re-render** `#companionSection` from the new snapshot (settings-ui risk #5: the modal does not auto-refresh today; the kindness model means another player may change the config under you — re-render keeps the simple block + timeline truthful while preserving the user's *uncommitted advanced draft* if any, with a gentle "someone updated this room" toast).

**`public/style.css`** — new flat classes (component-prefixed, BEM-flat per convention):
- `.settings-subsection` / `.settings-subsection-head` / `.settings-subsection-body` / `.settings-subchevron` — nested accordion (same `aria-expanded` → rotate + `display` pattern, smaller font ~13px; replicate the `body.reduced-motion` transition-off rule — settings-ui risk #3).
- `.preset-card` (big tappable card: title, one-line vibe blurb, active ring — reuses `.mode-row` card feel) + `.preset-grid`.
- `.chatty-dial` (range + word-label row), `.line-editor` / `.line-chip` / `.line-add` / `.robot-hint`, `.priority-list` / `.priority-item` (up/down arrows), `.version-row` / `.version-meta` / `.version-revert` / `.version-current`, `.advanced-reveal` (the single "Advanced ⚙" toggle styled distinct from raw sub-chevrons), `.stub-row` (disabled "Coming soon").

### Data flow

```
open settings
  app.showSettings() → settings.openSettings({ roomConfig, configHistory, edition,
                                               companionLocked, onApplyConfig,
                                               onRevertConfig, onPreviewConfig, ... })
    → roomEditor.renderCompanionSection(#companionSection, {...})
        draft = structuredClone(roomConfig)          // local working copy

SIMPLE — pick a preset
  tap card → (confirm if draft diverged) → draft = resolvePreset(id)
           → onApplyConfig(draft, "preset: <id>")    // commits immediately (one-tap done)
           → app.send(set_room_config) → DO appends version → broadcast
           → snapshot recv → re-render section (active card updates)

SIMPLE — chatty dial
  drag → draft.voice.talkativeness = value → onPreviewConfig(draft) (debounced, local)
  release → onApplyConfig(draft)            // commit on release, not every frame

ADVANCED — toggle / priority / line edit
  edit → mutate draft → onPreviewConfig(draft) (live) ; "Save changes" button → onApplyConfig(draft, label?)

TIMELINE — revert
  tap Revert(v) → onRevertConfig(v) → app.send(revert_config) → DO appends forward-only revert version
                → broadcast → re-render (new current = the reverted config)
```

- **Two commit cadences (LOCKED):** preset tap and dial-release commit immediately (the simple path must feel instant and done); advanced edits batch behind a **"Save changes"** button (avoids version spam from slider drags / per-keystroke writes — addresses the architecture doc's open question #4 about chat noise). Preview is always local and free.
- **The editor never resolves config itself** — it always calls `mergeConfig` from `roomConfig.js` for preview and reads the raw `snapshot.roomConfig` (the delta) for the controls' current values. Single source of truth, no duplicated merge logic.

### Error handling

- **Forgiving inputs, never reject.** Talkativeness clamps 0..1 client-side (server `sanitizeRoomConfig` clamps again — rung 00). Custom lines truncate at `CONFIG_CAPS.lineMax` with a visible counter; adding past `CONFIG_CAPS.bankMax` disables the add button with a "bank full" note rather than erroring.
- **Diverged-preset confirm.** Re-picking a preset after advanced edits shows a soft confirm ("This replaces your custom tweaks with <Preset>. Your current setup is saved in history first — revert anytime.") — leaning hard-reset per architecture open question #3, made safe by the version trail.
- **Locked mid-game.** When `companionLocked`, rules-touching controls are disabled with a "locked while a round is playing" note (mirrors the `editionLocked` pattern). Voice-only edits may remain live (open question).
- **Concurrent edit (kindness model).** Snapshot arriving while open → re-render simple block + timeline; if the user has an uncommitted advanced draft, keep it and toast "someone updated this room's vibe" rather than silently clobbering.
- **Bad revert `v` / empty history** — handled server-side (rung 00: no-op + warning); the timeline only renders revert buttons for existing versions, so the UI cannot send a bad `v`.
- **Custom-line robot-voice expectation** — every custom line renders with `.robot-hint` ("Yan's voice will speak this once it's recorded — robot voice until then") so the `speechSynthesis` fallback is a documented delight, not a surprise (cite smart-companion split-voice).

### Testing approach

- **Pure logic stays in `roomConfig.js`** (already unit-tested in rung 00/02): merge, preset expansion, caps. Rung 03 adds **no new pure contract** — it consumes them.
- **`roomEditor.js` view tests (Vitest + jsdom-style DOM, matching existing `public/*.js` import aliases):**
  - `renderPresetCards` marks the active card from `roomConfig.preset`; tapping a non-active card calls `onPick` with `resolvePreset(id)`.
  - `renderChattyDial` reflects `voice.talkativeness` (and edition fallback when absent); input fires `onPreview`, release fires `onApply`.
  - Advanced toggles write `events[x] = false`; priority up/down reorders the array; line-add appends to the right bank and respects `lineMax`/`bankMax`; "Replace" checkbox emits `{ replace: [...] }`.
  - `renderVersionTimeline` lists newest-first, badges current, renders a Revert button per older version calling `onRevert(v)`; empty history → friendly empty state.
- **Manual smoke** (the DOM-wiring + WS round-trip, per rung-00 convention): open settings → tap a preset → companion preview changes → confirm chat note + new version → revert → confirm config restored. No CI; verify locally then `/push`.

---

## Non-goals (deferred to other rungs)

- **The merge engine, protocol, and persistence** — owned by rungs 00/02 (`mergeConfig`, `set_room_config`/`revert_config`, DO storage). This rung only drives them.
- **Always-speak engine / `pickGuessEvent` / `progress` bank** — rung 01. The preview *uses* it; it does not define it.
- **Skins, Colors & Fonts, Custom Sounds editors** — only **reserved stub rows** here. The real palette/fonts/creature editors are the **theming** and **skins** rungs (architecture stub sections `palette`/`fonts`/`creature`).
- **Custom-voice rendering** — unrendered lines fall back to `speechSynthesis` (the robot-hint sets that expectation). Local render is "Part C" (remote-trigger render) and online cloning is "Part D" — both out of scope.
- **Personal defaults / fork-to-my-default** — the "make this MY default" affordance belongs to the **personal-defaults rung 06** (`userDefault` merge layer + User DO write). This editor edits the **room** delta only.
- **Economy knobs** — `economy` is Sacred / Tier A; its editor rung needs explicit gating. No economy controls here, not even a stub row.
- **AI-browsable config index** — exposing `configHistory` for AI mining (KV/R2 fan-out, `/api/room/<path>`) is a later rung; the timeline here only reads the in-snapshot history.
- **`.settings-card--wide` as default** — kept optional; only adopted if the editor proves cramped at 420px.

## Open questions

1. **Version timeline scope (keystone now updated).** The keystone dependency table has been reconciled so the **read+revert timeline lives in this rung (03)**, with full history UX (diffs, rename labels, branch view) deferred as a later enhancement. Confirm that read+revert-here / diffs-later split is the intended scope.
2. **Voice-only edits while locked.** Should the chatty dial + line edits stay live mid-round (voice is cosmetic), or lock the whole section during play for calm? Leaning: voice live, only rules-touching controls locked.
3. ~~**Advanced commit model.**~~ **RESOLVED (Yan, 2026-06-02).** Advanced edits STAGE locally and commit + create a version only on an explicit **"Save changes"** action — forgiving, undo-friendly, fewer version entries. Simple-mode preset/dial changes may still apply instantly. This is now a locked decision.
4. **Card width / `--wide`.** Adopt the wider settings card for the editor, or keep 420px and let Advanced scroll? Leaning keep 420px (mobile-first), revisit after a real screenshot.

## Locked decisions

1. **Progressive disclosure is the contract.** Default view = preset cards + one chatty dial, nothing else. Advanced is a single, non-intrusive reveal. A 5-year-old finishes in one tap; depth is strictly opt-in.
2. **`roomEditor.js` is a new view module** that consumes the pure `roomConfig.js` (`PRESETS`, `resolvePreset`, `mergeConfig`, `CONFIG_CAPS`) and emits via injected callbacks. It never sends WebSocket messages or imports `app.js`.
3. **Two commit cadences:** preset tap + dial-release commit immediately; advanced edits batch behind "Save changes". Preview is always local. This is the version-spam mitigation.
4. **Everything is reversible.** Every commit appends a version; the timeline + revert make destructive-feeling actions safe. Diverged-preset re-pick hard-resets but only after history captures the prior state.
5. **No new server surface.** All writes are rung-02 `set_room_config` / `revert_config`; all reads come from the existing snapshot (`roomConfig`, `configHistory`).
6. **Stub rows, not stub editors.** Skins / Colors & Fonts / Custom Sounds appear as disabled "Coming soon" rows naming their schema sections; their real editors are later rungs.
7. **Robot-voice honesty.** Every custom line carries the `speechSynthesis`-fallback hint so the unrendered-voice behavior is a known, friendly state.
8. **Imperative fresh-build rendering** (clear `innerHTML`, append fresh nodes; nested-chevron handler guarded by `dataset.subsectionsWired`) to avoid the modal's re-open handler-stacking hazard.
