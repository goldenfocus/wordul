# Room Sandbox — AI-Browsable Theme & Version Intel (Rung 5)

**Date:** 2026-06-02
**Status:** Draft for review
**Part of:** Room Sandbox ladder — **rung 5**. Publishes a room's `roomConfig` and its `configHistory` to a queryable index so an AI (or any HTTP client) can browse themes and versions for discoveries/intel. Consumes the canonical schema from rung 00 (`docs/superpowers/specs/2026-06-02-room-sandbox-00-architecture-design.md`) — it does **not** redefine `RoomConfig`, the merge chain, or `ConfigVersion`.

> **Citation rule (inherited).** This rung references the rung-00 schema by name. The shapes below add only the *index record* and *read API* — no schema changes to `RoomConfig` itself.

---

## Problem

Rung 00 stores the full `roomConfig` override and the append-only `configHistory: ConfigVersion[]` **inside the Room DO's single `state` blob** (see rung-00 "Versioning model"). That is the right home for *live gameplay*, but it is invisible to anyone not holding a live WebSocket to that exact room:

- **Durable Objects cannot be enumerated.** There is no way to list all rooms or walk their configs server-side. The only existing discovery surface is `DIRECTORY` KV (keys `user:<name>`, `room:<owner>/<slug>`) enumerated by `sitemap()` in `src/worker.ts` (lines 93-109).
- **The KV value for a room is 25 bytes** — `JSON.stringify({ name })` written by `registerRoom()` in `src/room.ts` (line 275). It carries no edition, no config, no version count.
- **There is no `/api/room/<path>` endpoint.** `/api/user/<name>` exists (`worker.ts` line 34) but exposes only the `UserProfile`, never a room's config.
- The vision's **"AI-BROWSABLE: themes + versions stored so an AI can mine them for discoveries/intel"** therefore has no surface today. Rung 00 explicitly defers this (Non-goals: "AI-browsable config index (KV/R2 fan-out, `/api/room/<path>`) … a later rung that adds the API surface").

Without this rung, the rich creative output of the sandbox — every preset divergence, every custom voice-line bank, every theme fork — is locked inside un-listable DOs and lost to the word-intel mining roadmap.

## Goal

Make every room's effective theme **and** its full version lineage **queryable by an AI without a WebSocket**, by:

1. **Fanning out an index record** to `DIRECTORY` KV on every config change (and on room register/rename), so the existing sitemap-style KV scan can enumerate *what themes exist and how they're configured*.
2. **Exposing a read API** (`/api/room/<owner>/<slug>` and `/api/room/<owner>/<slug>/history`) that returns the live `roomConfig` + `configHistory` straight from the DO — the authoritative deep read.
3. **Publishing a discovery manifest** (`/api/themes` and a static-ish `themes.json`-style aggregate) the AI can fetch in one shot to enumerate all configured rooms.
4. **Tying into the word-intel roadmap**: the index is the corpus an offline miner (sibling of `scripts/gen-word-intel.mjs`) reads to extract reusable line banks, popular presets, and palette ideas.

Configs are **open by default** per the vision — no auth on reads. Scope/privacy controls are a Non-goal (named below).

---

## Design

### Architecture

```
   live mutation                       fan-out (KV, cheap)                 deep read (DO, authoritative)
src/room.ts                          DIRECTORY KV                        worker routes (src/worker.ts)
  onSetRoomConfig ─┐                   roomconfig:<path>  ──────────►       GET /api/room/<o>/<s>          ─► ROOM DO .fetch(GET config)
  onRevertConfig  ─┼─► publishIndex()  (one IndexRecord JSON)              GET /api/room/<o>/<s>/history  ─► ROOM DO .fetch(GET history)
  registerRoom    ─┘                   room:<path> (unchanged, 25B)        GET /api/themes                ─► KV list scan → aggregate
                                                                          GET /sitemap.xml (already lists rooms)
                                                                                     │
                                                                                     ▼
                                                          offline AI miner (scripts/mine-theme-intel.mjs)
                                                          reads /api/themes → per-room → feeds word-intel corpus
```

- **Two surfaces, two jobs.** `DIRECTORY` KV is the **enumerable fan-out** (answers "what rooms/themes exist and a summary of each"). The Room DO, via new GET routes, is the **authoritative deep read** (answers "give me this room's full config + every version"). KV is a denormalized cache; the DO is the source of truth (rung 00, "Server is dumb storage + fan-out").
- **Write path is additive to the existing fan-out.** `registerRoom()` already writes `room:<path>` and pings the USER DO. Rung 5 adds **one** sibling KV write (`roomconfig:<path>`) from a new `publishIndex()` helper, called from the same three side-effect sites that already mutate config (`onSetRoomConfig`, `onRevertConfig`) plus `registerRoom`. No new storage in the DO — `configHistory` already lives in `state`.
- **Read path adds GET handlers to the Room DO.** The DO already handles `GET` for snapshots; we add `?config=1` / `?history=1` query handling in its `fetch` (mirroring how `/api/user` does `GET` against the USER DO). The worker routes `/api/room/...` to the canonical DO via the existing `roomalias:` resolution (already done for `/ws`, `worker.ts` lines 23-30) — so renamed rooms resolve correctly.

