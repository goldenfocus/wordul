# Room Sandbox — Personal Defaults + Discovery & Forking (Rung 6)

**Date:** 2026-06-02
**Status:** Draft for review
**Part of:** Room Sandbox ladder — **rung 6**. The social/forking layer. Adds the `userDefault` merge layer (reserved in rung 00), a per-user `defaultRoomConfig` persisted in the User DO, the "try → stick → fork → invite → evolve" loop, and a discovery surface for browsing popular/recent room themes.

> **Citation rule (rung 00).** This spec **consumes** the canonical `RoomConfig` schema, the `mergeConfig` precedence chain, `ConfigVersion`, and `PRESETS`/`resolvePreset` from `docs/superpowers/specs/2026-06-02-room-sandbox-00-architecture-design.md`. It does **not** redefine them. It activates the `userDefault` layer the keystone reserved (precedence line: `editionDefault ← roomOverride ← userDefault ← session`).

> **Numbering note (resolved).** An earlier rung-00 dependency table draft listed "05 personal defaults". The keystone table has been corrected: rung 05 is **AI-browsable theme & version intel** and rung 06 (this spec) is **personal defaults + discovery/forking** folded together. The numbering across all seven docs now agrees. (Splitting discovery into its own rung 07 remains an option — see Open questions.)

---

## Problem

Rungs 00–04 give a room a versioned, forkable `roomConfig` that any present player can edit — but the config is **trapped in the room**. The moment you leave, your carefully-tuned Gremlin vibe is gone; the next room you open is back to the bare edition default. Today the only per-user state that travels is implicit: localStorage values (`wr.username`, `wr.length`, `wordul.edition`, `wr.settings`) that happen to ride the `hello` message. There is **no per-user config field anywhere** (client or server) — the User DO `UserProfile` (`src/user.ts`) has `stats`, `games`, `ownedRooms`, `ledger`, `balances`, and nothing for preferences.

The vision asks for the opposite: a default that **follows you**. Try a room's settings, decide you like them, **stick to one as your default**; **fork** any room (or any historical version) into your own default, edit it, and have it seed every new room you create; **invite friends** into your configured room; and **evolve your default** as you discover new themes. None of that exists, and the discovery half — a way to **find** themes worth forking (browse popular/recent rooms) — has no surface either; rooms are only reachable by direct URL today.

## Goal

Activate the **`userDefault` merge layer** with minimal new plumbing:

1. **Persist** an optional `defaultRoomConfig: RoomConfig` on the User DO `UserProfile`, written via the first client-callable User-DO write endpoint (`PUT /api/user/<name>/config`), validated server-side with the rung-00 `sanitizeRoomConfig`.
2. **Carry** it into rooms through the existing `hello` seam — the user default seeds a pristine lobby exactly like edition/mode/length do, and merges as the `userDefault` layer in `mergeConfig` for live resolution.
3. **Loop:** "Use as my default" (stick), "Fork to my default" (copy a room or a `ConfigVersion` into your default, then edit), and an invite link to your configured room — all client-side flows over the one PUT endpoint plus the existing room messages.
4. **Discover:** a browse surface listing popular/recent room themes built from the existing `DIRECTORY` KV (the same index that backs the sitemap), so there is something to fork in the first place.

Keep the rung-00 **default-preserving guarantee** intact: a user with no `defaultRoomConfig` behaves byte-for-byte as today.

---

## Design

### Architecture

```
                         (new this rung)
public/userDefault.js  ──┐   pure-ish helpers: forkFrom(config|version) → RoomConfig (strips `by`/`v`),
  forkFrom()             │   applyAsDefault() (PUT), loadDefault() (GET+cache), isDefaultDirty()
                         │
                         ├── consumed by ──► public/app.js   (hello seeds roomConfig=userDefault; "Use/Fork
                         │                                     as my default" buttons; invite link)
                         │                   public/settings.js (Companion&Vibe gets "★ Make this my default"
                         │                                       + "based on …" provenance row)
                         │                   public/discover.js (NEW: /discover page — popular/recent themes)
                         │
src/user.ts             ── PUT /config handler: sanitizeRoomConfig → profile.defaultRoomConfig → put
src/worker.ts           ── route PUT /api/user/<name>/config; GET /discover (HTML) + /api/discover (JSON)
src/types.ts            ── UserProfile gains `defaultRoomConfig?: RoomConfig`
src/roomConfig.ts       ── reuses rung-00 sanitizeRoomConfig (no new validator)
```

