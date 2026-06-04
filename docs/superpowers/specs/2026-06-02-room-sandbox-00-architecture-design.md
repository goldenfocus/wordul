# Room Sandbox — Architecture & roomConfig Schema (Rung 00, the Keystone)

**Date:** 2026-06-02
**Status:** Draft for review
**Part of:** Room Sandbox ladder — **rung 00**. This is the canonical contract every other rung cites. It defines the `roomConfig` override schema, merge semantics, versioning, persistence/protocol, and the pure/side-effect split. It does **not** ship a feature by itself; rungs 01+ implement slices of it.

> **Citation rule.** Other specs MUST reference this doc by name and **not redefine** `RoomConfig`, the merge chain, or the version record. If a rung needs a new section (palette, rules, …), it extends the schema here first, then implements.

---

## Problem

Today a room carries a handful of flat, single-purpose config fields (`wordLength`, `maxGuesses`, `mode`, `edition`), each with its own `set_*` ClientMessage, its own seed-on-hello path, and its own picker. Voice is globally hardcoded to Yang (`VOICE_EDITION = "yang"`), the companion only speaks on yang + greens or zero-discovery wrongs (`app.js` guess-reaction branch), and there is **no** per-room customization, no version history, and no personal defaults.

The Room Sandbox vision needs the opposite: one **open, versioned, infinitely-configurable** space where any present player can tune voice (and later palette, fonts, rules, creature, economy), where a 5-year-old taps one **preset** and a power user edits raw config, and where every change is an append-only version you can browse and revert. Adding a new tunable surface must never require a new top-level field + message + picker + seed path again.

## Goal

