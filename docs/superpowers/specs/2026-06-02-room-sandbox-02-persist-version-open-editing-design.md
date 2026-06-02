# Room Sandbox — Persist + Version + Open Editing (Rung 02)

**Date:** 2026-06-02
**Status:** Draft for review
**Part of:** Room Sandbox ladder — **rung 02**.

> **Citation rule.** This spec **consumes** the canonical contract in
> `docs/superpowers/specs/2026-06-02-room-sandbox-00-architecture-design.md`. It does **not**
> redefine `RoomConfig`, `VoiceConfig`, `ConfigVersion`, `PRESETS`, the merge chain, or the caps —
> it implements the server-side slice of them. Where this doc says "the schema" / "the merge
> contract" / "the caps", it means rung 00 verbatim. `ReactConfig` is the shipped `companion.react`
> shape from `docs/superpowers/specs/2026-06-02-smart-companion-engine-design.md` — not redefined here.

---

## Problem

After rung 01 (always-speak voice), the companion's *behavior* is fully driven client-side by
`mergeConfig(editionDefault, override)` and `pickGuessEvent`, but the **override is always `{}`** —
there is no way to set it, persist it, or carry it between players. A room cannot remember that it
should be a Gremlin or a Quiet room; reload and it's back to the bare edition default. Every existing
tunable surface (`wordLength`, `mode`, `edition`) is a per-room field persisted in the Room DO and
broadcast in the snapshot, but `roomConfig` — the keystone's single extensible override — has no
DO field, no `ClientMessage`, no version log, and no broadcast.

This rung makes `roomConfig` a **first-class, persisted, versioned, openly-editable** piece of room
state, exactly mirroring how `set_edition`/`set_mode` already work, so that any present player can set
it (kindness model), the room remembers it across reloads/hibernation, every change is an append-only
version you can browse and revert, and every connected client receives the live override in its
snapshot and applies the merged result.

## Goal

Lift `roomConfig` into the Room DO at the **data layer only**:

1. Add `roomConfig: RoomConfig` and `configHistory: ConfigVersion[]` to `RoomSnapshot` (rung-00 shape),
   backfilled by a constructor migration shim.
2. Add the **two** rung-00 `ClientMessage`s — `set_room_config` and `revert_config` — plus the optional
   `roomConfig` seed on `hello`, each handled with the existing 4-step setter pattern + `persistAndBroadcast`.
3. Enforce the rung-00 caps and a `sanitizeRoomConfig` server gate (extends the `sanitizeEdition` strip/truncate pattern).
4. Append-only `configHistory`; `revert_config` is forward-only (appends a new version).
5. Broadcast `roomConfig` in every snapshot; on receipt the client feeds it into the rung-01
   `companionReact` merge (already built) so the effective config applies on every snapshot.

**No editor UI** (rung 03), **no preset chips / talkativeness dial** (rung 03), **no history-browser UI**
(read+revert timeline is rung 03), **no personal defaults** (rung 06). This rung is the data/protocol seam those rungs plug into.

---

## Design

### Architecture

```
                                   set_room_config / revert_config
   public/app.js  ──────────────────────────────────────────────►  src/room.ts (Room DO)
     (sends override deltas;                                          onSetRoomConfig / onRevertConfig
      receives snapshot)                                              ├─ sanitizeRoomConfig (src/roomConfig.ts, pure)
                                                                      ├─ shallow per-section merge over state.roomConfig
   public/edition.js  ◄──── snapshot.roomConfig ────────────────────┤─ append ConfigVersion (FIFO cap 50)
     companionReact(mergeConfig(                                      └─ persistAndBroadcast (single "state" blob)
        editionDefault, snapshot.roomConfig?.voice))   [rung 01]
```

