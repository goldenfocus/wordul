# Per-World Voice — design spec

**Date:** 2026-06-07
**Branch:** `studio-voice` (off `origin/main` @ `178cf50`)
**Status:** design, pending implementation plan
**Scope:** studio slice — per-world voice only. Palette / companion-name / phrase-bank
text editing are explicitly **out of scope** (a later slice).

---

## 1. Goal

Let an admin give each **World** its own companion **voice** — or no voice at all.
Today the companion always speaks in one hardcoded voice (Yang's), regardless of which
World you're in. After this slice:

- A World is **silent by default**. Voice is opt-in, per World.
- An admin assigns a voice to a World in the studio: choosing the **source** and whether
  it **starts on or off**.
- v1 voice sources: **`ai`** (a browser/system TTS voice), **upload** (admin uploads
  wav/mp3 clips), **clone-existing** (reuse an already-rendered clip set, e.g. Yang's).
- The data model also **specs** two future sources without building them: in-browser
  **record**, and **clone-from-sample** (upload a sample → offline cloning renders clips).
- Curation is **admin-only** now; the record shape is future-proofed so **end-user
  uploads** can be added later by a different (authenticated, moderated) endpoint with no
  reshape.

This is a deliberate, reviewed product behavior change (default silent — see §8 Migration).

---

## 2. How the system works today (grounded in `origin/main`)

The implementation must plug into existing machinery, not duplicate it.

- **Voice-config merge contract** — `public/roomConfig.js`. `mergeConfig(...layers)`
  (`roomConfig.js:89`) merges voice override layers left→right; `mergeVoice`
  (`:78`) shallow-replaces voice keys, deep-merges `react`, append-merges line banks, and
  **already passes through a `voiceEdition` key** (`:84`). `roomConfig` is an *override
  delta*: `{}` means "pure edition default". `mergeConfig(base, {}) === base`.
- **Companion runtime** — `public/edition.js`. `companionReact(event, ctx)`
  (`:84`) builds the effective voice config via
  `mergeConfig({voice:{react,lines}}, {voice: snapshotVoiceConfig()})` (`:87-90`), where
  `snapshotVoiceConfig()` is a **stub returning `{}`** (`:68`) — the override layer is
  reserved but unwired. Lines/clips currently come from `VOICE_EDITION = "yang"` (`:82,85`),
  hardcoded. Only the `reveal` mode follows the **active** edition
  (`getEdition(activeId).sound?.voice?.reveal`, `:124-127`).
- **Global voice opt-in** — `isVoiceEnabled()` / `setVoiceEnabled()` (`edition.js:12-13`,
  localStorage `wordul.voice`). When **off** (default), only the `{answer}` reveal speaks;
  when **on**, the scarcity budget decides (`edition.js:119-121`). Mute
  (`localStorage wordul.muted`) trumps everything.
- **Audio playback** — `public/voice.js`. Clips are looked up in a per-edition manifest
  fetched from **static ASSETS** at `/voice/<editionId>/manifest.json` (`voice.js:23`) and
  played from `/voice/<editionId>/<file>` (`:157,186`); missing line → browser
  `speechSynthesis` fallback; `{answer}` reveal can be `robot` or `split`
  (`voice.js:116`).
- **Worlds** — `src/worlds.ts`. `WorldDef = { id, slug, editionId, name, blurb, featured,
  order }` (`:13`); `id` is stable identity (`=== editionId` for launch Worlds), `slug` is
  the URL at `/w/<slug>`. Client resolves the active World by slug via `getWorld(slug)`
  (`public/worlds.js:53`; `app.js` routes `r.kind === "world"`, `r.slug`).
- **Slice-1 override backbone (reused verbatim as a pattern)** — `src/world-overrides.ts`
  (pure `normalizeOverrides` + `mergeWorlds`), KV key `WORLD_OVERRIDES_KEY =
  "worlds:overrides"` on the **`DIRECTORY`** binding (`worlds.ts:59,63`), endpoints
  `GET /worlds.json` + `GET/POST /admin/worlds` behind `requireAdmin` (DAILY_ADMIN_TOKEN,
  64KB guard) (`worker.ts:66,373,381,405`), client boot-hydrate `loadWorlds()`, and the
  editor `public/studio-worlds{,-core}.js` with a minimal-diff `buildOverrides`.
- **Bindings** — `wrangler.jsonc`: `DIRECTORY` (KV, `:71`), R2 buckets `DESIGNS`
  (`wordul-designs`) and `OG` (`wordul-og`) (`:78-80`), `ASSETS` (`:25`). **There is no
  voice R2 bucket today** — clips ship as static assets.

> **Refinements vs. the verbally-approved design.** Fresh-main verification changed three
> things the user should re-confirm at the review gate: (a) we extend the **existing**
> `mergeConfig`/`voiceEdition` contract instead of a new parallel record; (b) uploads need a
> **new R2 bucket** because today's clips are static ASSETS, not R2; (c) a global voice
> opt-in (`isVoiceEnabled`) already exists and must compose with the per-World `on` flag.

---

## 3. Data model

### 3.1 Per-World voice override (KV)

A new override layer, keyed by **World `id`**, stored in `DIRECTORY` KV under
`worlds:voice`. Absent id ⇒ **silent** (the default).

```ts
// src/voice-overrides.ts  (pure, mirrors world-overrides.ts)
type VoiceSource =
  | { kind: "ai";    voiceName: string; rate?: number; pitch?: number }
  | { kind: "clips"; clipSetId: string;
      origin: "upload" | "clone-existing" | "clone-sample" | "record" }; // provenance

type WorldVoice    = { on: boolean; source: VoiceSource };  // on = starts activated?
type VoiceOverrides = Record<string /* worldId */, WorldVoice>;
```

- The two **runtime kinds** are `ai` (synthesize any text live — no files) and `clips`
  (play one audio file per line, TTS fallback). The four clip **origins** all resolve to
  the same `clips` runtime path; they differ only in how the set was authored and are kept
  for provenance + editor affordances.
- `clone-sample` and `record` are **valid in the schema/validator now** but the editor
  surfaces them as disabled "coming soon" controls (no authoring path built in v1).
- **End-user uploads later:** same `WorldVoice` record, written by a separate authenticated
  + moderated endpoint. No reshape.

### 3.2 Clip sets (R2)

Clip sets are decoupled from editions so any World can point at any set:

- **Built-in sets** = today's per-edition asset folders (`/voice/<editionId>/…`), exposed
  as read-only clip sets (`clipSetId === editionId`). This makes **clone-existing** free
  (point a World at `clipSetId: "yang"`).
- **Uploaded sets** live in a **new R2 bucket `wordul-voice`** (binding `VOICE`) under
  `clipsets/<clipSetId>/manifest.json` + `clipsets/<clipSetId>/<file>`.
- A runtime resolver maps a `clipSetId` to a base URL: built-in → `/voice/<id>/` (ASSETS);
  uploaded → an R2-backed route `/voice-clips/<id>/` (see §4.3). `voice.js` learns to take
  a resolved base URL instead of always `/voice/<editionId>/`.

### 3.3 How it feeds the merge contract

The per-World override is translated into a **voice override layer** and passed into the
existing `mergeConfig`, replacing the `snapshotVoiceConfig()` stub's role:

```
effective = mergeConfig(
  { voice: { react, lines } },        // edition default (lines/clips identity)
  worldVoiceLayer(activeWorld),       // NEW: { voice: { voiceEdition, source, reveal, on } }
  { voice: snapshotVoiceConfig() },   // room override (still {} until rung-2)
)
```

`voiceEdition` (already a passthrough key) carries the clip/voice identity; `source`,
`voiceName`, `rate`, `pitch`, `clipSetId`, `on` are added as passthrough (shallow-replace)
keys. Lines (text) remain edition banks (see §4.1).

---

## 4. Runtime behavior

### 4.1 Line text vs. voice (the real change)

Two things that are conflated today get split:

- **Line text** (the toast + what's spoken) is selected from the **active World's edition**
  banks — so Worlds stop all showing Yang's text (a latent limitation fixed here). Tier
  resolution, round-robin, and the loss `{answer}` filter (`edition.js:104-107`) are
  unchanged.
- **Voice** (the audio) comes from the World's resolved `WorldVoice`:
  - **absent / `on:false`** → show the toast, **speak nothing** (except the existing
    global-pref behavior is *superseded*: per-World silent means silent).
  - **`ai`** → `speechSynthesis` with the chosen `voiceName` + `rate`/`pitch`, speaking the
    selected line text. No files.
  - **`clips`** → resolve `clipSetId` → base URL → play the per-line clip by line-key, TTS
    fallback for any missing line (today's logic, generalized off `editionId`).
- The `{answer}` reveal (`robot` / `split`, `voice.js:116`) and `mute` precedence are
  preserved exactly.

> **Open interaction to confirm:** today `isVoiceEnabled()` is a single global opt-in. With
> per-World `on`, the global pref becomes a *user mute-style override* (user can still
> silence a voiced World), while `on:false` / absent makes a World silent regardless. The
> plan must specify this precedence precisely; recommended: `speak = !muted && worldVoice.on
> && (isVoiceEnabled() ? budget : isAnswerReveal)`.

### 4.2 Resolving the active World

`companionReact` needs the active World id. The client knows the active World via routing
(`getWorld(slug)`); the plan wires the resolved `WorldVoice` into the merge layer at the
call site (or via a small `activeWorldVoice()` accessor in `edition.js`, fed by a boot
hydrate — see §5).

### 4.3 Server

Mirrors the slice-1 pattern, same gate (`requireAdmin`, DAILY_ADMIN_TOKEN, 64KB guard):

- `GET /voice-config.json` — public; the effective `VoiceOverrides` for boot-hydrate.
- `GET /admin/voice` — admin; returns `{ base: <built-in clip sets + world list>,
  effective }` so the editor has both defaults and current state.
- `POST /admin/voice` — admin; `normalizeVoiceOverrides(raw, WORLDS)` → KV put under
  `worlds:voice`.
- `POST /admin/voice/clips` — admin; multipart audio upload. Validates MIME
  (`audio/wav`, `audio/mpeg`) + per-file + total size caps; writes to R2 `VOICE` under the
  target `clipSetId`; updates that set's manifest.
- `GET /voice-clips/<clipSetId>/<file>` — public; serves uploaded clips from R2 `VOICE`
  (pattern from the `DESIGNS`/`OG` routes, `worker.ts:526+`). Built-in sets keep serving
  from ASSETS at `/voice/<editionId>/…` unchanged.

### 4.4 Client boot-hydrate

`loadVoiceConfig()` (sibling of `loadWorlds()`): fetch `/voice-config.json` `no-store` at
boot, non-blocking, swallow errors (keep silent-default on failure), expose the resolved
map to `companionReact`'s merge layer; re-apply if changed.

---

## 5. Editor UI

Three files, mirroring `studio-worlds`:

- `public/studio-voice.html` — shell.
- `public/studio-voice-core.js` — **pure** transforms: `buildVoiceOverride(working, base)`
  (minimal diff like `buildOverrides`), source switching, per-line clip CRUD helpers,
  clipset-manifest assembly. No DOM/fetch.
- `public/studio-voice.js` — controller: loads via authed `GET /admin/voice`, holds
  `BASE` + `working`, saves via `POST /admin/voice`, uploads via `POST /admin/voice/clips`,
  token in `localStorage["wordul.admin.token"]` (same as studio-worlds).

Per World row: **on/off** toggle · **source** picker — `AI voice` (dropdown of
`speechSynthesis.getVoices()` + rate/pitch) | `Reuse clip set` (pick a built-in/existing
set) | `Upload clips` (per-line grid: each line + clip status + upload). Future origins
(`record`, `clone-sample`) render as **disabled "coming soon"** controls so the layout is
already shaped. "Remove voice" clears the World's record (back to silent).

---

## 6. Validation (`normalizeVoiceOverrides`, pure)

`on` boolean · `source.kind` whitelisted (`ai`|`clips`) · `ai`: `voiceName` non-empty,
`rate`/`pitch` clamped to safe ranges · `clips`: `origin` whitelisted, `clipSetId`
references an existing set · `worldId` must exist in the base `WORLDS` list · unknown
fields rejected · upload route: MIME + size caps, `clipSetId` slug-validated. (No
`{answer}` line-rule here — line-text editing is out of scope; the runtime already filters
loss lines to `{answer}`-carriers when the answer is known, `edition.js:104-107`.)

---

## 7. Testing (TDD — pure cores first)

- **`normalizeVoiceOverrides`** — whitelist kinds/origins, clamp rate/pitch, reject unknown
  worldIds/fields, clipSetId existence, `on` coercion.
- **effective resolution** — `worldVoiceLayer` + `mergeConfig` produces expected merged
  voice; `mergeConfig(base, {}) === base` preserved.
- **`studio-voice-core`** — `buildVoiceOverride` minimal diff, source switching, clip CRUD,
  manifest assembly.
- **runtime** — line text selected from active World's edition; source dispatch
  (`ai` vs `clips` vs silent); silent-by-default; mute precedence; `{answer}` reveal mode
  preserved; global-pref interaction per §4.1.
- **endpoints** — typecheck; upload MIME/size validation; 64KB guard; R2 round-trip
  (mocked).

---

## 8. Migration (decision needed at review)

Default becomes **silent**, but today the companion speaks (Yang) everywhere. To avoid a
silent-prod regression, **seed** the Worlds that should keep speaking with
`{ on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } }` as
the initial `worlds:voice` value; every other World starts silent intentionally.

- **Default (recommended):** seed Yang-voiced Worlds so nothing regresses.
- **Alternative:** ship truly silent and turn voices on by hand in the studio.

---

## 9. Out of scope (specced as extension points, not built)

Palette editing · per-World **rewording** of line text (v1 attaches voice to the *existing*
edition lines) · end-user (non-admin) uploads · in-browser **record** · **clone-from-sample**
rendering pipeline.

---

## 10. Build prerequisites

- Work happens only in this worktree (`.claude/worktrees/studio-voice`); root edits are
  hook-blocked. Ship via `dev/ship.sh` (tests → rebase → merge main → CI deploys). Never
  `wrangler deploy` by hand.
- New infra to provision: R2 bucket **`wordul-voice`** + binding **`VOICE`** in
  `wrangler.jsonc`.
- Re-confirm at implementation start (all verified on `178cf50`, but main moves): the
  `voiceEdition` passthrough in `mergeVoice`, the active-World accessor at the
  `companionReact` call site, and that `requireAdmin`/`DIRECTORY` are unchanged.