Lock **one extensible `roomConfig` override object** with named, additive sections; **one** `set_room_config` message (plus `revert_config`); **one** merge contract; and **one** append-only version log — all mirroring the existing `set_mode`/`set_edition` persist-and-broadcast pattern and the existing kindness model. Start the **voice** section fully specified (it's the only consumer that exists). Stub the rest. Define **presets** as named partial-config bundles so the simple path is "pick a vibe + maybe one dial" and everything else has a safe default. Keep today's global Yang voice working byte-for-byte when no override is set.

---

## Design

### Architecture

```
                       (pure, testable)                         (side-effect glue)
public/roomConfig.js  ──┐                                    ┌── public/edition.js  (companionReact merges override)
  mergeConfig()         │                                    │── public/app.js      (pickGuessEvent call site, send/recv)
  pickGuessEvent()      ├── consumed by ───────────────────► │── public/settings.js (editor section, preset chips)
  resolvePreset()       │                                    │
  diffConfig()          │                                    └── src/room.ts        (onSetRoomConfig / onRevertConfig
PRESETS registry      ──┘                                                              + persistAndBroadcast)
                                                             src/types.ts  (RoomConfig, ConfigVersion, RoomSnapshot+2,
                                                                            ClientMessage +2)
```

- **Server is dumb storage + fan-out.** The Room DO stores the **override delta only**, never resolves it against edition defaults. It validates/sanitizes, appends a version, persists the single `state` blob, and rebroadcasts — exactly like `onSetEdition`.
- **Client resolves.** The full effective config is assembled client-side by `mergeConfig(editionDefault, roomOverride, userDefault, session)`. This keeps the DO lean and editions purely client-side (the DO never imports an edition).
- **Voice stays global.** `VOICE_EDITION = "yang"` is unchanged in rung 00. The override merges over the **active edition's** `companion` block to decide *what is said / how often / in what priority*; the **clip playback** edition stays Yang until a later rung opts a room into a different voice. (See Non-goals.)

### Components / files (exact paths)

**New pure module — `public/roomConfig.js`** (no DOM, no localStorage, no imports from app; Vitest-importable via the `/`-alias in `vitest.config.ts`):
- `mergeConfig(...layers: RoomConfig[]) → RoomConfig` — the precedence chain (see Merge semantics).
- `pickGuessEvent(ng, ny, reusedDeadLetter) → { event, ctx }` — the always-speak priority resolver (moved out of `app.js` lines 1007-1012 so it's unit-testable).
- `resolvePreset(presetId) → RoomConfig` — expands a named preset to a partial config.
- `diffConfig(prev, next) → Partial<RoomConfig>` — shallow per-section diff for version records (optional optimization; v0 may store full snapshots).
- `PRESETS` — the named-bundle registry (object literal).
- `CONFIG_CAPS` — limit constants (history length, line-bank size, line length).

**`src/types.ts`** — add `RoomConfig`, `ConfigVersion`; add two fields to `RoomSnapshot`; add two `ClientMessage` variants; add optional `roomConfig` to the `hello` message.

**`src/room.ts`** — constructor migration shim (backfill `roomConfig` / `configHistory`); `onSetRoomConfig`; `onRevertConfig`; two `case`s in the `handle` switch; `sanitizeRoomConfig()` (extends the `sanitizeEdition` strip/truncate pattern); `configHistory` excluded from the hot broadcast.

**`public/edition.js`** — `companionReact` reads `mergeConfig(editionReactDefault, snapshot.roomConfig?.voice)` instead of `ed.companion.react` directly. One merge call; the pure scoring functions in `companion.js` are unchanged (they already accept `cfg` as a plain param).

**`public/app.js`** — replace the yang-only guess-reaction branch with `pickGuessEvent(...)`; receive `roomConfig` in the snapshot handler; wire the editor's `onRoomConfigChange → send({ type: 'set_room_config', config })`.

**`public/settings.js`** — new chevron section "Companion & Vibe": preset chips (the simple path) + a talkativeness dial + a collapsed "Advanced" sub-section (per-category toggles, custom lines, priority, version history). `wireSectionToggles` already handles new `.settings-section-head` elements; advanced needs the nested-chevron CSS pair noted in the settings-ui exploration.

### The roomConfig override schema

> This is **the** schema. It is the override delta — every field is optional; absent = fall through to the edition default. A `RoomConfig` of `{}` means "pure edition default" (today's behavior).

```ts
// ── src/types.ts (and mirrored as the shape public/roomConfig.js operates on) ──

/** The single extensible override object. Sections are ADDITIVE: a new section
 *  is a new optional top-level key and never forces a rewrite of existing ones. */
export type RoomConfig = {
  /** Which preset this config was last derived from (provenance for the editor).
   *  Advanced edits diverge from it; `preset` stays as the origin label. */
  preset?: PresetId;

  /** FULLY SPECIFIED in rung 00 — the only live consumer. */
  voice?: VoiceConfig;

  // ── STUBS (shape reserved; expanded by later rungs, not before) ──
  palette?: PaletteConfig;     // rung 04: theming — CSS custom-prop overrides
  fonts?: FontConfig;          // rung 04: theming — display/ui font stacks
  sounds?: SoundConfig;        // rung 04: chime + per-event sfx selection (built-in WebAudio presets)
  rules?: RulesConfig;         // rung: rules    — wordLength/maxGuesses/mode (migrates the legacy flat fields)
  creature?: CreatureConfig;   // rung: skins    — companion creature / curse skin
  economy?: EconomyConfig;     // rung: economy  — gold knobs (Sacred: Tier A, gated)
};

// ─────────────────────────────────────────────────────────────────────────────
// VOICE — fully specified
// ─────────────────────────────────────────────────────────────────────────────

export type GuessEvent = "greens" | "progress" | "wrong"; // win/loss/invalid are always-speak, not budgeted
export type LineEvent  = GuessEvent | "win" | "loss" | "invalid" | "idle";

export type VoiceConfig = {
  /** Talkativeness. The ONE dial the simple path may expose.
   *  0 = silent routine, 1 = always. Maps to companion.js shouldSpeak's voiceBudget.routine.
   *  Big moments (greens>=2, win, loss, invalid) ignore the budget and always speak. */
  talkativeness?: number;        // 0..1, default inherits edition (yang routine = 0.33)

  /** Per-category enable toggles. Missing = enabled (fall through). false = muted entirely. */
  events?: Partial<Record<GuessEvent, boolean>>;

  /** Priority order for the guess-reaction resolver. First matching event wins.
   *  Default (locked) = ["greens", "progress", "wrong"]. Reordering lets a room, e.g.,
   *  prefer scolding sloppiness over celebrating a lone yellow. Unknown/missing → default. */
  priority?: GuessEvent[];

  /** Threshold knobs forwarded verbatim into companion.js scoring (resolveTier/scoreGreens/etc).
   *  Shape = the SHIPPED `companion.react` object (see smart-companion-engine spec). Override merges
   *  OVER the edition default; this is how a room retunes genius/clutch/sloppy without touching code.
   *  voiceBudget.progress (default 1.0 = always-speak, honoring "never silent") is configurable;
   *  the room's talkativeness dial can lower it. voiceBudget.routine governs wrong/idle as before. */
  react?: ReactConfig;           // { voiceBudget?: { routine, progress }, win?, greens?, mistake? } — cite smart-companion-engine

  /** Additive line banks. EXTRA lines added on top of the edition default banks (see Merge semantics:
   *  banks APPEND by default). To REPLACE a bank wholesale, wrap it: { replace: [...] }. */
  lines?: VoiceLineBanks;

  /** Future: opt this room into a non-Yang rendered voice. Out of scope rung 00 (VOICE_EDITION pinned). */
  voiceEdition?: string;
};

/** Line is plain text; `{answer}` is the only template token (split-voice loss reveal). */
export type Bank = string[] | { replace: string[] };

export type VoiceLineBanks = {
  invalid?: Bank;
  progress?: Bank;
  loss?: Bank;
  idle?: Bank;
  wrong?: { normal?: Bank; sloppy?: Bank };
  win?:   { genius?: Bank; clutch?: Bank; solid?: Bank };
  greens?: { "2"?: Bank; "3"?: Bank; "4"?: Bank; "5"?: Bank };
};

// ReactConfig is NOT redefined here — it is the shipped `companion.react` shape.
// See: docs/superpowers/specs/2026-06-02-smart-companion-engine-design.md
export type ReactConfig = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// PRESETS — named partial-config bundles (the simple path)
// ─────────────────────────────────────────────────────────────────────────────

export type PresetId = "chatty-coach" | "quiet" | "gremlin" | "default";

// PRESETS lives in public/roomConfig.js. A preset is JUST a partial RoomConfig.
// Picking one calls set_room_config with resolvePreset(id) as the payload.
export const PRESETS: Record<PresetId, RoomConfig> = {
  "default":      { preset: "default" },                          // pure edition default
  "chatty-coach": { preset: "chatty-coach",
                    voice: { talkativeness: 1.0,
                             priority: ["greens", "progress", "wrong"] } },
  "quiet":        { preset: "quiet",
                    voice: { talkativeness: 0.0,
                             events: { progress: false, wrong: false } } },
  "gremlin":      { preset: "gremlin",
                    voice: { talkativeness: 0.85,
                             priority: ["wrong", "greens", "progress"],
                             lines: { wrong: { sloppy: ["that letter is DEAD, friend"] } } } },
};

// ─────────────────────────────────────────────────────────────────────────────
// STUB SECTION SHAPES (reserved; do not implement before the owning rung)
// ─────────────────────────────────────────────────────────────────────────────
export type PaletteConfig  = { vars?: Record<string, string> };          // CSS custom props
export type FontConfig     = { display?: string; ui?: string };
export type RulesConfig    = { wordLength?: number; maxGuesses?: number; mode?: string };
export type CreatureConfig = { skin?: string };
export type EconomyConfig  = Record<string, number>;                      // Sacred / Tier A
// SoundConfig — built-in WebAudio preset selection per audible event (rung 04 promotes/details).
export type SoundConfig    = { sfx?: Partial<Record<string, string>>; volume?: number };

// ─────────────────────────────────────────────────────────────────────────────
// VERSIONING
// ─────────────────────────────────────────────────────────────────────────────
export type ConfigVersion = {
  v: number;            // monotone 1-based counter (= position in configHistory)
  at: number;           // Date.now()
  by: string;           // username (kindness model — whoever sent it)
  parent: number | null;// the v this was edited from (revert sets parent = the reverted-to v)
  config: RoomConfig;   // full override snapshot at this version (v0: snapshot, not diff)
  label?: string;       // optional user label ("hype mode") or auto ("reverted to v3")
};
```

### Merge semantics & precedence chain

**Precedence (lowest → highest), resolved client-side by `mergeConfig`:**

```
editionDefault  ←  roomOverride  ←  userDefault  ←  session
   (the active edition's companion block, the always-on baseline)
   (snapshot.roomConfig — what THIS room set)
   (rung: personal-defaults — see below; NOT in rung 00, layer reserved)
   (rung: session — ephemeral "just for me right now" tweaks; reserved)
```

**Personal-default application (LOCKED — rung 06 decision):** When you join a room, you see the HOST's vibe (room config) by default. Each guest gets a personal **"switch to my vibe"** opt-in toggle that locally applies their own personal default (a client-side/session override of the personal-experience parts — e.g. companion voice/chattiness — without changing the room for others). In practice: the `userDefault` layer is realized **through the seed path for rooms you own** and held out of the guest merge unless the guest has explicitly toggled "use my vibe" on. The call site decides whether to pass the layer, not `mergeConfig` itself.

Rung 00 implements only the first two layers. `mergeConfig` accepts N layers so adding `userDefault`/`session` later is a call-site change, not a rewrite.

**Per-section merge rules (LOCKED):**

1. **Sections fall through independently.** A missing top-level section (`voice` absent) → use the lower layer entirely. Sections never cross-contaminate.
2. **Objects shallow-merge per section, one level deep.** `voice.talkativeness`, `voice.events`, `voice.priority`, `voice.react` each replace the same key in the lower layer if present; absent keys fall through. (Rationale: simplest predictable contract; no accidental deep-clobber.)
   - `voice.react` is the one exception that **deep-merges** by sub-key (`voiceBudget`/`win`/`greens`/`mistake` — every sub-key of the shipped `companion.react`, including `voiceBudget.progress` and `voiceBudget.routine`), because it mirrors the shipped nested `companion.react` and rooms typically retune one tier. Documented exception, not a general rule.
3. **`events` and `priority` REPLACE.** A provided `events` object replaces the lower `events` map key-by-key (shallow); `priority` array replaces wholesale. Absent → fall through (default priority `["greens","progress","wrong"]`).
4. **Line banks APPEND by default.** `voice.lines.wrong.sloppy: [...]` adds those lines on top of the edition's sloppy bank (round-robin then draws from the union). This is the "additive overrides/extras" the vision asks for.
   - To **replace** a bank wholesale, wrap it: `{ replace: ["only line"] }`. The merger detects the `replace` wrapper and discards the lower layer for that leaf bank.
   - Caps (see below) apply to the **merged** bank, not per layer.
5. **`preset` carries the highest non-default layer's value** (provenance). Editing advanced fields does **not** clear `preset` — it stays as the origin so the editor can show "based on Gremlin (edited)".

**Default-preserving guarantee:** `mergeConfig(editionDefault, {})` ≡ `editionDefault`. With no room override, `companionReact` behaves byte-for-byte as today (Yang global voice, shipped budgets/banks). This is the regression contract and MUST have a test.

### The always-speak priority resolver (`pickGuessEvent`)

Pure function, replaces the `app.js` lines 1007-1012 yang-only gate. Walks the (merged) `voice.priority`, skipping disabled events, returning the first match:

```
for event in priority (default ["greens","progress","wrong"]):
  if voice.events[event] === false: continue
  greens   → if ng >= 2: return { event:"greens",   ctx:{ count: ng } }
  progress → if ng === 1 || ny >= 1: return { event:"progress", ctx:{} }
  wrong    → return { event:"wrong", ctx:{ reusedDeadLetter } }   // always matches (terminal)
fallback → { event:"wrong", ctx:{ reusedDeadLetter } }
```

`ng`, `ny`, `reusedDeadLetter` are already in scope at the call site (`app.js` lines 922-923 + `wasted.letters.length`). Greens confetti stays Yang-only and cosmetic (called separately in `celebrateGreens`); the **voice** path is global. Tier resolution (genius/sloppy/greens-count) stays in `companion.js` unchanged. A new **`progress`** bank must be added to `yang.js` (and graceful-empty for other editions — missing bank → silent for that edition until populated).

### Versioning model

- **Storage:** `RoomSnapshot.configHistory: ConfigVersion[]`, persisted inside the single `state` blob in the Room DO (same place as everything else). **Excluded from the broadcast snapshot** (`snapshotFor` strips it) to keep the hot path lean; delivered on demand via a `get_config_history` request (reserved — the editor's history view; v0 may simply include it since caps keep it small).
- **Append on every `set_room_config` and `revert_config`.** Each entry is a full override snapshot (v0 — snapshots are tiny because they're deltas, not resolved configs; `diffConfig` is an available optimization but not required).
- **Revert(v):** set `state.roomConfig = configHistory[v-1].config`, then **append a new version** with `parent: v` and `label: "reverted to v{v}"`. History is never rewritten — revert is forward-only. This makes it a true audit trail and undoable.
- **Caps (LOCKED, in `CONFIG_CAPS`):** `historyMax = 50` (oldest dropped, FIFO); `bankMax = 24` lines per leaf bank (post-merge); `lineMax = 140` chars per line. Caps protect the single-blob write path (risk #1) and the broadcast size.
- **Not transactional.** A crash between mutate and `storage.put` can lose the latest entry (Room DO writes the whole blob; not append-only at the storage layer). Acceptable for config history — losing one version is not catastrophic. Documented, not fixed.

### Persistence + protocol

New `ClientMessage` variants (mirror `set_edition`/`set_mode` exactly):

```ts
| { type: "set_room_config"; config: RoomConfig; label?: string }
| { type: "revert_config";   v: number }
// hello gains an optional seed:
| { type: "hello"; username: string; wordLength?: number; mode?: RoomMode;
    edition?: string; roomConfig?: RoomConfig }
```

**`onSetRoomConfig(ws, config, label)`** — the 4-step shape used by every existing setter:
1. **Guard.** Voice-only changes allowed any time (cosmetic). If the payload touches a **rules** section (future) → block mid-game (`phase === "playing"`), mirroring `onSetEdition`. Per-section guard, not a blanket phase check.
2. **Validate + merge.** `sanitizeRoomConfig(config)` (strip unknown keys, truncate strings to `lineMax`, clamp bank arrays to `bankMax`, clamp `talkativeness` to 0..1) → shallow-merge per section over `state.roomConfig` (the same shallow contract `mergeConfig` uses; server merges deltas only).
3. **Append version.** Push a `ConfigVersion` (`v = configHistory.length + 1`, `by = username`, `parent = previous v or null`, `config = state.roomConfig`, `label`); FIFO-cap to `historyMax`.
4. **`pushSystem(...)` + `await persistAndBroadcast()`** — chat note ("Yang set the room vibe to Gremlin") + snapshot fan-out.

**`onRevertConfig(ws, v)`** — find `configHistory[v-1]`, set `state.roomConfig`, append a new version (`parent: v`, auto-label), persist+broadcast.

**Kindness model (LOCKED):** any connected player may send both messages (no owner gate), identical to `set_edition`/`rename` today. Owner is bookkeeping only. `by` records who. Abuse mitigation (owner-lock) follows the existing `username === state.owner` pattern if ever needed — out of scope.

**Seeding:** `onHello` accepts `roomConfig` and applies it only when `phase === "lobby" && round === 0 && username === state.owner` — same gate as edition/mode/length. This is the seam personal-defaults (later rung) flows through.

**Migration shim (constructor `blockConcurrencyWhile`):**
```ts
if (!restored.roomConfig) restored.roomConfig = {};
if (!Array.isArray(restored.configHistory)) restored.configHistory = [];
```
Existing rooms → empty override = edition default. Zero breaking changes.

### Pure vs side-effect split

| Pure & unit-tested (Vitest)                                   | Side-effect glue (not unit-tested)                          |
|---------------------------------------------------------------|------------------------------------------------------------|
| `mergeConfig` (precedence, fall-through, append-vs-replace)   | `companionReact` (reads localStorage mute, `getEdition`)   |
| `pickGuessEvent` (priority, toggles, ctx)                     | `app.js` guess-reaction call site, snapshot recv, send     |
| `resolvePreset`                                               | `settings.js` editor DOM, chevron sections, preset chips   |
| `diffConfig`                                                  | `room.ts` `onSetRoomConfig`/`onRevertConfig` (DO storage)  |
| `sanitizeRoomConfig` (extract to `src/roomConfig.ts`, pure)   | `persistAndBroadcast`, hibernation, WS                     |
| Regression test: `mergeConfig(ed, {})` ≡ `ed`                 |                                                            |

`public/roomConfig.js` and (server) `src/roomConfig.ts` hold the pure logic; they share the same merge/sanitize contract (sanitize lives server-side for enforcement, merge lives client-side for resolution). `companion.js` is untouched — it already takes `cfg` as a plain param, so the override just changes the object handed in.

### Error handling

- **Unknown section / key:** `sanitizeRoomConfig` drops it silently (forward-compat: an old server ignores a future section; a new client sending `palette` to a not-yet-aware server simply has it stripped).
- **Bad `priority` (unknown event / wrong length):** ignored → default priority.
- **`talkativeness` out of range:** clamped to 0..1.
- **`revert_config` with bad `v`:** no-op + `pushSystem` warning to the sender only (or silent); never throws.
- **Oversized banks/lines:** truncated, not rejected (forgiving — the vision's "hard to break").
- **Missing bank on an edition (e.g. `progress` on arcade):** `companionReact` returns empty → silent for that event on that edition until populated. Never errors.

### Testing approach

- Vitest unit suites for `roomConfig.js`: merge precedence & fall-through; append-vs-`{replace}` banks; `react` deep-merge exception; `pickGuessEvent` priority/toggle matrix; preset expansion; the **default-preserving regression** (`mergeConfig(editionDefault, {})` deep-equals `editionDefault`).
- `sanitizeRoomConfig` suite: strip/clamp/truncate, unknown-section drop, range clamp.
- Server handler behavior (version append, FIFO cap, revert appends-not-rewrites) tested via a thin pure extraction if the DO harness is unavailable; otherwise documented as manual smoke.

---

## Non-goals (deferred to later rungs)

- **Per-room non-Yang rendered voice.** `VOICE_EDITION` stays pinned to `"yang"`. `voice.voiceEdition` is reserved schema only.
- **Personal defaults / fork-to-my-default.** The `userDefault` merge layer is reserved; the User DO write path, `defaultRoomConfig` field, and the `PUT /api/user/<name>/config` endpoint are a separate rung (rung 06).
- **Session layer.** Ephemeral per-viewer overrides — reserved layer, no implementation.
- **Palette / fonts / rules / creature / economy sections.** Shapes stubbed only. Economy is **Tier A / Sacred** — its rung needs explicit gating.
- **Live render of custom voice lines.** Unrendered lines fall back to `speechSynthesis` (existing behavior). The golden-voice remote render is "Part C", out of scope.
- **AI-browsable config index (KV/R2 fan-out, `/api/room/<path>`).** The version history lives in the DO now; exposing it for AI mining is a later rung that adds the API surface.
- **`get_config_history` on-demand request** if v0 ships history inline within caps; promote to on-demand only if blob size becomes a problem.

## Open questions

1. **`react` deep-merge exception** — is the one-section deep-merge worth the special case, or should rooms always supply a full `react` block (simpler, but less ergonomic)? Leaning deep-merge; flag for review.
2. **History inline vs on-demand** — ship `configHistory` in the broadcast (simple, capped) or strip + lazy-fetch from day one? Leaning inline given the 50-entry/24-line caps; revisit if blobs bloat.
3. **Preset re-pick after advanced edits** — re-picking a preset should it hard-reset (discard divergence) or merge? Leaning hard-reset with a confirm toast.
4. **System chat noise** — every config tweak `pushSystem`s a line; a rapid editor session could spam chat. Debounce, or only chat on preset/revert, not on slider drags? Leaning: chat on preset pick + revert only.

## Locked decisions

1. **One object, additive sections.** New tunables = new optional top-level key in `RoomConfig`. Never a new flat field + message + picker again.
2. **Server stores the override delta only; client resolves.** The DO never imports an edition.
3. **Two messages total:** `set_room_config`, `revert_config`. Both follow the existing 4-step setter pattern + `persistAndBroadcast`.
4. **Kindness model:** any present player may edit; `by` records authorship; no owner gate in rung 00.
5. **Merge contract:** sections fall through independently; objects shallow-merge one level (`react` deep-merges by sub-key, including `voiceBudget.progress` and `voiceBudget.routine`); `priority`/`events` replace; **line banks append unless wrapped in `{replace}`**.
6. **Default-preserving guarantee:** `{}` override ≡ today's Yang-global behavior, enforced by test.
7. **Versioning:** append-only `configHistory` in the DO `state` blob; revert is forward-only (appends a new version); caps `historyMax=50`, `bankMax=24`, `lineMax=140`.
8. **Presets are partial `RoomConfig`s** under a name; selecting sets the config; `preset` field records provenance; advanced edits diverge without clearing it.
9. **Simple path = preset chip + talkativeness dial.** Everything else is collapsed Advanced with safe defaults. Progressive disclosure is the #1 UX law.
10. **`VOICE_EDITION` stays `"yang"`** this rung; voice override governs *what/how-often/priority*, not clip identity.
11. **Personal-default precedence (rung 06):** host's room config is the default for all guests; each guest may toggle "use my vibe" to apply their personal default locally (personal-experience parts only). The `userDefault` layer is realized through the seed path for owned rooms; guests hold it dormant unless opted in. See merge semantics above.
12. **`voiceBudget.progress` is a configurable budget knob** (default 1.0 = always-speak, honoring "never silent"); the room's talkativeness dial can lower it. Defined in `voice.react.voiceBudget` alongside `routine`. See `VoiceConfig.react` above.
13. **`/api/themes` is public with usernames.** Every room's config + author usernames are exposed at `/api/themes` with no auth, consistent with the existing public `/api/user`. Authorship enumeration is the intended behavior (rung 05).
14. **Advanced editor uses an explicit "Save changes" button** (rung 03). Advanced edits stage locally and commit + create a version only on explicit save — forgiving, undo-friendly, fewer version entries. Simple-mode preset/dial changes may still apply instantly.

---

## Glossary

- **roomConfig / override / delta** — the partial `RoomConfig` a room has set; absent fields fall through to the edition default.
- **edition default** — a theme's baked-in `companion` block (`yang.js` etc.); the always-on baseline layer.
- **effective config** — `mergeConfig(...layers)` result; what the runtime actually uses. Lives client-side only.
- **preset** — a named partial `RoomConfig` bundle (e.g. Gremlin) a beginner taps once.
- **section** — a top-level key of `RoomConfig` (`voice`, later `palette`…). Additive and independent.
- **bank** — a line array for one event/tier; append-by-default, `{replace}` to override.
- **version / ConfigVersion** — one append-only history entry: `{ v, at, by, parent, config, label }`.
- **kindness model** — any present player may mutate room state; owner is bookkeeping.

## Dependency note — which rung consumes which part

| Rung | Consumes |
|------|----------|
| **00 (this doc)** | the contract; ships nothing on its own |
| **01 always-speak voice** | `pickGuessEvent`, `progress` bank, `companionReact` merge of `voice` — no UI yet |
| **02 persist + version + open editing** | `RoomConfig.voice`, `set_room_config`/`revert_config`, DO persist+broadcast, `mergeConfig` (edition←room), append-only `configHistory` |
| **03 editor UI (+ version timeline)** | `PRESETS`, `resolvePreset`, settings "Companion & Vibe" section, talkativeness dial, advanced sub-section, **read+revert version timeline** (full history-diff UX may stay a later enhancement) |
| **04 config-sections expansion** | the stubbed sections promoted (`palette`, new `sounds`; `fonts`/`rules`/`creature` scaffolded), `applyRoomConfig` client seam (economy stays Sacred/Tier A, deferred) |
| **05 AI-browsable theme & version intel** | `RoomIndexRecord` projection, `DIRECTORY` KV fan-out, `/api/room/<path>` + `/api/themes` read API, offline theme-intel miner |
| **06 personal defaults + discovery** | `userDefault` merge layer, User DO `defaultRoomConfig`, fork-to-my-default, `/discover` surface |
| **later: rules-migration / creature-skins / economy / session layer** | the remaining stubbed sections + reserved layers (economy is Sacred/Tier A) |
