# Wordul Accounts — Design (continuity-claim identity + the 6-word wordul-passphrase)

**Status:** design spec, ready for implementation-planning. No code shipped yet.
**Why now:** the Vibe Studio (`/vibe-studio`) lets anyone author a themed day; the next goal is to let
**anyone publish their authored "worlds" into their own profile** (`/@username/worduls`) and have people
play them. Persistent, public, named content + permanent leaderboards needs an **ownership layer** the
current passwordless "kindness model" can't provide. This spec is **P0 — the identity keystone** that the
worlds feature is built on.

**Cites (does not redefine):**
- The `User` Durable Object + `UserProfile` (`src/user.ts`, `src/user-core.ts`, `src/types.ts:8-19`).
- Room identity + `hello` handshake (`src/room.ts` `onHello` ~L301, `registerRoom` ~L486).
- Username normalization (`src/identity.ts`).
- KV `DIRECTORY` registry + slug aliasing (`src/worker.ts:49-55`, `src/room.ts:486-499`).

---

## North star (the broader vision, for context)

Anyone authors a **world** — a themed Wordle game (a word, a palette/colorScheme, a vibeTitle, a story, a
voice) — in the Vibe Studio and **publishes it into their profile** at `/@username/worduls`, where others
**play, edit, showcase, fork** it. A world with a fixed word plays like a **per-creator "word of the day"**:
one-time play, **permanent scores**, a leaderboard — playable **solo, 1v1, or pushed into Arena**. A world is
just a **generalization of the daily `World`** (the daily is "the admin's world scheduled to a date"), so it
reuses the existing `World` type, the `seedDailyIfNeeded` room-seed path, daily-style per-player-once scoring,
the Arena open-games index, and `/@user/slug` rooms.

### The decomposition (each its own spec → plan → build)

| # | Sub-project | Delivers |
|---|---|---|
| **P0** | **Accounts / identity** *(this spec)* | Secure a username (continuity-claim + 6-word wordul-passphrase), session tokens, the `claimed` flag, the claiming transition, rate-limiting, public directory projection. |
| P1 | World store + ownership | Persistent per-user worlds: id/slug, creator, config, owner-gated CRUD. |
| P2 | Publish from Vibe Studio | Wire the inert "Submit my day" seam → save a world to your profile. |
| P3 | Showcase at `/@user/worduls` | The collection page: play / edit / showcase cards. |
| P4 | Solo play a world | Seed a Room from a world; fixed-word = one-time permanent scores + per-world leaderboard. |
| P5 | 1v1 + Arena propagation | Host a world as a challenge / surface it as a waiting Arena room. |
| P6 | Set as default theme | Pick a world as your profile's chrome/default. |
| P7 *(later)* | Daily promotion + admin-edit-all | Promote a world to Wordul of the Day; admin edits anyone's. |

**This spec is P0 only.** P1–P7 are out of scope here and get their own specs.

---

## Goal of this spec (P0)

Give a username a **secret it can prove ownership with**, without passwords, email, or a third-party auth
vendor — so that the *worlds* feature (P1+) can gate publishing/editing on real ownership. Concretely:

1. **Continuity-claim** — secure the session you're already playing in, not a login screen.
2. **The 6-word wordul-passphrase** — `wordul` + 5 random game-words, shown once, re-rollable, **hash-only on
   the server**.
3. **Session tokens** — the browser proves it's the owner with a bearer token (multi-device, revocable),
   never by re-sending the passphrase.
4. **The `claimed` flag + transition rules** — a username is `open` (kindness model, today) or `claimed`
   (secured); claiming is opt-in and only *required* to publish persistent worlds.
5. **Anti-abuse floor** — rate-limited claim/login; reserved-name blocklist.
6. **Public directory projection** — `/@username` renders `claimed`/`verified` fast without secrets.

It also **writes down one forward invariant** the worlds slice (P4) must honor: **server-validated scores
with a per-world answer that is not client-derivable before solve.**

---

## Non-goals (deferred — keep OUT of P0)

- **The worlds themselves** (store, publish, showcase, play) — P1–P4.
- **OAuth / email / passkey** as credentials — these are **opt-in *upgrade* layers** added *after* claim
  ("🔒 secure your account → add a warm backup"); P0 ships the recovery-key floor only, but the account
  record is shaped so they bolt on later (`auth.methods`).