- **Server is dumb storage + fan-out** (rung-00 Locked #2). The DO stores the **override delta only**,
  never resolves it against an edition. It sanitizes, shallow-merges the incoming delta over
  `state.roomConfig`, appends a version, persists the one `state` blob, and rebroadcasts — byte-identical
  in shape to `onSetEdition` (`src/room.ts:339`).
- **Client resolves** via the rung-01 `mergeConfig(editionDefault, snapshot.roomConfig?.voice)` call
  already wired in `companionReact` (`public/edition.js`). This rung only changes *what object the
  snapshot carries* — the client-side resolution code is untouched from rung 01.
- **Voice stays global.** `VOICE_EDITION = "yang"` unchanged (rung-00 Locked #10). The override governs
  what/how-often/priority, not clip identity.

### Components / files (exact paths)

**`src/types.ts`**
- Add `roomConfig: RoomConfig` and `configHistory: ConfigVersion[]` to `RoomSnapshot`
  (currently ends at `edition: string;`, line 64). Import/define `RoomConfig` and `ConfigVersion`
  per the rung-00 schema (server only needs the structural shape — `voice?` plus the reserved stub
  sections; it never inspects them, so they may be typed as the rung-00 `RoomConfig` directly).
- Extend the `ClientMessage` union (lines 67–80) with the rung-00 variants:
  ```ts
  | { type: "set_room_config"; config: RoomConfig; label?: string }
  | { type: "revert_config";   v: number }
  ```
- Add the optional seed to the `hello` variant (line 68):
  `{ type: "hello"; username: string; wordLength?: number; mode?: RoomMode; edition?: string; roomConfig?: RoomConfig }`.

**`src/roomConfig.ts` (new, pure, no DO imports — Vitest-importable)**
- `sanitizeRoomConfig(raw: unknown) → RoomConfig` — strip unknown top-level sections; within `voice`:
  clamp `talkativeness` to `0..1`; drop unknown `events` keys / non-boolean values; validate `priority`
  is a subset of `["greens","progress","wrong"]` (else drop → default); pass `react` through (opaque
  `ReactConfig`, but JSON-depth/size-bounded); for `lines`, truncate each line to `lineMax` (140) chars,
  clamp each leaf bank to `bankMax` (24) entries, preserve the `{ replace: [...] }` wrapper. Forgiving:
  truncate/drop, never throw (rung-00 Error handling).
- `mergeDelta(base: RoomConfig, delta: RoomConfig) → RoomConfig` — the **server-side** shallow
  per-section merge used to fold an incoming delta over `state.roomConfig`. Same shallow contract the
  client's `mergeConfig` uses (rung-00 Merge rule #2): sections fall through independently; objects
  shallow-merge one level; `events`/`priority` replace; `voice.react` deep-merges by sub-key; **line
  banks append unless wrapped `{replace}`** (rung-00 Merge rule #4). Re-export or co-locate the
  append/replace bank helper so client and server share one definition of "append".
  *(Decision in Open questions: whether `mergeDelta` and the client `mergeConfig` bank logic share a
  single module imported by both, or are mirrored. Leaning shared helper to avoid drift.)*
- `CONFIG_CAPS = { historyMax: 50, bankMax: 24, lineMax: 140 }` — the rung-00 caps, single source.

**`src/room.ts`**
- **Constructor migration shim** — after the existing backfills (lines 78–85, inside
  `blockConcurrencyWhile`), add:
  ```ts
  if (!restored.roomConfig) restored.roomConfig = {};
  if (!Array.isArray(restored.configHistory)) restored.configHistory = [];
  ```
  Also initialize both in the fresh-state literal (lines 54–73): `roomConfig: {}`, `configHistory: []`.
- **`handle` switch** (lines 165–195) — two new cases mirroring `set_edition`/`set_mode`:
  ```ts
  case "set_room_config": return this.onSetRoomConfig(ws, msg.config, msg.label);
  case "revert_config":   return this.onRevertConfig(ws, msg.v);
  ```
- **`onHello`** (line 198) — accept `roomConfig?` and seed it only when
  `username === this.state.owner && this.state.phase === "lobby" && this.state.round === 0`, the
  identical gate used for edition/mode/length seeding (lines 223–252). Sanitize before assigning;
  seeding does **not** append a version (it's the room's birth state, v0-implicit `{}` → seed).
  *(If a seed is non-empty, append a single `ConfigVersion` so history isn't empty — see Open questions.)*
- **`onSetRoomConfig(ws, config, label?)`** — the 4-step setter (template: `onSetEdition`, line 339):
  1. **Guard.** Voice-only edits allowed any phase (cosmetic — like a live theme swap is *not*, but voice
     is). The rung-00 rules section is a STUB this rung does not accept, so there is **no rules payload to
     guard** yet; defensively, if `sanitizeRoomConfig` ever surfaces a `rules` section (future), block when
     `phase === "playing"` (mirror `onSetEdition`'s mid-game guard). For rung 02 the effective guard is:
     accept any time.
  2. **Validate + merge.** `const clean = sanitizeRoomConfig(config); this.state.roomConfig =
     mergeDelta(this.state.roomConfig, clean);` (delta folded over current; rung-00 shallow contract).
     If the merge is a no-op (deep-equal to current), return without appending (mirrors the `=== this.state.x`
     early-returns in `onSetLength`/`onSetEdition`).
  3. **Append version.** Push to `configHistory`:
     `{ v: configHistory.length + 1, at: Date.now(), by: this.userFor(ws) ?? "someone",
        parent: configHistory.length || null, config: structuredClone(this.state.roomConfig), label }`.
     Then FIFO-cap to `CONFIG_CAPS.historyMax` (drop oldest; note `v` stays monotone — it is **not**
     re-indexed to array position after a drop; see Error handling).
  4. **`pushSystem` + `persistAndBroadcast`.** Chat note via `pushSystem` (e.g. `${who} updated the room
     vibe${label ? ` (${label})` : ""}`) + the existing fan-out (`src/room.ts:679`). *(Chat-noise debounce
     is a rung-00 Open question owned by rung 03's editor; rung 02 emits one system line per accepted set.)*
- **`onRevertConfig(ws, v)`** — find the entry with matching `.v` in `configHistory`
  (search by `.v`, **not** array index, because FIFO drops desync index from `v`); if none, no-op +
  `this.send(ws, { type: "error", message: "no such version" })` to the sender only (never throws —
  rung-00 Error handling). Else set `this.state.roomConfig = structuredClone(found.config)`, append a
  **new** version (`parent: v`, `label: "reverted to v" + v`), `pushSystem`, `persistAndBroadcast`.
  Revert is forward-only — history is never rewritten (rung-00 Versioning).
- **`snapshotFor`** (line 669) — `configHistory` ships **inline** in the broadcast for rung 02 (rung-00
  Open question #2 leaning: inline, the caps keep it small — ≤50 entries × small deltas). No strip, no
  `get_config_history` request this rung (that's a later promotion if blob size becomes a problem).
  `roomConfig` rides along automatically via the `...this.state` spread already in `snapshotFor`.

**`public/app.js`**
- **Send.** Expose a thin sender used by rung 03's UI: `send({ type: "set_room_config", config, label })`
  and `send({ type: "revert_config", v })` over the existing WS. Rung 02 wires the *plumbing*; the only
  caller this rung needs is for testing/debug (rung 03 adds the real UI callers). No new UI.
- **Receive.** The snapshot handler already spreads the room snapshot into client state; `roomConfig`
  and `configHistory` arrive as new fields. Ensure the snapshot handler stores `snapshot.roomConfig`
  where `companionReact` reads it (the rung-01 merge already consumes `snapshot.roomConfig?.voice`).
  Default a missing field to `{}` / `[]` for forward/backward safety.

**`public/edition.js`** — **unchanged from rung 01.** `companionReact` already merges
`snapshot.roomConfig?.voice` over the edition default; this rung simply makes that field non-empty.
Listed here only to assert the no-change contract.

### Data flow

```
1. Player A (any present player) edits → app.js send({type:"set_room_config", config: delta, label})
2. Room DO.handle → onSetRoomConfig:
     sanitizeRoomConfig(delta) → mergeDelta over state.roomConfig
     → append ConfigVersion (cap 50) → pushSystem → persistAndBroadcast
3. storage.put("state", ...) — single blob, includes roomConfig + configHistory
4. Every connected WS receives { type:"snapshot", room:{ ...roomConfig, ...configHistory } }
5. Each client: companionReact(mergeConfig(editionDefault, snapshot.roomConfig?.voice))  [rung 01]
     → next valid guess speaks per the new override; effective config re-applies every snapshot
6. Revert: app.js send({type:"revert_config", v}) → onRevertConfig sets roomConfig to that
     version's config, appends a NEW version (parent:v), broadcasts → step 4–5 repeat.
```

Reload / hibernation: the constructor restores `state` (with `roomConfig` + `configHistory`); the
migration shim backfills empties for pre-rung-02 rooms. First snapshot after `hello` carries the
persisted override — the room "remembers".

### Error handling (rung-02 specifics; defers to rung-00 Error handling)

- **Unknown section/key:** `sanitizeRoomConfig` drops silently (forward-compat — a client sending a
  future `palette` section to this server has it stripped).
- **`talkativeness` out of range / bad `priority` / non-boolean `events`:** clamped / dropped to default.
- **Oversized banks/lines:** truncated to caps, not rejected (forgiving).
- **`revert_config` with bad `v`:** no-op + per-sender error message; never throws, never mutates.
- **No-op set:** if the merged result deep-equals the current `roomConfig`, return without appending a
  version (avoids history spam from idempotent sends).
- **FIFO `v` monotonicity:** `v` is a monotone counter, **not** an array index, so after the oldest
  entry is dropped at `historyMax`, `revert_config` and `parent` still reference stable `v` values.
  `onRevertConfig` and the `v` assignment in `onSetRoomConfig` therefore use the **last entry's `v` + 1**,
  not `configHistory.length + 1`, once dropping can occur. *(Spec correction vs. the rung-00 sketch which
  said `length + 1` — that holds only before any FIFO drop; rung 02 uses `(lastV) + 1` to stay correct
  post-drop. Flag in Open questions.)*
- **Not transactional** (rung-00): a crash between mutate and `storage.put` can lose the latest version.
  Acceptable for config history; documented, not fixed.

### Testing approach

Pure Vitest suites (no DO harness) for `src/roomConfig.ts`:
- `sanitizeRoomConfig`: strip unknown section; clamp `talkativeness`; drop bad `events`/`priority`;
  truncate line to 140; clamp bank to 24; preserve `{replace}` wrapper; never throw on garbage input.
- `mergeDelta`: section fall-through; objects shallow-merge; `events`/`priority` replace; `react`
  deep-merge by sub-key; **banks append; `{replace}` overrides** (the rung-00 merge matrix, server side).
- **Default-preserving regression (rung-00 contract):** `mergeDelta({}, {})` ≡ `{}` and a delta over `{}`
  equals the sanitized delta — and the *client* `mergeConfig(editionDefault, sanitizeRoomConfig({}))` ≡
  `editionDefault` (assert the seam stays byte-for-byte with rung 01).
- Version bookkeeping logic, extracted pure where possible: `v` is monotone across a FIFO drop;
  `onRevertConfig` appends-not-rewrites and sets `parent`. If the bookkeeping is inlined in the DO and
  not easily extracted, factor a pure `appendVersion(history, entry, cap)` and `findVersion(history, v)`
  into `src/roomConfig.ts` and unit-test those.

DO handler behavior (seed-on-hello gate, persist, broadcast inline `configHistory`) is covered by
manual smoke per rung-00's note (no CI; deploy via wrangler): set a config in one tab, reload, confirm
it persists and re-applies; open a second tab, confirm the override broadcasts; revert and confirm a new
version appends.

---

## Non-goals (deferred to the rung that owns each)

- **Editor UI — preset chips, talkativeness dial, advanced sub-section.** Rung 03 (`docs/...-room-sandbox-00`
  dependency table). Rung 02 ships only the sender plumbing in `app.js`, no DOM, no `settings.js` section.
- **`PRESETS` / `resolvePreset` consumption.** Presets are partial `RoomConfig`s the rung-03 UI sends via
  `set_room_config`; rung 02 needs no preset concept server-side (rung-00 Locked #8).
- **Version-history browser UI** (the "browse" half of browse+revert) and **on-demand `get_config_history`**
  request. The read+revert timeline lands in **rung 03**; richer history-diff UX is a later enhancement.
  Rung 02 ships the data (`configHistory` inline) and the `revert_config` message; it does not render a history list.
- **Personal defaults / fork-to-my-default / `userDefault` merge layer / User DO `defaultRoomConfig`.**
  Rung 06. The `onHello` `roomConfig` seed is the seam this later flows through, but rung 02 only wires the
  owner-seed path, not the personal-default write.
- **Palette / fonts / rules / creature / economy sections.** Stubbed in the rung-00 schema only; rung 02
  accepts and persists `voice` (and stores any other present section opaquely, but does not act on it).
  Economy is **Tier A / Sacred** — its rung needs explicit gating.
- **Per-room non-Yang rendered voice (`voice.voiceEdition`).** `VOICE_EDITION` pinned to `"yang"` (rung-00
  Non-goals). Schema-reserved only.
- **`diffConfig` delta-compression of version entries.** Rung 02 stores full override **snapshots** per
  version (rung-00 v0 decision — deltas are already tiny). `diffConfig` is an available later optimization.
- **AI-browsable config index (KV/R2 fan-out).** The history lives in the DO blob now; exposing it for AI
  mining is a later rung.

## Open questions

1. **Shared merge helper vs. mirror.** Should `mergeDelta` (server) and the client `mergeConfig` bank
   append/replace logic import **one** shared pure module, or be mirrored in `src/roomConfig.ts` and
   `public/roomConfig.js`? Sharing avoids the rung-00 contract drifting between the two; mirroring keeps the
   server bundle free of client concerns. **Leaning: one shared bank-merge helper, mirrored thin wrappers.**
2. **`v` numbering post-FIFO.** Confirm the spec correction: `v` is a monotone counter (`lastEntry.v + 1`),
   **not** `configHistory.length + 1`, so `revert(v)` and `parent` stay valid after the oldest entry drops
   at `historyMax`. The rung-00 sketch used `length + 1`; this is correct only pre-drop. **Leaning: monotone
   counter** (proposed above) — needs a one-line blessing since it diverges from the keystone's example.
3. **Empty seed → empty history.** When `onHello` seeds a non-`{}` `roomConfig` (rung-06 personal default
   later), should it append a `ConfigVersion` so the history is never empty, or leave history empty until the
   first explicit edit? **Leaning: append a `v:1` seed entry when the seed is non-empty; leave empty for `{}`.**
4. **Inline vs. on-demand `configHistory` (rung-00 OQ #2, surfaced here).** Rung 02 ships it **inline** in the
   snapshot (caps keep it small). Confirm we don't strip it from `snapshotFor` yet — promotion to a
   `get_config_history` request is a later call if blobs bloat.

## Locked decisions (rung 02; all inherit rung-00 Locked list)

1. `roomConfig: RoomConfig` and `configHistory: ConfigVersion[]` are added to `RoomSnapshot`, persisted in
   the single `state` blob, broadcast inline — same place and lifecycle as `edition`/`mode`/`wordLength`.
2. Two messages only: `set_room_config`, `revert_config` (rung-00 Locked #3), handled with the existing
   4-step setter pattern + `persistAndBroadcast` (template: `onSetEdition`, `src/room.ts:339`).
3. **Kindness model** (rung-00 Locked #4): any present player may send both messages; `by` records
   authorship; no owner gate. Owner-only seed-on-hello stays gated to
   `owner && lobby && round === 0` (matches edition/mode/length seeding).
4. **Server stores the override delta only; never resolves an edition** (rung-00 Locked #2). The DO does not
   import `public/editions/*`.
5. **Merge contract & caps are rung-00 verbatim:** sections fall through; objects shallow-merge one level
   (`react` deep-merges by sub-key); `events`/`priority` replace; **banks append unless `{replace}`**;
   `historyMax=50` (FIFO), `bankMax=24`, `lineMax=140`.
6. **Default-preserving guarantee holds:** with no override (`{}`), `companionReact` behaves byte-for-byte as
   rung 01 (Yang global voice). Enforced by test at the seam.
7. **Revert is forward-only:** `revert_config` appends a new version (`parent: v`, auto-label); history is
   never rewritten.
8. **Constructor migration shim** backfills `roomConfig`/`configHistory` for pre-rung-02 rooms — zero
   breaking changes.
9. **No UI this rung.** `app.js` gains only the WS sender plumbing; `edition.js`/`companion.js` are
   untouched from rung 01; `settings.js` is not touched.