### The index record (NEW — this rung owns it)

This is the **only** new type. It is a **summary/denormalized projection** of rung-00 state, not a redefinition of `RoomConfig`. It lives in `src/types.ts` next to `RoomSnapshot`.

```ts
// ── src/types.ts (NEW, rung 5) ──
// Denormalized projection of a room's theme for KV fan-out + AI enumeration.
// Cheap to scan; the DO read API returns the full RoomConfig/ConfigVersion[].
export type RoomIndexRecord = {
  path: string;            // "<owner>/<slug>" — the canonical DO key
  name: string;            // room display name (already in DIRECTORY today)
  owner: string;
  edition: string;         // visual theme id (RoomSnapshot.edition)
  preset?: PresetId;       // roomConfig.preset — provenance label (rung 00)
  // ── theme fingerprint (cheap, queryable without a deep read) ──
  hasVoiceOverride: boolean;   // roomConfig.voice present & non-empty
  talkativeness?: number;      // roomConfig.voice.talkativeness if set
  customLineCount: number;     // total custom lines across all voice.lines banks
  versionCount: number;        // configHistory.length
  updatedAt: number;           // latest ConfigVersion.at (or registerRoom time)
  updatedBy?: string;          // latest ConfigVersion.by (kindness model)
  // ── rules summary (read-through of legacy flat fields; rules section is a rung-00 stub) ──
  wordLength: number;
  maxGuesses: number;
  mode: string;
};
```

- **`customLineCount`** is computed by walking `roomConfig.voice.lines` leaf banks (the same nested shape as `VoiceLineBanks` in rung 00) and summing array lengths (counting `{replace:[...]}` by its array length). It is the single most useful "is this theme creatively interesting?" signal for an AI miner.
- The record is intentionally **flat and small** so a `DIRECTORY.list()` scan (like `sitemap()`) can build a directory cheaply. The *full* config is one deep read away.
- **No new config schema.** Everything here is derived from `RoomSnapshot` (`edition`, `wordLength`, `maxGuesses`, `mode`) and `roomConfig`/`configHistory` (rung 00). `PresetId` is imported from rung 00.

### Components / files (exact paths)

**`src/types.ts`** — add `RoomIndexRecord` (above). No change to `RoomConfig`, `ConfigVersion`, or `RoomSnapshot`.

**`src/room.ts`**
- New private `buildIndexRecord(): RoomIndexRecord` — pure projection from `this.state` + `this.state.roomConfig` + `this.state.configHistory`. Unit-testable if extracted to `src/roomConfig.ts` (where rung 00 already puts `sanitizeRoomConfig`).
- New private `publishIndex(): Promise<void>` — `await this.env.DIRECTORY.put(\`roomconfig:${this.state.path}\`, JSON.stringify(this.buildIndexRecord()))`. Wrapped in try/catch exactly like `registerRoom()` (best-effort; a failed index write never blocks gameplay).
- Call `void this.publishIndex()` from the end of `onSetRoomConfig` and `onRevertConfig` (the rung-00 handlers) and from `registerRoom()` (so brand-new rooms appear in the index immediately, even with `roomConfig === {}`).
- **DO read handlers.** In the DO `fetch`, handle `?config=1` → `Response.json({ path, edition, roomConfig: this.state.roomConfig })` and `?history=1` → `Response.json({ path, configHistory: this.state.configHistory })`. Both redact nothing (configs are open; they contain no `word` and no PII beyond the kindness-model `by` username, already public via `/api/user`).