- **Email sending** (self-email the passphrase, magic links) — needs a transactional provider (Resend);
  later, alongside email-as-backup.
- **World export / fork / transfer, signed worlds, creator economy** — later phases.
- **"Verified creator" badge logic** beyond reserving the `verified` projection field.
- **Account merge across two different usernames** — out of scope; world *transfer* (later) covers the real
  need.
- **Forcing migration** — the kindness model stays the default for casual play **forever**. Securing is opt-in.

---

## Decisions (locked)

Converged through live design discussion. The plan implements these.

### Identity model
- **`@username` is the public handle** (the "who"); the **6-word wordul-passphrase is the secret** (the
  "proof"). Keypair mental model: public username + secret phrase.
- **Continuity-claim is the happy path.** The device already playing as `@zang` taps **"🔒 secure this
  account"** → gets a passphrase → done. **No login screen, no password field on the happy path.**
- **Kindness model preserved.** Casual play needs no account. An *unauthenticated* `hello` still works; it
  just can't edit a *claimed* username's worlds.

### The 6-word wordul-passphrase
- **Shape:** `wordul · <5 random game-words>` — e.g. `wordul · amber · otter · glides · past · meadow`. Reads
  like a line of wordul poetry; memorable; on-brand.
- **`wordul` is a fixed anchor** — branding/memorability only; it contributes **zero** security (it's known).
  All entropy lives in the 5 random words.
- **The 5 words are RANDOM — never derived from the username.** The phrase may *feel* personal but must not be
  *derivable*, or seeing `@zang` would leak `@zang`'s key. (Hard rule.)
- **System-generated, re-rollable.** Tap **🎲** for another until one sings. Never user-chosen (user-chosen
  passphrases reintroduce the weak-credential problem for zero product gain).
- **Shown once.** We store **only the hash** (see Architecture); we cannot show it again or reset it.
- **Word list:** a curated, friendly, family-safe list of real words (game-vocabulary flavored). Size and word
  count are tuned together (Open items) for entropy; 5 random words is comfortably strong given the no-offline
  threat model below.

### Threat model → why this is enough
- The passphrase **hash never leaves the server** (lives in the `User` DO). There is **no offline brute
  force** — an attacker can only guess by hitting our API, which is **rate-limited**. So entropy requirements
  are far lower than a crypto seed phrase; 5 random words + rate-limiting is strong.
- Hashing: **WebCrypto PBKDF2-SHA256** (`crypto.subtle.deriveBits`), per-account random salt. (scrypt/argon2
  are **not** in Workers WebCrypto — do not reach for them; PBKDF2 over a high-entropy phrase is the
  pragmatic, supported choice.)

### Sessions
- On claim/login, mint a **random 32-byte session token**; store **only its SHA-256 hash** in the DO; hand the
  raw token to the browser (localStorage; httpOnly cookie if/when a fetch login path is added).
- The browser presents the token; the DO checks `sha256(token) ∈ sessions`. This replaces "trust the username
  string" with "trust a bearer token that maps to this username."
- **Multi-device:** many sessions, each labelled (device/created/lastSeen), each **individually revocable**
  ("log out other devices").

### The `claimed` flag + claiming transition
- A username is **`open`** (today) or **`claimed`** (has an `auth` record). Publishing a persistent world (P1+)
  **requires `claimed`**.
- **Claim-by-continuity, not claim-by-form.** The strongest free ownership signal is *a device that's been
  playing as that name*. "Secure this account" is offered from an active session; an open claim *form* for an
  arbitrary name is the weaker, more abusable path and is **gated harder** (rate-limited; high-history names
  get a contest/grace window — Open items).
- **First claimer wins, but show receipts.** The claim flow surfaces the name's existing history ("X games
  since <date>") so claiming a name someone built equity in is at least visible.
- **Reserved-name blocklist** (one KV/`identity.ts` list): brand names, `admin`/`official`/`mod`/`wordul`,
  the owner's handles, profanity/impersonation-bait. Reserved names can't be claimed via the open form.
- **Unclaimed ≠ verified.** Until claimed, a name is publicly **unverified**; claimed names get the path to a
  `verified` badge (tied to a future linked OAuth). Make *claimed+verified* visibly better so incentives run
  toward securing, not squatting.

### Anti-abuse floor (P0 scope)
- **Rate-limit** claim attempts and passphrase verifications (per IP + per username) — Cloudflare Rate
  Limiting binding and/or per-key KV counters with `expirationTtl`.
- **Reserved/blocklist** check at claim (above).
- (World-publishing rate limits, reputation gating, content moderation belong to P1+.)

### Public directory projection
- KV `DIRECTORY` holds **only a public projection** per username — `{ claimed: bool, verified: bool,
  ownerSince: number }` — for fast `/@username` rendering/routing **without waking the DO and without ever
  touching secrets.** Source of truth is the DO; the projection is a cache written on claim.

### Forward invariant for the worlds slice (write it down now)
- **Server-validated scores; per-world answer not client-derivable before solve.** Permanent public
  leaderboards make a forged score a *retroactive* poison (a cheat found later invalidates a cohort of
  "permanent" scores). The DO must run the game and record the result; the world's answer must not be
  derivable client-side before solve. **Build a score-recompute/invalidation path from day one** (scores
  reference the validating-logic version). This is a *constraint on P4*, surfaced here so it is not forgotten.
  (Same bug class as the known daily-word-derivable-from-client-data flag.)

---

## Architecture & integration

### Where the credential lives — extend the `User` DO (not a new Account DO)
The `User` DO is already keyed by username, already the single-writer authority for it, already holds
`ownedRooms`. DOs are single-threaded, so the **claim transaction is race-free with no lock.** A separate
`Account` DO would force a two-DO consistency dance for zero benefit at this scale. **Add auth to the existing
`UserProfile`.**

Additive, optional fields on `UserProfile` (`src/types.ts:10-19`) — every existing profile stays valid:

```ts
interface UserProfile {
  // …existing…
  claimed?: boolean;                 // false/absent = kindness model; true = secured
  auth?: {
    v: 1;
    salt: string;                    // per-account random salt
    phraseHash: string;             // PBKDF2-SHA256 of the 6-word passphrase
    methods?: {                      // RESERVED upgrade layers (not implemented in P0)
      google?: unknown; github?: unknown; email?: unknown; passkeys?: unknown[];
    };
    sessions: Record<string, {       // key = sha256(token)
      createdAt: number; lastSeen: number; label?: string;
    }>;
    claimedAt: number;
  };
}
```

`user-core.ts` gains the **pure** pieces (unit-tested, no crypto/IO): passphrase **generation**
(`makePassphrase(rng)` → `["wordul", w2..w6]` from the curated list), the **claim-state machine**
(`open → claimed`, idempotency, reserved-name check), **session add/prune/revoke** logic, and the **directory
projection** shape. The `User` DO (`user.ts`) wires those to `crypto.subtle` (PBKDF2 hash/verify, token hash)
and storage.

### Hashing & tokens (in the `User` DO)
- **Passphrase:** `PBKDF2-SHA256(passphrase, salt, iterations)` via `crypto.subtle.deriveBits`. Store
  `salt` + derived hash. Verify = derive again, constant-time compare. (Iteration count: Open items — high
  enough to be safe, low enough to be fast given the phrase is high-entropy.)
- **Session token:** `crypto.getRandomValues(32 bytes)` → raw token to client; store `SHA-256(token)` only.

### Endpoints (worker.ts → User DO)
Mirror the existing User-DO proxy pattern (`worker.ts:66-72` GET profile; `room.ts:486-499` POST room):
- `POST /api/account/claim` `{ username, sessionHint? }` → DO mints passphrase + session; returns
  `{ passphrase, sessionToken }` **once**. Rejects if already `claimed` or name reserved; rate-limited.
- `POST /api/account/login` `{ username, passphrase }` → verify → new session; returns `{ sessionToken }`;
  rate-limited.
- `POST /api/account/sessions/revoke` `{ sessionToken, target }` (auth'd) → revoke a session.
- `GET /api/account/me` (bearer `sessionToken`) → `{ username, claimed, verified, sessions[] }`.
- The **public projection** is read from KV on the existing `/@username` and `/api/user/<name>` paths — no
  secrets.

### Proving ownership over the websocket (forward-compat with worlds)
Extend `hello` with an **optional `sessionToken`**. The Room asks the `User` DO to validate it before granting
"this really is `@zang`" privileges (owner-only world actions in P1+). **Unauthenticated `hello` still works**
for casual play (kindness model) but cannot edit a *claimed* username's worlds. P0 ships the validation seam;
P1+ consumes it.

### What does NOT change
- Casual room play, the random-word path, editions, the daily — all untouched. P0 is purely additive: a
  username *gains the ability* to be secured.

---

## Surfaces (UI, thin in P0)
- **"🔒 Secure this account"** affordance on the profile / studio when playing as an unclaimed name → a sheet
  that: explains the keypair idea in one line, shows the generated **6-word phrase** with **🎲 re-roll** and
  copy/download, a "write this down — we can't reset it; add a backup soon" honest note, and a confirm that
  claims + opens a session.
- **Login**: enter username + 6-word phrase on a new device → session.
- **Sessions list** ("this device + others", revoke) — minimal.
- **`/@username`** shows a small **claimed/verified** marker from the projection.
- Add-a-backup (OAuth/email) is a **ghost/"coming soon" seam** in P0.

---

## Testing
- **Pure (`user-core`):** `makePassphrase` → always `wordul` first + 5 words from the list, never derived from
  username, re-roll differs; claim state machine (open→claimed, idempotent re-claim rejected, reserved name
  rejected); session add/prune/revoke; directory-projection shape; back-compat (a profile with no `auth`
  normalizes/loads unchanged).
- **DO (`user.ts`):** PBKDF2 hash/verify round-trips; wrong phrase rejected; token hashing; claim is
  single-write/race-safe; secrets never appear in the public projection or `/api/user` output.
- **Auth boundary:** unauthenticated `hello` can play but cannot edit a claimed name; valid `sessionToken`
  can; revoked token cannot.
- **Rate-limit:** claim/login throttle trips and recovers.
- **Manual smoke:** secure a name on device A → log in on device B with the phrase → same account, worlds (when
  P1 lands) present; revoke B from A.

## Build order (hand to `writing-plans` next)
1. `user-core` pure pieces (passphrase gen, claim state machine, sessions, projection) + tests.
2. `User` DO crypto + storage (PBKDF2, token hash, claim/login/sessions) + tests.
3. worker endpoints (`/api/account/*`) + rate-limit + reserved-name list.
4. `hello` session-token validation seam (consumed by worlds later).
5. Public directory projection wired into `/@username`.
6. Thin UI: "🔒 secure this account" sheet, login, sessions list, claimed marker.

## Open items
- **Word list + counts** — curate the friendly word list; pick list size × random-word-count (5) for target
  strength under the rate-limited, no-offline threat model. Confirm family-safe.
- **PBKDF2 iteration count** — pick a value (fast verify, safe given high-entropy phrase).
- **High-history name contest/grace window** — exact rule for claiming a name with significant existing play
  history (provisional claim? ping the active recent player?). Minimal first cut acceptable.
- **Reserved/blocklist source** — KV list vs `identity.ts` constant; who maintains it.
- **Rate-limit mechanism** — Cloudflare Rate Limiting binding vs KV counters with `expirationTtl`; pick one.
- **Session token transport** — localStorage only vs also httpOnly cookie; cookie needs a fetch login path.
- **Upgrade-layer shape** — confirm `auth.methods` is enough forward-room for OAuth/email/passkey later
  (linking requires an active authenticated session; unlinking the last method blocked).

## References
- Substrate map (rooms/profiles/editions/daily): this session's exploration; key files below.
- Code: `src/user.ts`, `src/user-core.ts`, `src/types.ts:8-19` (`UserProfile`/`OwnedRoom`); `src/room.ts`
  `onHello`~L301 / `registerRoom`~L486 (hello + registration); `src/identity.ts` (username normalization +
  new reserved check); `src/worker.ts:49-72` (User-DO proxy + KV `DIRECTORY` lookup); `wrangler.jsonc`
  (`DIRECTORY` KV; add a Rate Limiting binding).
- Daily contract (the world the world generalizes): `docs/superpowers/specs/2026-06-02-wordul-of-the-day-design.md`.
- Vibe Studio (the authoring surface that produces worlds): `docs/vibe-studio-v1.md`.
