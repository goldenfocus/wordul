# Room Sandbox — Expand the Config Sections (Rung 4)

**Date:** 2026-06-02
**Status:** Draft for review
**Part of:** Room Sandbox ladder — **rung 4**. Adds the remaining `roomConfig` sections beyond `voice`, each as a new schema section + Advanced-tier editor card. Cites the canonical schema in `docs/superpowers/specs/2026-06-02-room-sandbox-00-architecture-design.md` (do not redefine it).

> **Citation rule.** The `RoomConfig` shape, `mergeConfig` precedence chain, `ConfigVersion`, the two messages (`set_room_config`/`revert_config`), the 4-step setter pattern, and `CONFIG_CAPS` are all defined in rung 00. This rung **promotes stub sections to live ones** and adds editor cards. It does not invent new merge semantics or new messages.

---

## Problem

Rung 00 fully specified `voice` and reserved five **stub** sections — `palette`, `fonts`, `rules`, `creature`, `economy` — as empty shapes (architecture-design.md lines 80-86, 164-168). Rungs 1-3 shipped the voice slice: always-speak (`pickGuessEvent`), the room override protocol, and the preset editor with its collapsed **Advanced** reveal (rung 03's "Companion & Vibe" section). So the plumbing is proven for exactly one section.

The vision asks for a **true creative playground** — skins, graphics/palette, custom sounds, rules folded in, a creature/curse skin, economy knobs — but **all behind the Advanced reveal** so the 5-year-old's simple path (pick a preset chip + one talkativeness dial) is never cluttered. Today none of those sections do anything: setting `palette` is stripped by `sanitizeRoomConfig` (rung 00 forward-compat drop), nothing reads it, no editor renders it.

The risk of doing this badly is **N bespoke sections** — each with its own merge quirk, its own sanitize branch, its own editor layout — which is exactly the flat-field sprawl rung 00 was built to kill. The job of this rung is to make adding a section **mechanical**: one schema fill-in, one sanitize entry, one apply hook, one editor card following a shared template.

## Goal

1. Establish the **repeatable per-section recipe** (schema → sanitize → client apply hook → editor card → test) so every future section is a fill-in-the-blanks change, not a design exercise.
2. Ship the first **two concrete sections in full detail** as the worked examples: **`palette`** (visual theme / skins + graphics) and **`sounds`** (custom chimes + selected sfx — a *new* additive section the vision calls out separately from voice).
3. **Scaffold the remaining sections** (`fonts`, `rules`, `creature`) with their apply hooks + editor cards, deferring `economy` to its Sacred/Tier-A rung.
4. Keep every new card **inside rung 03's Advanced sub-section** — collapsed by default, sensible defaults everywhere, simple path untouched.
5. Preserve the **default-preserving guarantee** (rung 00 locked decision #6): a room with no `palette`/`sounds`/etc. override looks and sounds byte-for-byte like its edition default.

---

## Design

### Architecture

The data flow added by rungs 00-02 is reused verbatim; this rung only adds **new sections to the override** and **new client-side apply hooks** that read them. No server logic changes beyond extending `sanitizeRoomConfig`.

```
                         (already shipped, reused)                         (NEW this rung)
  settings.js editor ── set_room_config ──► room.ts ── snapshot ──►  app.js snapshot handler
  (Advanced cards)        (rung 02)         sanitizeRoomConfig             │
                                            (+ new section branches)       ├─► applyRoomConfig(snapshot.roomConfig)
                                                                           │     ├─ applyPalette()  → CSS custom props
  public/roomConfig.js  ── mergeConfig() ──────────────────────────────► │     ├─ applyFonts()    → --font-* vars
  (rung 00, reused; new sanitize-mirror helpers per section)              │     ├─ resolveSound()  → chime/sfx lookup
                                                                          │     └─ applyRules()    → (delegates to existing set_* path)
                                                                          └─► companionReact (voice, unchanged)
```

**Server stays dumb storage + fan-out** (rung 00 locked decision #2). The DO never resolves palette against an edition; it stores the delta, sanitizes, versions, broadcasts. **Client resolves and applies** via a new `applyRoomConfig` entry point that runs the per-section apply hooks after `mergeConfig`.

**The one new client seam: `applyRoomConfig(effective)`** in `public/app.js` (or a thin `public/roomTheme.js` if app.js is crowded). It is the visual counterpart to `companionReact` for voice: called from the snapshot handler whenever `roomConfig` changes, it walks the present sections and calls each section's apply hook. Adding a section = adding one `if (effective.X) applyX(effective.X)` line + the hook.

### The repeatable per-section recipe (the deliverable that matters)

Every new section is exactly these five edits, no more:

| Step | File | What |
|------|------|------|
| 1. **Schema** | `src/types.ts` | Fill in the already-reserved stub type (e.g. `PaletteConfig`). Shape only — no new top-level key needed; rung 00 already reserved the key. |
| 2. **Sanitize** | `src/roomConfig.ts` (`sanitizeRoomConfig`) | Add one branch: whitelist allowed keys, clamp/truncate values, drop unknowns. Mirrors the existing `voice` branch. |
| 3. **Apply hook** | `public/app.js` (or `roomTheme.js`) | A pure-ish `applyX(cfg)` that writes the effective values into the live DOM/runtime. Idempotent; an empty/absent section must restore the edition default. |
| 4. **Editor card** | `public/settings.js` | One Advanced sub-card following the shared `renderConfigCard` template (below). Reads current effective value, emits `onRoomConfigChange({ X: {...} })`. |
| 5. **Test** | `*.spec.js` | Sanitize clamp/drop suite + the section's slice of the default-preserving regression (`mergeConfig(ed, {X:undefined})` ≡ `ed`). |

Merge behavior is **free** — `mergeConfig` already falls through unknown-to-it sections (rung 00 merge rule #1: sections fall through independently; objects shallow-merge one level). A new section needs **no** `mergeConfig` change unless it wants a non-default merge (e.g. append-vs-replace like voice banks). `palette` and `sounds` both use the default shallow-merge, so `mergeConfig` is untouched this rung.

### Section 1 — `palette` (visual theme / skins + graphics) — FULL DETAIL

**Schema** (fills rung 00's `PaletteConfig = { vars?: Record<string,string> }`, line 164):

```ts
// src/types.ts — promote the stub, keep the shape rung 00 reserved
export type PaletteConfig = {
  /** CSS custom-prop overrides, keyed by the SAME short names edition.js already maps.
   *  e.g. { green: "#1db954", accent: "#ffd166" }. Unknown keys dropped by sanitize. */
  vars?: Record<string, string>;
};
```

**Why this shape works with zero new plumbing:** `public/edition.js` `applyEdition` (lines 100-110) already iterates a fixed map of short palette names → CSS vars (`bg→--bg`, `green→--green`, `accent→--accent`, … the `PALETTE_VARS` object at lines 94-98) and calls `html.style.setProperty(cssVar, value)`. The override applies through the **identical mechanism, after** `applyEdition`, so room palette wins over edition palette without touching `applyEdition`.

**Apply hook** — `applyPalette(cfg)` in `public/app.js`:
- For each `k` in `cfg.vars` that exists in edition.js's exported `PALETTE_VARS` map → `document.documentElement.style.setProperty(PALETTE_VARS[k], cfg.vars[k])`.
- **Restore-on-absent:** before applying overrides, re-run `applyEdition(activeEditionId)` to reset every var to the edition default, *then* layer the override. This guarantees removing a palette override (or reverting) snaps back to the edition default — the default-preserving guarantee for color.
- Export `PALETTE_VARS` from `edition.js` (it is currently module-private) so both `applyEdition` and `applyPalette` share the one source of truth for the allowed key set. This also becomes the sanitize whitelist (single source).

**Sanitize** — `sanitizeRoomConfig` palette branch:
- Keep only keys present in `PALETTE_VARS`.
- Each value: must match a CSS-color regex (`#rgb`/`#rrggbb`/`#rrggbbaa`/`rgb()`/`hsl()` and the small set of named tokens we accept) — reject anything else (defends against `url(...)` / CSS injection through a custom prop). Truncate to a small max length (e.g. 32 chars).
- Cap total vars to the size of `PALETTE_VARS` (no way to exceed it after whitelisting).

**Editor card** — Advanced sub-card "Colors & Skin": a compact grid of labeled swatches (one per `PALETTE_VARS` key worth exposing — green/yellow/accent/bg/border as the "graphics that matter" set; full set behind a further "All colors" reveal to honor progressive disclosure). Each swatch is `<input type="color">` whose `change` emits `onRoomConfigChange({ palette: { vars: { [k]: value } } })`. Live preview is automatic: the apply hook runs on the resulting snapshot, repainting the board instantly. A "Reset colors" ghost button emits `{ palette: { vars: {} } }` (cleared → edition default via restore-on-absent).

> **"Graphics" beyond color** (background images, tile textures, custom board art) is a richer surface — it implies asset upload/hosting and a `bg-image`/texture sub-shape. That is **deferred** (see Non-goals: theming-graphics). Rung 4's palette covers the CSS-var color skin, which is 90% of the visual identity for zero new infra.

### Section 2 — `sounds` (custom chimes + selected sfx) — FULL DETAIL

This is a **new top-level section** the vision lists separately from voice ("CUSTOM SOUNDS — chimes + uploaded/selected sfx"). It is **additive** per rung 00 locked decision #1: a new optional key in `RoomConfig`, never a rewrite. It must be **added to the canonical schema in rung 00 first** (the citation rule: extend the keystone, then implement) — this rung's first action is a one-line schema addition to architecture-design.md:

```ts
// ADD to RoomConfig in 2026-06-02-room-sandbox-00-architecture-design.md (stub list):
  sounds?: SoundConfig;        // rung 4: chime + per-event sfx selection
```

**Schema:**

```ts
// src/types.ts
export type SoundEvent = "green" | "win" | "mistake"; // the three audible beats today
export type SoundId =
  | "glass" | "shock" | "buzz"       // existing WebAudio noise presets (app.js playNoise)
  | "chime" | "soft" | "ascend"      // existing chime variants (app.js)
  | "none";                          // mute this event
export type SoundConfig = {
  /** Per-event sound selection, chosen from the built-in preset palette.
   *  Missing event = edition default. "none" = silence that event. */
  sfx?: Partial<Record<SoundEvent, SoundId>>;
  /** Master sfx volume for this room, 0..1. Absent = 1 (edition default). */
  volume?: number;
};
```

**Why presets, not uploads, this rung:** today every sound is **synthesized via Web Audio** (`playChime`/`playNoise` in `app.js` ~lines 1864-1925; edition `effects.mistake.sound: "glass"|"shock"|"buzz"`; greens use an ascending chime). There are **no audio asset files** in `public/`. So "selected sfx" from the built-in preset set is the YAGNI-correct first cut: zero hosting, zero upload pipeline, instant. **Uploaded** sfx (the vision's other half) needs the same R2/render infra as custom voice lines ("Part C") and is deferred (Non-goals: sounds-upload), parallel to how voice defers custom-clip rendering.

**Apply hook** — `resolveSound(event)` lookup (not a DOM mutation — sound is event-driven):
- The existing call sites that play sound (`celebrateGreens` green chime, `handleGameOver` win chime, the mistake `playNoise(cfg.sound)` at app.js ~1928) currently read the **edition's** sound directly. Change each to first consult `effectiveRoomConfig.sounds?.sfx?.[event]`; if present and not `"none"`, play that preset; if `"none"`, skip; if absent, fall through to the edition default. Apply `sounds.volume` as the gain multiplier in `playChime`/`playNoise`.
- This mirrors voice exactly: the room override governs *which* sound / *whether* it plays; the synthesis engine is unchanged, just handed a different preset id + gain.

**Sanitize** — `sounds` branch: `sfx` keys whitelisted to `SoundEvent`; values whitelisted to the `SoundId` union (drop unknown); `volume` clamped 0..1. Unknown keys dropped.

**Editor card** — Advanced sub-card "Sounds": three rows (Greens / Win / Mistake), each a small `<select>` of the `SoundId` presets with a ▶︎ preview button that plays the synth preview on tap (reuses `playChime`/`playNoise`). A volume slider at the top emits `{ sounds: { volume } }`. Each select change emits `{ sounds: { sfx: { [event]: id } } }`. Live and forgiving — picking "none" is a valid, reversible "mute this beat."

### Sections 3-5 — scaffolded (apply hook + card stubbed, shapes from rung 00)

These get the **recipe applied lightly** — type promoted, a TODO sanitize branch, an editor card that is present but minimal — so the additive pattern is visibly extended without over-building (YAGNI). Full detail is each one's own follow-on if it earns priority.

- **`fonts`** (`FontConfig = { display?, ui? }`, rung 00 line 165). Apply hook trivially mirrors palette: `applyFonts` sets `--font-display`/`--font-body` (the same vars `applyEdition` writes at edition.js lines 108-109), restore-on-absent via `applyEdition`. Sanitize whitelists to a curated allowed-font-stack list (no arbitrary `font-family` strings — same injection defense as palette). Editor card: a small font-pair picker. **Bundled with palette** in the editor under one "Colors & Skin" card since they are the same visual-theme beat. Ship-ready but listed here, not detailed, to keep the rung focused on the two worked examples.
- **`rules`** (`RulesConfig = { wordLength?, maxGuesses?, mode? }`, rung 00 line 166). **Special: this section migrates the legacy flat fields** (`wordLength`/`maxGuesses`/`mode` that today have their own `set_length`/`set_mode` messages). The apply hook **delegates to the existing setters' effect** rather than duplicating game logic, and the **mid-game guard** (rung 00 `onSetRoomConfig` step 1: rules changes block when `phase === "playing"`) is the reason rung 00 made the guard per-section. The clean migration (collapse `set_length`/`set_mode` into `set_room_config.rules`) is a **deliberate, separate effort** — touching live game state — and is deferred to its own rung (Non-goals: rules-migration). This rung only **reserves the editor card placement** and confirms the guard hook.
- **`creature`** (`CreatureConfig = { skin? }`, rung 00 line 167). The companion-creature / curse skin — ties to the "default theme + curse" direction. Apply hook swaps the creature sprite/skin id; depends on the Living Wordulers body work (`2026-06-01-living-wordulers-l0-the-body-design.md`). Scaffolded shape only; full hook deferred to a skins rung (Non-goals: creature-skins).

### Editor: the shared `renderConfigCard` template

Rung 03 shipped the "Companion & Vibe" section with preset chips + dial + a collapsed Advanced sub-section. This rung adds **sibling Advanced sub-cards inside that same Advanced reveal**, all built from one helper so they are visually and behaviorally uniform (settings-ui exploration extension point #3 — the `renderEditionPicker` imperative-mount pattern):

```
renderConfigCard(rootEl, {
  title,                 // "Colors & Skin", "Sounds"
  controls,             // array of {label, render(node, value, emit)} — swatch, select, slider…
  value,                // current effective slice for this section
  onChange,             // → onRoomConfigChange({ [section]: patch })
})
```

- Each card mounts into a `.setting-row.stack` inside the Advanced `.settings-subsection-body` (the nested-chevron CSS pair rung 03 added).
- Cards are **collapsed by default** under the Advanced chevron — the simple path (preset chip + talkativeness) is the only thing visible until a user opens Advanced. Progressive disclosure (rung 00 locked decision #9) preserved.
- Width: if the swatch grid feels cramped at the 420px modal, apply the `.settings-card--wide` modifier noted in settings-ui exploration extension point #7 (mobile-safe via the existing `calc(100vw-32px)` guard).
- Every change flows through the **existing** `onRoomConfigChange → send({ type: "set_room_config", config })` wired in rung 02. No new message, no new send path.

### Data flow (end to end, one section)

1. User opens Settings → Advanced → "Colors & Skin", taps a green swatch.
2. `<input type=color>` change → `onRoomConfigChange({ palette: { vars: { green: "#1db954" } } })`.
3. → `send({ type: "set_room_config", config: { palette: { vars: { green: "#1db954" } } } })` (rung 02 path).
4. Room DO `onSetRoomConfig`: `sanitizeRoomConfig` keeps `palette.vars.green` (whitelisted key, valid color) → shallow-merge over `state.roomConfig` → append `ConfigVersion` → `pushSystem` + `persistAndBroadcast` (rung 00 4-step pattern).
5. Snapshot arrives at every client → `app.js` snapshot handler → `mergeConfig(editionDefault, snapshot.roomConfig)` → `applyRoomConfig(effective)` → `applyPalette({ vars: { green: "#1db954" } })` → `setProperty("--green", ...)` → board repaints live for everyone.
6. Revert via the rung-03/04 history UI restores a prior `config`; `applyRoomConfig` re-runs; restore-on-absent snaps unset vars back to edition default.

### Error handling (extends rung 00's section)

- **Bad color / font value:** dropped by sanitize (regex/whitelist); never reaches the DOM (no CSS injection).
- **Unknown palette key / sound id / sound event:** dropped silently (rung 00 forward-compat behavior).
- **`volume` out of range:** clamped 0..1.
- **Removed/empty section:** apply hook's restore-on-absent re-applies the edition default — never leaves a stale override painted.
- **Section present but apply hook not yet shipped** (e.g. `creature` set by a future client against this client): `applyRoomConfig` skips sections with no registered hook — no error, graceful no-op (forward-compat both directions).

### Testing approach

- **Sanitize suites** (`src/roomConfig` Vitest): palette key-whitelist + color-regex reject (incl. a `url(...)` injection attempt dropped); sounds id/event whitelist + `volume` clamp; fonts allowed-stack whitelist.
- **Apply-hook idempotence / restore** (where pure-extractable): `applyPalette` then empty `applyPalette` restores edition vars; this is the per-section slice of the **default-preserving regression** (rung 00 locked #6). DOM-touching parts verified by manual smoke (apply hooks read `document.documentElement`, so unit coverage targets the pure key-resolution; DOM write is a one-liner).
- **mergeConfig fall-through** (already in rung 00's suite): add a case asserting an unknown-to-merge section (`palette`, `sounds`) falls through untouched and does not perturb `voice` — proves the additive guarantee for the new sections.
- **No new merge logic ⇒ no new merge tests** beyond the fall-through cases (palette/sounds use default shallow-merge).

---

## Non-goals (deferred, with the owning rung)

- **theming-graphics** — background images, tile textures, custom board art, uploaded image assets. Needs R2 hosting + an asset reference sub-shape. Rung 4 ships CSS-var **color** skins only. → a dedicated theming-graphics rung.
- **sounds-upload** — user-uploaded / externally-sourced sfx clips. Needs the same hosting+render infra as custom voice clips ("Part C"). Rung 4 ships **built-in preset selection** only. → a sounds-upload rung (parallel to golden-voice rendering).
- **rules-migration** — collapsing the legacy `set_length`/`set_mode`/`set_edition` flat messages into `roomConfig.rules`. Touches live game state and the lobby pickers; deliberately its own effort. Rung 4 only reserves the card slot + confirms the per-section mid-game guard. → a rules-migration rung.
- **creature-skins** — the full companion-creature / curse skin hook. Depends on Living Wordulers body work (`2026-06-01-living-wordulers-l0-the-body-design.md`). Rung 4 scaffolds the `creature` shape only. → a creature-skins rung.
- **economy** — gold knobs. **Sacred / Tier A** (rung 00 line 168, locked). Explicitly **not** touched here; needs its own gated rung with the economy review gauntlet. → the economy rung.
- **Personal defaults / session layers** — the `userDefault`/`session` merge layers stay reserved (rung 00 Non-goals; rung 06 owns personal defaults).
- **Version history UI** — the `configHistory` browse/revert timeline is owned by **rung 03**; this rung relies on it existing for reverting palette/sound changes but does not build it.

## Open questions

1. **Palette key surface** — expose the curated 5 (green/yellow/accent/bg/border) by default with "All colors" behind a further reveal, or all ~14 `PALETTE_VARS` keys flat? Leaning curated-5 default for the 5-year-old, full set one tap deeper. Flag for Yan's taste call.
2. **Fonts: bundle with palette or own card?** Leaning bundled into one "Colors & Skin" card (same visual-theme beat, fewer chevrons). Confirm.
3. **Sound preview on mobile** — the ▶︎ preview needs the audio-unlock gesture (app.js `unlockAudio`); the preview tap *is* a gesture so it should work, but worth a smoke check. Not blocking.
4. **Color injection allow-list breadth** — accept `rgb()`/`hsl()`/named tokens, or hex-only for the tightest defense? Leaning hex + `rgb()`/`rgba()`; reject the rest. Confirm the regex strictness.

## Locked decisions

1. **Five-step recipe is the contract.** Schema fill-in → sanitize branch → apply hook → editor card → test. Adding a section never invents new merge semantics or messages.
2. **No new ClientMessage.** All sections flow through the existing `set_room_config` / `revert_config` (rung 00 locked #3). `sounds` is added to the canonical `RoomConfig` in rung 00 first (citation rule), then implemented.
3. **One new client seam: `applyRoomConfig(effective)`** — the visual/audio counterpart to `companionReact`, called from the snapshot handler; walks present sections, calls each apply hook; skips sections with no hook (forward-compat).
4. **Restore-on-absent is mandatory per apply hook.** Re-apply the edition default before layering the override so removing/reverting a section snaps back — the default-preserving guarantee (rung 00 locked #6) extended to color/font/sound.
5. **Palette & fonts apply through the existing `applyEdition` var mechanism** (`PALETTE_VARS`, `--font-*`), exported from `edition.js` as the single source of truth and the sanitize whitelist. Room override wins by applying after edition.
6. **Sounds = built-in WebAudio presets this rung.** No asset files, no upload. `"none"` mutes an event; `volume` is a room gain. Uploaded sfx deferred.
7. **All new cards live inside rung 03's Advanced reveal**, collapsed by default. The simple path (preset chip + talkativeness dial) is untouched. Progressive disclosure (rung 00 locked #9) is non-negotiable.
8. **No CSS injection.** Palette colors pass a color regex; fonts pass an allowed-stack whitelist; arbitrary strings are dropped by sanitize.
9. **Economy stays out.** Sacred / Tier A — its own gated rung.

---

## Dependency note — what this rung consumes from earlier rungs

| From | Consumes |
|------|----------|
| **rung 00** | the `RoomConfig` schema (stub sections promoted), `mergeConfig` (sections fall through free), `sanitizeRoomConfig` (extended), `ConfigVersion`/caps, the 4-step setter pattern, the two messages, locked decisions #1/#2/#6/#9 |
| **rung 02** | `set_room_config`/`revert_config` protocol + DO persist/broadcast + `onRoomConfigChange → send` wiring |
| **rung 03** | the "Companion & Vibe" settings section + the collapsed **Advanced** sub-section + nested-chevron CSS — new cards mount here |
| **rung 03** | `configHistory` + revert timeline UI — relied upon for reverting palette/sound changes (not built here) |
| **edition framework** | `applyEdition`, `PALETTE_VARS`, `--font-*` vars (edition.js), `playChime`/`playNoise`/`effects.*.sound` (app.js) — reused as the apply mechanisms |