**`src/worker.ts`**
- New routes before the SPA fallback:
  - `GET /api/room/<owner>/<slug>` → resolve `roomalias:` (reuse the lines 23-30 pattern), `env.ROOM.get(idFromName(canonical)).fetch(...?config=1)`.
  - `GET /api/room/<owner>/<slug>/history` → same, `?history=1`.
  - `GET /api/themes` → `DIRECTORY.list({ prefix: "roomconfig:" })` (mirror `sitemap()`'s cursor loop, lines 96-103), parse each value, return `{ themes: RoomIndexRecord[], count }`. Optional `?sort=customLineCount|versionCount|updatedAt` and `?limit=`.
- Extend `sitemap()` minimally only if desired (the AI surface is `/api/themes`; sitemap stays SEO-only). **No change required** to existing sitemap behavior.

**`public/llms.txt` / `public/llms-full.txt`** — add a short section documenting the new machine-readable endpoints (`/api/themes`, `/api/room/<path>`, `/api/room/<path>/history`) so AI crawlers discover them, consistent with the existing `/api/user/<name>` documentation. This is the AIO/GEO hook from the global CLAUDE.md engine-optimization rules.

**`scripts/mine-theme-intel.mjs`** (NEW, sibling of `scripts/gen-word-intel.mjs`) — offline, resumable, Mac-run miner. Fetches `/api/themes`, then per-room `/api/room/<path>` + `/history`, and emits an aggregate corpus (`public/data/theme-intel.js`, format mirroring `public/data/word-intel.js`'s static-ES-module shape) of reusable line banks, preset popularity, and palette ideas. **Generation only** — it does not write back to any room. This is the concrete tie-in to the word-intel roadmap (see below).

### Data flow

**Publish (write):**
1. A present player sends `set_room_config` / `revert_config` (rung 00). The rung-00 handler validates, merges, appends a `ConfigVersion`, `pushSystem`s, and `persistAndBroadcast`s.
2. **Rung 5 appends one step:** `void this.publishIndex()` after `persistAndBroadcast`. It projects the current state to a `RoomIndexRecord` and writes `roomconfig:<path>` to KV. Fire-and-forget; failures log and are dropped (the live game already has the truth in the DO).
3. `registerRoom()` also calls `publishIndex()` so the index exists from room creation, not only after the first config edit.

**Enumerate (AI browse):**
1. AI fetches `GET /api/themes` → worker does a KV `list({ prefix: "roomconfig:" })` scan, returns the array of `RoomIndexRecord`s.
2. AI picks interesting rooms (e.g. `customLineCount > 0`, sort by `versionCount`) and fetches `GET /api/room/<path>` for the full `roomConfig`, and `/history` for the full `ConfigVersion[]` lineage.
3. The offline miner (`mine-theme-intel.mjs`) does the same loop locally and writes the aggregate corpus.

### Tie-in to the word-intel roadmap

The word-intel roadmap (memory `wordul-i18n-and-word-intel`; `scripts/gen-word-intel.mjs` → `public/data/word-intel.js`) already establishes the pattern this rung reuses verbatim:

- **Same generator shape.** `mine-theme-intel.mjs` mirrors `gen-word-intel.mjs`: resumable, idempotent, writes after each unit, static-ES-module output. Where word-intel keys on a word → `{def, fact, quote, author}`, **theme-intel keys on a config fingerprint → reusable creative material** (top custom line banks per event, most-forked presets, palette/font ideas once those sections ship).
- **Same delivery format.** `public/data/theme-intel.js` exports a map + a lookup (`themeIntel(presetOrEvent)`), parallel to `WORD_INTEL` / `wordIntel(word)`. It can later seed the **preset registry** itself — community-discovered line banks promoted into `PRESETS` (rung 00).
- **The index is the corpus.** Today word-intel's corpus is the answer pool (`src/wordsbysize.ts`); theme-intel's corpus is `/api/themes`. Both are crawlable by the same class of Claude-powered batch script, both surface to users as "make you smarter" content (word card today; a future "themes others built" gallery).
- **AI discoverability of both is unified** under `llms.txt`: word lookups, user profiles, and now theme/version endpoints all listed in one place.

### Error handling

- **KV write failure in `publishIndex()`** — caught and logged (like `registerRoom()`); never throws into the game loop. The index is eventually-consistent; the DO read API is always authoritative, so a stale/missing KV record degrades enumeration completeness, not correctness.
- **`/api/room/<path>` for a non-existent room** — the DO `fetch` returns the room in its default (lobby) state; for AI purposes that's a valid "empty theme." A truly never-registered path simply won't appear in `/api/themes` (no KV record). No 404 special-casing needed beyond the existing bad-username/bad-path guards (`worker.ts` lines 20-21, 36).
- **Malformed KV value in `/api/themes`** — wrap each `JSON.parse` in try/catch; skip unparseable entries (forgiving enumeration, never a 500 for the whole list).
- **`roomalias:` resolution** — reuse the exact `??` fallback from `worker.ts` line 26 so renamed rooms resolve to the canonical DO.

### Testing approach

- **Pure `buildIndexRecord`** (extracted to `src/roomConfig.ts`): Vitest suite — projects edition/preset/talkativeness/version counts correctly; `customLineCount` walks nested `voice.lines` banks and counts `{replace:[...]}` by array length; empty `roomConfig` → `hasVoiceOverride:false, customLineCount:0`.
- **`/api/themes` aggregation** — unit-test the parse-and-skip-malformed loop with a fake KV list (skip bad JSON, honor `sort`/`limit`).
- **Route resolution** — assert `/api/room/<renamed-slug>` resolves through `roomalias:` to the canonical path (same contract `/ws` relies on).
- **Manual smoke** (no CI): create a room, set a preset, edit lines, `revert_config`; then `curl /api/themes`, `/api/room/<path>`, `/api/room/<path>/history` and confirm the index reflects every change. Document in `/smoke-test`.

---

## Non-goals (deferred / owned elsewhere)

- **The `roomConfig`/`ConfigVersion`/persistence/protocol themselves.** Owned by **rung 00**; this rung only projects and exposes them. If `RoomConfig` gains a section (palette/rules/creature), `RoomIndexRecord` gains a matching fingerprint field *in this rung's owning edit*, not in rung 00.
- **Privacy / private-room scope controls.** Configs are open by default (vision). A future `roomConfig.visibility` (or a `private:1` KV flag that excludes a room from `/api/themes`) is a separate rung — call it the **scope/visibility rung**. This rung assumes open.
- **Personal defaults / fork-to-my-default.** The `userDefault` merge layer and User DO `defaultRoomConfig` are owned by the **personal-defaults rung** (rung-00 dependency table). A user's *personal* default is not published here — only *room* configs are indexed.
- **The editor UI and version-history browser.** Owned by the **editor UI (rung 03)** rung (which folds in the read+revert version timeline). This rung is server/API + an offline script, no in-app UI beyond the `llms.txt` doc lines.
- **Voice render of mined/custom lines.** Still "Part C" (golden-voice remote render), out of scope per rung 00. Mined custom lines fall back to `speechSynthesis` until rendered.
- **Promoting mined banks into `PRESETS` automatically.** The miner *emits* candidate material; curating it into rung-00's `PRESETS` registry is a human/curation step (or a later rung), not an auto-write.
- **DESIGNS R2 as a theme gallery.** The exploration floats `designs/manifest.json` for prototypes; theme configs use `DIRECTORY` KV (the enumerable fan-out for *live* rooms), not R2 (which serves static design-ritual HTML). Reserved if a static published-theme export is ever wanted.

## Open questions

1. **KV write amplification.** `publishIndex()` fires on every `set_room_config`. A rapid editor session (slider drags) could spam KV writes. Debounce in the DO (coalesce to the last write per N seconds), or only publish on preset-pick/revert (matching rung-00 open-question #4's "chat on preset + revert only")? Leaning: publish on the same events that `pushSystem` — i.e. piggyback rung 00's debounce decision.
2. **`/api/themes` at scale.** A full KV list scan is fine for hundreds of rooms (today's scale) but unbounded long-term. Add `?limit`+cursor pagination now (cheap) and revisit a materialized aggregate later? Leaning: paginate from day one.
3. **Should `RoomIndexRecord` embed a config hash** (FNV-1a like `voice-key.js`'s `lineKey`) so the miner can dedupe identical themes cheaply across rooms? Low cost, high value for the miner. Leaning yes — reuse `public/voice-key.js`'s hash, mirrored server-side.
4. ~~**Open-by-default confirmation (Yan).**~~ **RESOLVED (Yan, 2026-06-02).** `/api/themes` exposes every room's config + author usernames with no auth. This is confirmed intended — consistent with the existing public `/api/user`. Authorship enumeration is desired.

## Locked decisions

1. **Two surfaces:** `DIRECTORY` KV (`roomconfig:<path>`) for cheap enumeration; Room DO GET routes for authoritative deep reads. KV is a denormalized cache, DO is truth.
2. **One new type:** `RoomIndexRecord` (a projection, not a schema change). No edits to rung-00's `RoomConfig`/`ConfigVersion`.
3. **Publish is additive and best-effort:** `void publishIndex()` appended after the existing `persistAndBroadcast`, wrapped in try/catch like `registerRoom()`. Never blocks the game.
4. **Read API mirrors existing patterns:** `/api/room/<path>` resolves `roomalias:` exactly like `/ws`; returns the live `roomConfig`/`configHistory` straight from the DO, same as `/api/user` returns the `UserProfile`.
5. **Open by default:** no auth on reads; consistent with `/api/user/<name>` already being public.
6. **Word-intel tie-in is by mirroring, not coupling:** `mine-theme-intel.mjs` + `public/data/theme-intel.js` reuse the `gen-word-intel.mjs` / `word-intel.js` shape (resumable generator → static ES module); the two corpora stay independent files but share format, delivery, and the `llms.txt` discovery surface.