- **The User DO stays the home of "you".** `defaultRoomConfig` lives on the existing `profile` blob next to `stats`/`ownedRooms`. No new storage key — it is small (one override delta, capped by rung-00 `CONFIG_CAPS`), unlike `configHistory` which (per rung-00 risk #4) stays room-side only. **There is no per-user version history** — your default is a single living config; its provenance is the room/version you forked from, recorded in the `preset` field and a `forkedFrom` label.
- **Client resolves, server validates.** Same split as rung 00. The User DO sanitizes the incoming blob (the first client-writable User-DO endpoint — exploration risk #2) and stores the delta; `mergeConfig` on the client folds it in as the `userDefault` layer.
- **Discovery reads the existing index.** `DIRECTORY` KV already holds `room:<path>` keys (written by `room.ts registerRoom`, listed in `sitemap()` at `worker.ts`). The discover surface lists those rooms; it does **not** add a new write path or a second index in this rung (see Non-goals for the AI-browsable richer index).

### Components / files (exact paths)

**`src/types.ts`** — one field on the existing `UserProfile`:
```ts
export type UserProfile = {
  // …existing: username, createdAt, stats, games, ownedRooms, ledger, balances…
  defaultRoomConfig?: RoomConfig;   // the user's saved default override (rung-00 RoomConfig). Absent = no default.
};
```
No new top-level type — `RoomConfig` is rung 00's. The `hello` message already gained optional `roomConfig` in rung 00; this rung populates it from the user default rather than from room seed-only.

**`src/user.ts`** — new handler in `fetch()`, mirroring the existing `POST /room` shape exactly:
```ts
if (req.method === "PUT" && url.pathname.endsWith("/config")) {
  const incoming = (await req.json()) as RoomConfig;
  const profile = await this.load(username);
  profile.defaultRoomConfig = sanitizeRoomConfig(incoming);   // rung-00 validator, imported from src/roomConfig.ts
  await this.ctx.storage.put("profile", profile);
  return Response.json({ defaultRoomConfig: profile.defaultRoomConfig });
}
```
A `DELETE …/config` (or `PUT {}`) clears it back to "no default". `load()` needs **no** self-heal shim — `defaultRoomConfig` is optional, so old profiles read it as `undefined`, which `mergeConfig` treats as "fall through" (exploration risk #7).

**`src/worker.ts`** — extend the existing `/api/user/` block to route by method (today it is GET-only, line 34–39). Add `PUT … /config` → forward to the User DO; reuse `isValidUsername` guard. Add the discovery routes:
- `GET /api/discover?sort=recent|popular&limit=N` → JSON list of `{ path, name, owner }` built from `DIRECTORY.list({ prefix: "room:" })` (the same call `sitemap()` makes).
- `GET /discover` → serves the `public/discover.html` shell (static; the page fetches `/api/discover`).

**`public/userDefault.js`** (NEW, pure-ish — DOM-free helpers, localStorage cache only):
- `forkFrom(source) → RoomConfig` — accepts a live `roomConfig` **or** a `ConfigVersion`; returns a clean `RoomConfig` (drops version-only fields `v`/`at`/`by`/`parent`; keeps `preset`; stamps a `forkedFrom` provenance into a label the editor shows). This is the FORK primitive.
- `applyAsDefault(username, config)` → `PUT /api/user/<name>/config`; on success updates the localStorage cache (`wordul.defaultConfig`).
- `loadDefault(username)` → `GET /api/user/<name>` (already returns the full profile JSON) and caches `defaultRoomConfig`. Called once on app load alongside the existing profile fetch.
- `getCachedDefault()` → the cached blob for the synchronous `hello` send.
- `isDefaultDirty(roomConfig, defaultConfig)` → shallow compare to drive the "★ Make this my default" button's enabled/active state.

**`public/app.js`** — three wiring changes:
1. On WS open, the `hello` payload's `roomConfig` is set from `getCachedDefault()` (rung 00 left it room-seed-only). The DO already gates seeding to `phase === "lobby" && round === 0 && username === owner`, so your default only seeds rooms **you** open fresh — never clobbers an in-progress room (exploration risk #5, by design).
2. After the snapshot is merged, `mergeConfig(editionDefault, snapshot.roomConfig, userDefault)` — the `userDefault` layer is now passed (rung 00 implemented only the first two args; the function is already variadic).
3. Surface the **loop** controls (see Data flow): "★ Use as my default" and "Fork to my default" in the Companion & Vibe section, and an "Invite to my room" share affordance.

**`public/settings.js`** — in the existing "Companion & Vibe" chevron section: a `★ Make this my default` row (calls `applyAsDefault(username, effectiveRoomOverride)`), a provenance line ("based on Gremlin · forked from @ana/spooky"), and a `Reset my default` action. No new chevron-section machinery — `wireSectionToggles` already covers it.

**`public/discover.js` + `public/discover.html`** (NEW) — the discovery surface: fetch `/api/discover`, render a card grid of rooms (name, owner, "Open" + "Fork this vibe"). "Fork this vibe" opens the room (or pulls its `roomConfig` from the snapshot on join) and calls `forkFrom` → `applyAsDefault`. SEO/AEO per global rules: server-rendered title/meta/OG + `ItemList` JSON-LD for the room list; descriptive card alt text.

### Data flow — the five vision verbs

| Verb | Flow |
|------|------|
| **Try a room's settings** | Join any room; `snapshot.roomConfig` arrives via existing broadcast and is merged for the session. Nothing persisted — pure rung-02 behavior. |
| **Stick (use as default)** | In Companion&Vibe tap **★ Make this my default** → `applyAsDefault(username, snapshot.roomConfig)` → `PUT /config`. Now every new room you open seeds with it. |
| **Fork → edit → it's yours** | From a room **or** a `ConfigVersion` (rung-03 version timeline) tap **Fork to my default** → `forkFrom(source)` strips version metadata, sets it as a working override you then edit with the rung-03 editor; `applyAsDefault` persists the edited result. |
| **Invite friends to your room** | You open a fresh room → your default seeds it (hello path) → you (or rung-03's editor) tweak → **Invite** copies the room URL (`/@you/<slug>`, the existing owner-nested path). Friends joining merge your `roomConfig` over their own edition for the session. |
| **Evolve your default** | Discover a new theme → fork it → tweak → re-`applyAsDefault`. Your default is a single living config; the room you forked from is recorded as provenance, not version history. |

**Merge resolution at runtime (rung-00 chain, now 3 layers):**
```
mergeConfig(editionDefault, snapshot.roomConfig, userDefault)
            ▲ baseline       ▲ what THIS room set   ▲ your saved default (rung 6, opt-in for guests)
```
**Precedence (LOCKED, Yan 2026-06-02):** When you JOIN a room, you see the HOST's vibe (room config) by default. Each guest gets a personal **"switch to my vibe"** opt-in toggle that locally applies their own personal default (a client-side/session override of the personal-experience parts — e.g. companion voice/chattiness — without changing the room for others). The `userDefault` layer is passed into `mergeConfig` only when this toggle is on (or for rooms the guest owns, where their default seeded the room). See **Locked decision 1**.

**Seed vs. live (the precedence subtlety, resolved):**
- **Seeding a fresh room you own** (`hello`, round 0): the server writes your `userDefault` *as* the room's `roomConfig`. From then on it's a room override like any other — editing it in-room is editing the room, not your default (until you re-`★`). This is where "your default follows you" actually takes effect.
- **Visiting someone else's room (toggle OFF — default):** you do **not** send your default as a seed (the owner gate already blocks it). For live resolution you call `mergeConfig(editionDefault, snapshot.roomConfig)` **without** the user-default layer — the host's vibe is what everyone hears. Your default is dormant.
- **Visiting someone else's room (toggle ON — "use my vibe"):** the `userDefault` layer is passed as the third arg. This locally applies your personal-experience parts (e.g. talkativeness, companion chattiness) without changing the room config for others. The room's lines/priority/events still win per section fall-through.

The variadic `mergeConfig` is the mechanism; the call site decides whether to pass the layer. Documented as Locked decision 1.

### Error handling

- **Old profile, no `defaultRoomConfig`:** `undefined` → `getCachedDefault()` returns `{}` → `hello` sends no seed → pure edition default. The regression contract holds.
- **PUT with a junk/oversized blob:** `sanitizeRoomConfig` (rung 00) strips unknown keys, clamps banks/lines to `CONFIG_CAPS`, clamps `talkativeness`. Never rejects — forgiving, per the vision. The endpoint is the first client-writable User-DO route, so validation is mandatory (exploration risk #2).
- **Unauthenticated writer:** the User DO has no auth (anyone knowing a username can PUT). For rung 6 this matches the existing kindness model and the unauth profile reads; the blast radius is "someone sets your default vibe," recoverable in one tap. A real auth gate is a cross-cutting Non-goal (cite: economy/auth rung). Flagged, not solved.
- **Stale `ownedRooms` slug in discovery / invite:** the known existing bug (exploration risk #3) — a renamed room can have a stale slug in `ownedRooms`; the discover list reads `DIRECTORY` `room:<path>` keys (canonical-ish) rather than `ownedRooms`, sidestepping it for browse. Invite links use the room's **current** snapshot `slug`, not the cached one.
- **Discovery list empty / KV slow:** `/api/discover` returns `[]` and the page shows an empty-state ("No public rooms yet — make one!"). Never errors.

### Testing approach

- **Vitest (pure):** `userDefault.js` — `forkFrom` strips `v/at/by/parent`, preserves `preset`, stamps `forkedFrom`; `forkFrom` accepts both a `RoomConfig` and a `ConfigVersion`; `isDefaultDirty` shallow-compare matrix.
- **Vitest (merge contract):** with the new layer — `mergeConfig(editionDefault, {}, userDefault)` applies the user default where the room is absent; `mergeConfig(editionDefault, roomOverride, undefined)` (guest path) ignores the missing layer; **default-preserving regression** still passes with the third arg `undefined`.
- **Server handler (thin pure extraction or documented smoke):** `PUT /config` sanitizes + persists; `GET /api/user/<name>` returns `defaultRoomConfig`; clearing via `PUT {}`/`DELETE`.
- **Manual smoke (post-deploy):** set default in room A → open fresh room B → confirm B seeds with it; join a stranger's room → confirm your default does **not** override their vibe; `/discover` lists recent rooms and "Fork this vibe" lands the config as your default.

---

## Non-goals (deferred to other rungs)

- **The `session` merge layer** (ephemeral "just for me right now" tweaks) — rung-00 reserved 4th layer; not implemented here.
- **Per-user version history of your default.** Your default is a single living config (provenance only). A versioned personal config is out of scope; the room owns history (rung 02 `configHistory`, browsed in rung 03).
- **AI-browsable theme index** (KV/R2 fan-out, richer `/api/room/<path>` with config payloads for mining) — owned by **rung 05** (AI-browsable theme & version intel). Rung 6's discovery reads only the existing `DIRECTORY room:<path>` keys (name/owner), **not** the configs; rung 05's `/api/themes` + `roomconfig:<path>` index is the richer surface.
- **Real auth on User-DO writes.** The PUT endpoint inherits today's no-auth kindness posture; a true identity gate is cross-cutting (cite the economy/two-token rung `docs/superpowers/specs/2026-06-02-secured-two-token-economy-design.md`, which is where auth pressure already lives — and any economy section of `RoomConfig` is **Tier A / Sacred**).
- **"Popularity" signal beyond recency.** `popular` sort needs a play-count or join-count metric that does not exist yet; rung 6 ships `recent` (KV insertion order) and stubs `popular` to alias `recent` until a metric lands.
- **Cross-device edition/length sync.** Moving `wordul.edition`/`wr.length` into the User DO (exploration risk #6) is a tempting adjacent win but a separate change; rung 6 touches only `defaultRoomConfig`.
- **Theming / rules / creature sections of the forked config** behave per their own rungs; rung 6 forks whatever sections exist (voice today) without special-casing them.

## Open questions

1. **Rung numbering (now resolved in-doc).** The keystone table has been corrected so rung 05 = AI-browsable intel and rung 06 = personal defaults + discovery/forking (this doc). Remaining choice: keep defaults + discovery together as 06 (current), or split discovery into its own 07. Leaning: keep together as 06.
2. ~~**Default-as-seed vs. default-as-live-layer.**~~ **RESOLVED (Yan, 2026-06-02).** Guests see the host's vibe by default. Each guest gets a **"switch to my vibe"** opt-in toggle that locally applies their personal default (personal-experience parts only) without changing the room for others. Seed-only for owned rooms, opt-in layer for guests. See merge resolution above and Locked decision 1.
3. **Invite affordance.** Just copy-link, or generate a share card / QR (ties into the no-buyer-left-behind + VEO goals)? Leaning: copy-link now, share card later.
4. **Clearing the default.** `PUT {}` vs. a dedicated `DELETE /config` — cosmetic; leaning `DELETE` for intent clarity.

## Locked decisions

1. **Personal-default precedence: host vibe by default, "switch to my vibe" opt-in for guests (LOCKED, Yan 2026-06-02).** When you join a room, you see the HOST's vibe by default. Each guest has a **"switch to my vibe"** toggle that locally applies their personal default to personal-experience parts (e.g. companion chattiness) without changing the room for others. The `userDefault` layer is passed into `mergeConfig` only when this toggle is on. For rooms you own and open fresh, your default seeds `roomConfig` (becomes a normal room override). The host's `roomConfig` is authoritative for all guests by default — no guest silently overrides a host. No change to the keystone's `mergeConfig` layer order; the call site decides whether to pass the layer.
2. **One field, on the existing profile blob.** `UserProfile.defaultRoomConfig?: RoomConfig`, stored in the `profile` key — no new storage key, no personal version history. Small by `CONFIG_CAPS`.
3. **One new write endpoint:** `PUT /api/user/<name>/config` (first client-writable User-DO route), validated by rung-00 `sanitizeRoomConfig`. Clearing via `DELETE`/`PUT {}`.
4. **`forkFrom` is the single fork primitive** — accepts a live `roomConfig` or a `ConfigVersion`, returns a clean `RoomConfig` (drops version metadata, keeps `preset`, stamps `forkedFrom` provenance). Used by both "Fork to my default" and discover's "Fork this vibe".
5. **Discovery reads only the existing `DIRECTORY room:<path>` index** (name/owner). No new index, no config payloads in browse. `recent` ships; `popular` aliases `recent` until a metric exists.
6. **Regression contract preserved:** a user with no `defaultRoomConfig` is byte-for-byte today's behavior; enforced by test with the third `mergeConfig` arg `undefined`.
7. **Kindness/no-auth posture inherited.** The PUT endpoint matches today's unauthenticated User-DO reads; recoverable in one tap; real auth is a cross-cutting Non-goal.

---

## Dependency note — what rung 6 needs from earlier rungs

| Needs | From |
|-------|------|
| `RoomConfig`, `ConfigVersion`, merge chain, `sanitizeRoomConfig`, `CONFIG_CAPS`, `PRESETS`/`resolvePreset` | **rung 00** (keystone) |
| `mergeConfig` already variadic; `hello.roomConfig` seam; owner/round-0 seed gate | **rung 00 / 02** |
| `snapshot.roomConfig` broadcast (so "Try" and "Fork from a live room" work) | **rung 02** |
| Companion & Vibe editor section + provenance display (host the ★/Fork rows) | **rung 03** |
| `ConfigVersion` history view (so "Fork from a version" has a source) | **rung 03** (version timeline) — soft dep; forking from a live room works without it |
