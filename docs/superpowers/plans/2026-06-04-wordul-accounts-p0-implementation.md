# Wordul Accounts (P0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `@username` be *secured* with a system-generated 6-word "wordul-passphrase" (continuity-claim, no password/email), proven afterward by revocable session tokens — the ownership keystone the worlds feature (P1+) builds on.

**Architecture:** Auth lives on the **existing `User` Durable Object** (already keyed by username, single-writer → race-free claim). Pure logic (passphrase generation, claim state machine, session bookkeeping, public projection, secret-stripping) goes in a new pure `src/account-core.ts`; WebCrypto wrappers (PBKDF2 hash/verify, token mint/hash, constant-time compare) go in `src/account-crypto.ts` (no `cloudflare:workers` import → unit-testable in Node). The DO wires those to storage and exposes `/account/*` routes; `worker.ts` proxies them at `/api/account/*` with KV-counter rate-limiting; `hello` gains an optional `sessionToken` validation seam consumed later by P1.

**Tech Stack:** Cloudflare Workers + Durable Objects, TypeScript, WebCrypto (`globalThis.crypto.subtle`), KV (`DIRECTORY`), Vitest (Node env), vanilla JS client (`public/*.js`).

---

## Decisions taken for the spec's Open Items (defaults — flip any at the review gate)

These resolve the spec's 7 open items with shippable P0 defaults. Each is annotated **[mechanical]** (just pick one, no taste) or **[taste — flag]** (worth your eye before/at review).

1. **Word list + count** — **[taste — flag]** 5 random words (anchor `wordul` + 5) from a curated **120-word** family-safe nature/game-flavored list (`PHRASE_WORDS` in `account-core.ts`). 120⁵ ≈ 34.6 bits; under per-IP+per-username rate-limiting (5/min) a full sweep is ~9,000 years. List is a plain array — expand pre-launch to lift entropy. *Flag:* the word choices themselves are taste; the starter list below is a reasonable v1.
2. **PBKDF2 iterations** — **[mechanical]** `100_000`, SHA-256, 256-bit derived. <100ms in Workers; ample given the phrase is already high-entropy (no offline brute force).
3. **High-history-name grace window** — **[taste — flag]** P0 = **first-claimer-wins + show receipts** (the claim response returns the name's existing `{ games, since }` so the UI can warn). No contest/provisional mechanism in P0; reserved-list + rate-limit are the abuse floor. *Flag:* if you want a "ping the active player" grace path, it's a P0.1 add.
4. **Reserved/blocklist source** — **[mechanical]** a version-controlled `RESERVED_USERNAMES` constant + `isReserved()` in `identity.ts` (no KV round-trip on the hot path).
5. **Rate-limit mechanism** — **[mechanical]** **KV counters** on the existing `DIRECTORY` namespace with `expirationTtl` (no new wrangler binding, no config churn). Decision logic is pure-tested; the KV plumbing is integration.
6. **Session token transport** — **[mechanical]** **localStorage only** in P0 (mirrors how the username is already stored). httpOnly-cookie path deferred until a fetch-login surface needs it.
7. **Upgrade-layer shape** — **[mechanical]** keep `auth.methods` as a reserved optional object (`google/github/email/passkeys`); nothing implemented in P0, but the record is shaped so OAuth/email/passkey bolt on later.

**One deliberate deviation from the spec wording:** the spec said "user-core.ts gains the pure pieces." This plan instead puts auth in a **new** `account-core.ts` (+ `account-crypto.ts`) rather than bloating `user-core.ts`, which is the money-path (heal/ledger/h2h) module. Rationale: distinct responsibility, smaller focused files, no risk to the load-bearing ledger→balances invariant. The reserved-name check still lives in `identity.ts` exactly as the spec's option 4 prefers.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `src/account-crypto.ts` | WebCrypto wrappers: PBKDF2 hash/verify, token mint, token hash, constant-time hex compare, hex⇄bytes. No CF imports. | **Create** |
| `src/account-core.ts` | Pure: `PHRASE_WORDS`, `makePassphrase`, `validatePassphraseShape`, claim state machine (`canClaim`), session bookkeeping (`addSession`/`revokeSession`/`touchSession`), `projectDirectory`, `publicProfile` (secret-stripper), shared `AuthRecord`/`SessionMeta`/`PendingClaim` types. | **Create** |
| `src/identity.ts` | + `RESERVED_USERNAMES` set, `isReserved()`. | Modify |
| `src/types.ts` | + optional `claimed`, `auth`, `pendingClaim` on `UserProfile`; + optional `sessionToken` on the `hello` `ClientMessage`. | Modify (`:10-19`, `:103`) |
| `src/user.ts` | DO: GET strips secrets via `publicProfile`; new `/account/preview`, `/account/claim`, `/account/login`, `/account/sessions/revoke`, `/account/me`, `/account/verify-session` routes; writes the KV projection on claim. | Modify |
| `src/worker.ts` | `/api/account/*` proxy routes + `rateLimit()` (KV counter) + pure `rateLimitDecision`. | Modify |
| `src/room.ts` | `onHello` accepts `sessionToken`, validates via the `User` DO, stows `authed` on the WS attachment (off the snapshot). | Modify (`:276-277`, `:314-339`) |
| `public/account.js` | Client API + "🔒 secure this account" sheet + login + session-token storage. | **Create** |
| `public/app.js` | `LS.session`; thread `sessionToken` into the `hello` send; mount the secure/login entry points. | Modify (`:31-39`, `:1405-1413`) |
| `public/profile.js` | Render the `claimed`/`verified` marker from the projected profile. | Modify |
| `public/style.css` | Minimal styles for the passphrase sheet + claimed badge. | Modify |
| `test/account-crypto.test.ts` | Crypto round-trips. | **Create** |
| `test/account-core.test.ts` | Pure logic + invariants + secret-stripping. | **Create** |
| `test/account-routes.test.ts` | DO route-ordering mirror guard + worker rate-limit decision. | **Create** |
| `test/identity.test.ts` | + reserved-name cases. | Modify |

---

## Task 1: Profile + message types for auth (compile seam)

**Files:**
- Modify: `src/types.ts:8-19` (`UserProfile`), `src/types.ts:103` (`hello` message)

- [ ] **Step 1: Add the auth-related optional fields to `UserProfile`**

In `src/types.ts`, replace the `UserProfile` type (currently lines 10-19) with the version below. All additions are **optional** so every existing stored profile stays valid (absent `claimed` ⇒ the open "kindness model").

```ts
export type UserProfile = {
  username: string;
  createdAt: number;
  stats: UserStats;
  games: GameRecord[];     // most-recent-first, capped
  ownedRooms: OwnedRoom[];
  ledger: LedgerTx[];   // append-only token transactions; capped audit log (last 500)
  balances: Record<string, number>;  // running per-token balance; authoritative (ledger is a capped audit log)
  h2h?: Record<string, { w: number; l: number }>; // per-(human, persona) record, keyed by persona id
  // --- Accounts P0 (all optional; absent = open "kindness model" name) ---
  claimed?: boolean;            // true once secured with a wordul-passphrase
  auth?: AuthRecord;            // secret material — NEVER leaves the DO (publicProfile strips it)
  pendingClaim?: PendingClaim;  // ephemeral preview slot between preview→commit; stripped from public output
};
```

- [ ] **Step 2: Import the shared auth types at the top of `types.ts`**

Add this import alongside the other type imports near the top of `src/types.ts` (after line 6):

```ts
import type { AuthRecord, PendingClaim } from "./account-core.ts";
```

- [ ] **Step 3: Add the optional `sessionToken` to the `hello` client message**

In `src/types.ts`, replace the `hello` arm of `ClientMessage` (line 103) with:

```ts
  | { type: "hello"; username: string; wordLength?: number; mode?: RoomMode; edition?: string; scienceOptOut?: boolean; public?: boolean; sessionToken?: string }
```

- [ ] **Step 4: Typecheck (expected to FAIL — `account-core.ts` not created yet)**

Run: `npm run typecheck`
Expected: FAIL with `Cannot find module './account-core.ts'`. This proves the seam is wired; Task 3 creates the module and the error clears. (Do not commit yet — commit after Task 3 when it compiles. Proceed to Task 2.)

---

## Task 2: `account-crypto.ts` — WebCrypto wrappers (PBKDF2, tokens, constant-time compare)

**Files:**
- Create: `src/account-crypto.ts`
- Test: `test/account-crypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/account-crypto.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  hashPassphrase,
  verifyPassphrase,
  mintToken,
  hashToken,
  constantTimeEqualHex,
} from "../src/account-crypto.ts";

describe("hashPassphrase / verifyPassphrase", () => {
  it("verifies the correct passphrase and rejects a wrong one", async () => {
    const phrase = "wordul amber otter glides past meadow";
    const { salt, hash } = await hashPassphrase(phrase);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);   // 16 bytes hex
    expect(hash).toMatch(/^[0-9a-f]{64}$/);   // 32 bytes hex
    expect(await verifyPassphrase(phrase, salt, hash)).toBe(true);
    expect(await verifyPassphrase("wordul amber otter glides past river", salt, hash)).toBe(false);
  });

  it("uses a fresh salt each call (same phrase → different salt+hash)", async () => {
    const a = await hashPassphrase("wordul a b c d e");
    const b = await hashPassphrase("wordul a b c d e");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("honours an explicit salt (deterministic derivation)", async () => {
    const salt = "00112233445566778899aabbccddeeff";
    const a = await hashPassphrase("wordul a b c d e", salt);
    const b = await hashPassphrase("wordul a b c d e", salt);
    expect(a.hash).toBe(b.hash);
  });
});

describe("session tokens", () => {
  it("mints a 32-byte (64 hex char) random token", () => {
    const t1 = mintToken();
    const t2 = mintToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });

  it("hashes a token to a stable 64-hex sha256", async () => {
    const t = mintToken();
    expect(await hashToken(t)).toBe(await hashToken(t));
    expect(await hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("constantTimeEqualHex", () => {
  it("returns true only for equal-length equal strings", () => {
    expect(constantTimeEqualHex("abcd", "abcd")).toBe(true);
    expect(constantTimeEqualHex("abcd", "abce")).toBe(false);
    expect(constantTimeEqualHex("abcd", "abc")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/account-crypto.test.ts`
Expected: FAIL — `Cannot find module '../src/account-crypto.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/account-crypto.ts`:

```ts
// src/account-crypto.ts — thin WebCrypto wrappers for account auth.
// Uses globalThis.crypto.subtle, which exists in BOTH the Workers runtime and the
// Node test env — so every function here is unit-testable without a Workers pool.
// No "cloudflare:workers" import: keep it that way so the tests stay runtime-free.

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const DERIVED_BITS = 256; // 32-byte hash
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Constant-time compare of two equal-length hex strings. Unequal lengths → false fast
 *  (length is not secret). Equal lengths fold every char so timing doesn't leak position. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** PBKDF2-SHA256 over the passphrase. Returns hex salt + hex hash. Pass `saltHex` to
 *  re-derive against a stored salt (verify); omit to mint a fresh salt (claim). */
export async function hashPassphrase(
  passphrase: string,
  saltHex?: string,
): Promise<{ salt: string; hash: string }> {
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    key,
    DERIVED_BITS,
  );
  return { salt: bytesToHex(salt), hash: bytesToHex(new Uint8Array(bits)) };
}

/** Re-derive against the stored salt and constant-time compare. */
export async function verifyPassphrase(
  passphrase: string,
  saltHex: string,
  expectedHashHex: string,
): Promise<boolean> {
  const { hash } = await hashPassphrase(passphrase, saltHex);
  return constantTimeEqualHex(hash, expectedHashHex);
}

/** 32 random bytes → hex. This is the RAW bearer token handed to the client ONCE. */
export function mintToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** SHA-256 of a token → hex. Only this hash is stored server-side (the key into sessions). */
export async function hashToken(token: string): Promise<string> {
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(dig));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/account-crypto.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/account-crypto.ts test/account-crypto.test.ts
git commit -m "feat(accounts): WebCrypto wrappers — PBKDF2 hash/verify, session tokens, ct-compare"
```

---

## Task 3: `account-core.ts` — pure logic (passphrase, claim machine, sessions, projection)

**Files:**
- Create: `src/account-core.ts`
- Modify: `src/identity.ts`
- Test: `test/account-core.test.ts`, `test/identity.test.ts`

- [ ] **Step 1: Add the reserved-name list + `isReserved` to `identity.ts`**

Append to `src/identity.ts` (after `roomPath`, the last function):

```ts
/** Names that may NOT be claimed via the open form (brand, role, impersonation bait).
 *  Lowercase, already-normalized form. Maintained here in version control (no KV hop). */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "wordul", "admin", "administrator", "official", "mod", "moderator", "staff",
  "support", "help", "root", "system", "owner", "team", "wordul-team",
  "yan", "yang", "zang", "jr", "goldenfocus", "golden-focus",
  "api", "www", "mail", "null", "undefined", "anonymous", "guest",
]);

/** True when a normalized username is reserved and cannot be claimed via the open path. */
export function isReserved(username: string): boolean {
  return RESERVED_USERNAMES.has(normalizeUsername(username));
}
```

- [ ] **Step 2: Write the failing tests for `account-core` + the new `identity` cases**

Create `test/account-core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PHRASE_WORDS,
  PHRASE_ANCHOR,
  PHRASE_WORD_COUNT,
  makePassphrase,
  validatePassphraseShape,
  canClaim,
  addSession,
  revokeSession,
  touchSession,
  projectDirectory,
  publicProfile,
} from "../src/account-core.ts";
import type { UserProfile } from "../src/types.ts";

// Deterministic RNG for reproducible passphrase tests.
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function baseProfile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    username: "zang", createdAt: 1000, stats: {} as UserProfile["stats"],
    games: [], ownedRooms: [], ledger: [], balances: {}, h2h: {}, ...over,
  };
}

describe("PHRASE_WORDS", () => {
  it("is a non-trivial, de-duped, lowercase a-z list", () => {
    expect(PHRASE_WORDS.length).toBeGreaterThanOrEqual(100);
    expect(new Set(PHRASE_WORDS).size).toBe(PHRASE_WORDS.length); // no dupes
    for (const w of PHRASE_WORDS) expect(w).toMatch(/^[a-z]+$/);
  });
});

describe("makePassphrase", () => {
  it("always starts with the anchor + N words, all from the list", () => {
    const words = makePassphrase(seededRng(7));
    expect(words[0]).toBe(PHRASE_ANCHOR);
    expect(words.length).toBe(PHRASE_WORD_COUNT + 1);
    for (const w of words.slice(1)) expect(PHRASE_WORDS).toContain(w);
  });

  it("is NOT derived from any username (no username input at all)", () => {
    // The signature takes only an rng — a username can't leak into the phrase.
    expect(makePassphrase.length).toBe(1);
  });

  it("re-rolls to a different phrase", () => {
    const a = makePassphrase(seededRng(1)).join(" ");
    const b = makePassphrase(seededRng(2)).join(" ");
    expect(a).not.toBe(b);
  });
});

describe("validatePassphraseShape", () => {
  it("accepts anchor + N valid words", () => {
    const words = makePassphrase(seededRng(3));
    expect(validatePassphraseShape(words.join(" "))).toBe(true);
  });
  it("rejects wrong anchor, wrong count, or off-list words", () => {
    expect(validatePassphraseShape("nope " + PHRASE_WORDS.slice(0, 5).join(" "))).toBe(false);
    expect(validatePassphraseShape("wordul " + PHRASE_WORDS.slice(0, 4).join(" "))).toBe(false);
    expect(validatePassphraseShape("wordul aaaa bbbb cccc dddd eeee")).toBe(false);
  });
});

describe("canClaim", () => {
  it("allows claiming an open, valid, non-reserved name", () => {
    expect(canClaim(baseProfile(), "zang")).toEqual({ ok: true });
  });
  it("rejects an already-claimed name", () => {
    expect(canClaim(baseProfile({ claimed: true }), "zang")).toEqual({ ok: false, reason: "already_claimed" });
  });
  it("rejects a reserved name", () => {
    expect(canClaim(baseProfile(), "admin")).toEqual({ ok: false, reason: "reserved" });
  });
  it("rejects an invalid (too short) name", () => {
    expect(canClaim(baseProfile(), "yo")).toEqual({ ok: false, reason: "invalid_username" });
  });
});

describe("sessions", () => {
  it("adds, touches, and revokes by token hash", () => {
    const sessions: Record<string, { createdAt: number; lastSeen: number; label?: string }> = {};
    addSession(sessions, "hashA", { createdAt: 10, lastSeen: 10, label: "phone" });
    expect(sessions.hashA).toEqual({ createdAt: 10, lastSeen: 10, label: "phone" });
    touchSession(sessions, "hashA", 50);
    expect(sessions.hashA.lastSeen).toBe(50);
    expect(revokeSession(sessions, "hashA")).toBe(true);
    expect(sessions.hashA).toBeUndefined();
    expect(revokeSession(sessions, "missing")).toBe(false);
  });
});

describe("projectDirectory", () => {
  it("projects only the public flags", () => {
    const p = baseProfile({ claimed: true, createdAt: 777, auth: { v: 1, salt: "x", phraseHash: "y", sessions: {}, claimedAt: 777 } });
    expect(projectDirectory(p)).toEqual({ claimed: true, verified: false, ownerSince: 777 });
  });
  it("reports unclaimed for an open profile", () => {
    expect(projectDirectory(baseProfile())).toEqual({ claimed: false, verified: false, ownerSince: 1000 });
  });
});

describe("publicProfile (secret stripper — load-bearing security guarantee)", () => {
  it("removes auth + pendingClaim and adds claimed/verified", () => {
    const p = baseProfile({
      claimed: true,
      auth: { v: 1, salt: "SECRET_SALT", phraseHash: "SECRET_HASH", sessions: { h: { createdAt: 1, lastSeen: 1 } }, claimedAt: 5 },
      pendingClaim: { salt: "PSALT", phraseHash: "PHASH", nonce: "NONCE", createdAt: 9 },
    });
    const pub = publicProfile(p);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("SECRET_SALT");
    expect(json).not.toContain("SECRET_HASH");
    expect(json).not.toContain("NONCE");
    expect((pub as Record<string, unknown>).auth).toBeUndefined();
    expect((pub as Record<string, unknown>).pendingClaim).toBeUndefined();
    expect(pub.claimed).toBe(true);
    expect(pub.verified).toBe(false);
  });
});
```

Append to `test/identity.test.ts` (new `describe` block, after the existing `roomPath` block):

```ts
import { isReserved, RESERVED_USERNAMES } from "../src/identity.ts";

describe("isReserved", () => {
  it("flags brand/role names (normalized)", () => {
    expect(isReserved("admin")).toBe(true);
    expect(isReserved("WORDUL")).toBe(true);   // normalized before lookup
    expect(isReserved(" Official ")).toBe(true);
  });
  it("allows ordinary names", () => {
    expect(isReserved("zang")).toBe(false);
    expect(isReserved("maple_otter")).toBe(false);
  });
  it("keeps the anchor word reserved (cannot register @wordul)", () => {
    expect(RESERVED_USERNAMES.has("wordul")).toBe(true);
  });
});
```

> Note: `test/identity.test.ts` already imports from `../src/identity.ts` on line 2 — add `isReserved, RESERVED_USERNAMES` to that existing import instead of a duplicate import line if your linter objects to two imports from one module.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/account-core.test.ts test/identity.test.ts`
Expected: account-core FAILs (`Cannot find module '../src/account-core.ts'`); identity FAILs on the new `isReserved` import.

- [ ] **Step 4: Write the implementation**

Create `src/account-core.ts`:

```ts
// src/account-core.ts — PURE account/auth logic (no Cloudflare deps, no crypto IO).
// Mirrors the user-core.ts pattern: the USER DO calls these; the DO owns persistence
// and all crypto (account-crypto.ts). Everything here is unit-tested in isolation.
import type { UserProfile } from "./types.ts";
import { isValidUsername, isReserved } from "./identity.ts";

// ---- Shared auth shapes (imported by types.ts for UserProfile) ----
export type AuthMethods = { google?: unknown; github?: unknown; email?: unknown; passkeys?: unknown[] };
export type SessionMeta = { createdAt: number; lastSeen: number; label?: string };
export type AuthRecord = {
  v: 1;
  salt: string;                       // hex, per-account
  phraseHash: string;                 // hex PBKDF2-SHA256 of the 6-word passphrase
  methods?: AuthMethods;              // RESERVED upgrade layers — not implemented in P0
  sessions: Record<string, SessionMeta>; // key = sha256(token) hex
  claimedAt: number;
};
// Ephemeral preview slot held between /account/preview and /account/claim. Holds only
// the HASH of the previewed phrase (never the raw words) + a nonce the commit must echo.
export type PendingClaim = { salt: string; phraseHash: string; nonce: string; createdAt: number };

export type DirectoryProjection = { claimed: boolean; verified: boolean; ownerSince: number };
// A profile with secrets removed + the public auth flags surfaced.
export type PublicProfile = Omit<UserProfile, "auth" | "pendingClaim"> & { claimed: boolean; verified: boolean };

// ---- The wordul-passphrase ----
export const PHRASE_ANCHOR = "wordul";
export const PHRASE_WORD_COUNT = 5;

// Curated, family-safe, nature/game-flavored word list. v1 starter — expand pre-launch
// to lift entropy. NOTE: this list is independent of the answer-word pool by design, and
// the phrase is NEVER derived from the username (makePassphrase takes no username).
export const PHRASE_WORDS: readonly string[] = [
  "amber", "otter", "glides", "meadow", "river", "stone", "willow", "frost", "ember", "maple",
  "cedar", "raven", "sparrow", "harbor", "lantern", "copper", "velvet", "marble", "cinder", "hollow",
  "thistle", "clover", "ripple", "glimmer", "shimmer", "twilight", "pebble", "brook", "cliff", "dune",
  "fern", "grove", "heron", "jasmine", "kestrel", "lily", "moss", "nectar", "petal", "quartz",
  "reed", "sage", "tide", "vine", "wren", "zephyr", "acorn", "birch", "cobble", "drift",
  "finch", "gale", "haze", "jade", "kelp", "lark", "mist", "north", "opal", "pine",
  "quill", "spruce", "thorn", "umber", "vale", "wave", "yarrow", "aspen", "beacon", "canyon",
  "dawn", "forest", "garnet", "hazel", "indigo", "juniper", "lagoon", "lotus", "marsh", "nimbus",
  "orchard", "prairie", "quiver", "ridge", "saffron", "tundra", "valley", "walnut", "cypress", "dahlia",
  "willows", "drifts", "wanders", "settles", "rises", "gathers", "lingers", "whispers", "scatters", "blooms",
  "autumn", "crystal", "feather", "glacier", "harvest", "island", "lullaby", "meadows", "orchid", "pebbles",
  "rainbow", "shadow", "snowfall", "summit", "thunder", "violet", "willowy", "woodland", "zenith", "breeze",
];

/** Generate a passphrase: [anchor, w1..wN] with N random distinct words from PHRASE_WORDS.
 *  Takes ONLY an rng — there is intentionally no username parameter, so the phrase can
 *  never be derived from the public handle. */
export function makePassphrase(rng: () => number = Math.random): string[] {
  const pick: string[] = [];
  const used = new Set<number>();
  while (pick.length < PHRASE_WORD_COUNT) {
    const i = Math.floor(rng() * PHRASE_WORDS.length) % PHRASE_WORDS.length;
    if (used.has(i)) continue;        // distinct words read better and add entropy
    used.add(i);
    pick.push(PHRASE_WORDS[i]);
  }
  return [PHRASE_ANCHOR, ...pick];
}

/** Server-side shape guard: anchor first, exactly N more words, every word on the list.
 *  Used to reject a malformed phrase at login (defense-in-depth; login also fails on hash). */
export function validatePassphraseShape(phrase: string): boolean {
  const words = phrase.trim().toLowerCase().split(/\s+/);
  if (words.length !== PHRASE_WORD_COUNT + 1) return false;
  if (words[0] !== PHRASE_ANCHOR) return false;
  const list = new Set(PHRASE_WORDS);
  return words.slice(1).every((w) => list.has(w));
}

// ---- Claim state machine ----
export type ClaimDecision = { ok: true } | { ok: false; reason: "already_claimed" | "reserved" | "invalid_username" };

export function canClaim(profile: Pick<UserProfile, "claimed">, username: string): ClaimDecision {
  if (!isValidUsername(username)) return { ok: false, reason: "invalid_username" };
  if (isReserved(username)) return { ok: false, reason: "reserved" };
  if (profile.claimed) return { ok: false, reason: "already_claimed" };
  return { ok: true };
}

// ---- Sessions (mutate the passed map in place; DO persists) ----
export function addSession(sessions: Record<string, SessionMeta>, tokenHash: string, meta: SessionMeta): void {
  sessions[tokenHash] = meta;
}
export function revokeSession(sessions: Record<string, SessionMeta>, tokenHash: string): boolean {
  if (!sessions[tokenHash]) return false;
  delete sessions[tokenHash];
  return true;
}
export function touchSession(sessions: Record<string, SessionMeta>, tokenHash: string, now: number): void {
  if (sessions[tokenHash]) sessions[tokenHash].lastSeen = now;
}

// ---- Projections ----
export function projectDirectory(profile: UserProfile): DirectoryProjection {
  return { claimed: !!profile.claimed, verified: false, ownerSince: profile.auth?.claimedAt ?? profile.createdAt };
}

/** Strip ALL secret material and surface the public auth flags. The DO's GET handler MUST
 *  pass profiles through this before serializing — otherwise the salt/hash/session map leak. */
export function publicProfile(profile: UserProfile): PublicProfile {
  const { auth, pendingClaim, ...rest } = profile;
  void auth; void pendingClaim;
  return { ...rest, claimed: !!profile.claimed, verified: false };
}
```

- [ ] **Step 5: Run the tests to verify they pass + full typecheck**

Run: `npx vitest run test/account-core.test.ts test/identity.test.ts test/account-crypto.test.ts && npm run typecheck`
Expected: all PASS; `npm run typecheck` is now CLEAN (Task 1's missing-module error is resolved).

- [ ] **Step 6: Commit (this also lands Task 1's type changes, now compiling)**

```bash
git add src/account-core.ts src/identity.ts src/types.ts test/account-core.test.ts test/identity.test.ts
git commit -m "feat(accounts): pure account-core — passphrase, claim machine, sessions, projection + reserved names"
```

---

## Task 4: `User` DO — strip secrets from the public GET (security fix, do it before secrets exist)

**Files:**
- Modify: `src/user.ts:3-5` (imports), `src/user.ts:34-37` (GET handler)
- Test: covered by `publicProfile` test (Task 3) + the route-shape assertion below

> **Why first:** the existing GET does `Response.json({ ...profile, gold })` — it spreads the *whole* profile. As soon as `auth` lands on a profile (Task 5), this endpoint would serve the salt + phraseHash + session hashes to anyone hitting `/api/user/<name>`. Wire the stripper before the secret-writing routes exist.

- [ ] **Step 1: Import `publicProfile` in the DO**

In `src/user.ts`, extend the `user-core` import on line 5 to also pull from `account-core`. After line 5 add:

```ts
import { publicProfile } from "./account-core.ts";
```

- [ ] **Step 2: Route the GET through `publicProfile`**

In `src/user.ts`, replace the GET branch (lines 34-37):

```ts
    if (req.method === "GET") {
      const profile = await this.load(username);
      return Response.json({ ...profile, gold: profile.balances.gold ?? 0 });
    }
```

with:

```ts
    if (req.method === "GET") {
      const profile = await this.load(username);
      // SECURITY: never spread the raw profile — publicProfile() drops auth + pendingClaim
      // (salt/phraseHash/session hashes) and surfaces only the claimed/verified flags.
      return Response.json({ ...publicProfile(profile), gold: profile.balances.gold ?? 0 });
    }
```

- [ ] **Step 3: Add a route-shape guard test**

Create `test/account-routes.test.ts` with this first block (more added in Tasks 5-7):

```ts
import { describe, it, expect } from "vitest";
import { publicProfile } from "../src/account-core.ts";
import type { UserProfile } from "../src/types.ts";

describe("public GET shape (user.ts GET → publicProfile)", () => {
  it("a serialized public profile carries no secret keys", () => {
    const profile = {
      username: "zang", createdAt: 1, stats: {} as UserProfile["stats"],
      games: [], ownedRooms: [], ledger: [], balances: { gold: 3 }, h2h: {},
      claimed: true,
      auth: { v: 1 as const, salt: "SALT", phraseHash: "HASH", sessions: { h: { createdAt: 1, lastSeen: 1 } }, claimedAt: 1 },
    } satisfies UserProfile;
    // Mirror exactly what the DO GET returns:
    const body = JSON.stringify({ ...publicProfile(profile), gold: profile.balances.gold ?? 0 });
    expect(body).not.toContain("SALT");
    expect(body).not.toContain("HASH");
    expect(body).toContain("\"claimed\":true");
    expect(body).toContain("\"gold\":3");
  });
});
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run test/account-routes.test.ts && npm run typecheck`
Expected: PASS; typecheck CLEAN.

- [ ] **Step 5: Commit**

```bash
git add src/user.ts test/account-routes.test.ts
git commit -m "fix(accounts): strip auth secrets from the public User GET via publicProfile"
```

---

## Task 5: `User` DO — `/account/preview` + `/account/claim` (the secure-by-continuity flow)

**Files:**
- Modify: `src/user.ts` (imports + new POST branches, placed AFTER `/h2h`)
- Test: `test/account-routes.test.ts` (route-ordering mirror guard)

- [ ] **Step 1: Add the route-ordering guard test (mirrors user-h2h.test.ts pattern)**

Append to `test/account-routes.test.ts`:

```ts
describe("User DO route ordering (no new /account/* route shadows the money paths)", () => {
  // Mirror the EXACT endsWith predicates from user.ts fetch(), in route order.
  const appendMatch = (p: string) => p.endsWith("/append") && !p.endsWith("/ledger/append");
  const ledgerMatch = (p: string) => p.endsWith("/ledger/append");
  const h2hMatch = (p: string) => p.endsWith("/h2h");
  const previewMatch = (p: string) => p.endsWith("/account/preview");
  const claimMatch = (p: string) => p.endsWith("/account/claim");
  const loginMatch = (p: string) => p.endsWith("/account/login");
  const revokeMatch = (p: string) => p.endsWith("/account/sessions/revoke");
  const meMatch = (p: string) => p.endsWith("/account/me");
  const verifyMatch = (p: string) => p.endsWith("/account/verify-session");

  const all = { appendMatch, ledgerMatch, h2hMatch, previewMatch, claimMatch, loginMatch, revokeMatch, meMatch, verifyMatch };
  function onlyMatches(path: string, key: keyof typeof all) {
    for (const [name, fn] of Object.entries(all)) {
      expect(`${name}:${fn(path)}`).toBe(`${name}:${name === key}`);
    }
  }

  it("each account route matches ONLY itself, never an /append or /h2h path", () => {
    onlyMatches("/account/preview", "previewMatch");
    onlyMatches("/account/claim", "claimMatch");
    onlyMatches("/account/login", "loginMatch");
    onlyMatches("/account/sessions/revoke", "revokeMatch");
    onlyMatches("/account/me", "meMatch");
    onlyMatches("/account/verify-session", "verifyMatch");
  });
  it("the money paths still match only themselves", () => {
    onlyMatches("/users/zang/ledger/append", "ledgerMatch");
    onlyMatches("/users/zang/h2h", "h2hMatch");
  });
});
```

- [ ] **Step 2: Run it to verify it passes (pure predicate test — no impl needed yet)**

Run: `npx vitest run test/account-routes.test.ts`
Expected: PASS. (This locks the route-suffix contract the impl must honor.)

- [ ] **Step 3: Extend the DO imports**

In `src/user.ts`, replace the `account-core` import (added in Task 4) with the full set, and add the crypto + identity imports:

```ts
import { publicProfile, makePassphrase, canClaim, addSession, projectDirectory } from "./account-core.ts";
import { hashPassphrase, mintToken, hashToken } from "./account-crypto.ts";
```

- [ ] **Step 4: Add `PENDING_TTL_MS` constant**

In `src/user.ts`, after `const ROOMS_CAP = 100;` (line 9):

```ts
const PENDING_TTL_MS = 10 * 60 * 1000; // a previewed-but-uncommitted passphrase expires in 10 min
```

- [ ] **Step 5: Add the `/account/preview` and `/account/claim` branches**

In `src/user.ts`, insert these two branches **after** the `/h2h` branch (after line 79, before the final `return new Response("not found", ...)`):

```ts
    // Accounts P0 — preview a wordul-passphrase. The DO generates + hashes it, stashes the
    // HASH (never the raw words) in an ephemeral pendingClaim, and returns the raw phrase
    // + a nonce ONCE. Re-roll = call again (overwrites pendingClaim). No state is claimed yet.
    if (req.method === "POST" && url.pathname.endsWith("/account/preview")) {
      const profile = await this.load(username);
      const decision = canClaim(profile, username);
      if (!decision.ok) return Response.json({ error: decision.reason }, { status: decision.reason === "already_claimed" ? 409 : 400 });
      const words = makePassphrase();
      const phrase = words.join(" ");
      const { salt, hash } = await hashPassphrase(phrase);
      const nonce = mintToken();
      profile.pendingClaim = { salt, phraseHash: hash, nonce, createdAt: Date.now() };
      await this.ctx.storage.put("profile", profile);
      return Response.json({ passphrase: phrase, nonce });
    }

    // Accounts P0 — commit the previewed claim. Echoes the nonce from /preview; promotes the
    // pending hash into auth, mints the first session, writes the public KV projection.
    // Single-writer DO ⇒ this whole transition is race-free with no lock.
    if (req.method === "POST" && url.pathname.endsWith("/account/claim")) {
      const { nonce } = (await req.json()) as { nonce?: string };
      const profile = await this.load(username);
      const decision = canClaim(profile, username);
      if (!decision.ok) return Response.json({ error: decision.reason }, { status: decision.reason === "already_claimed" ? 409 : 400 });
      const pending = profile.pendingClaim;
      if (!pending || pending.nonce !== nonce || Date.now() - pending.createdAt > PENDING_TTL_MS) {
        return Response.json({ error: "no_valid_preview" }, { status: 400 });
      }
      const token = mintToken();
      const tokenHash = await hashToken(token);
      const now = Date.now();
      profile.claimed = true;
      profile.auth = { v: 1, salt: pending.salt, phraseHash: pending.phraseHash, methods: {}, sessions: {}, claimedAt: now };
      addSession(profile.auth.sessions, tokenHash, { createdAt: now, lastSeen: now });
      delete profile.pendingClaim;
      await this.ctx.storage.put("profile", profile);
      // Public projection — written by the authority so /@username can render the badge
      // without waking the DO twice and without ever touching secrets. Best-effort.
      try {
        await this.env.DIRECTORY.put(`auth:${username}`, JSON.stringify(projectDirectory(profile)));
      } catch (e) { console.error("auth projection failed", username, (e as Error).message); }
      return Response.json({ sessionToken: token, history: { games: profile.games.length, since: profile.createdAt } });
    }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: CLEAN. (`this.env.DIRECTORY` is already on `Env`; the DO has `this.env`.)

- [ ] **Step 7: Commit**

```bash
git add src/user.ts test/account-routes.test.ts
git commit -m "feat(accounts): User DO preview + claim — race-free continuity-claim, KV projection"
```

---

## Task 6: `User` DO — `/account/login`, `/account/sessions/revoke`, `/account/me`, `/account/verify-session`

**Files:**
- Modify: `src/user.ts` (imports + new POST/GET branches after `/account/claim`)

- [ ] **Step 1: Extend the DO imports for login/session ops**

In `src/user.ts`, update the imports to add `revokeSession`, `touchSession`, `validatePassphraseShape`, and `verifyPassphrase`:

```ts
import { publicProfile, makePassphrase, canClaim, addSession, revokeSession, touchSession, projectDirectory, validatePassphraseShape } from "./account-core.ts";
import { hashPassphrase, verifyPassphrase, mintToken, hashToken } from "./account-crypto.ts";
```

- [ ] **Step 2: Add the four branches after `/account/claim`**

In `src/user.ts`, insert after the `/account/claim` branch (before the final `return new Response("not found", ...)`):

```ts
    // Accounts P0 — login on a new device with username + passphrase → a fresh session.
    if (req.method === "POST" && url.pathname.endsWith("/account/login")) {
      const { passphrase } = (await req.json()) as { passphrase?: string };
      const profile = await this.load(username);
      const phrase = (passphrase ?? "").trim().toLowerCase();
      // Generic failure for every reject path (no oracle: unclaimed vs wrong phrase look identical).
      if (!profile.claimed || !profile.auth || !validatePassphraseShape(phrase)) {
        return Response.json({ error: "invalid_credentials" }, { status: 401 });
      }
      const ok = await verifyPassphrase(phrase, profile.auth.salt, profile.auth.phraseHash);
      if (!ok) return Response.json({ error: "invalid_credentials" }, { status: 401 });
      const token = mintToken();
      const now = Date.now();
      addSession(profile.auth.sessions, await hashToken(token), { createdAt: now, lastSeen: now });
      await this.ctx.storage.put("profile", profile);
      return Response.json({ sessionToken: token });
    }

    // Accounts P0 — revoke a session. Caller proves ownership with its OWN sessionToken;
    // `target` is the session-id (= token hash, from /account/me) to kill (default = self).
    if (req.method === "POST" && url.pathname.endsWith("/account/sessions/revoke")) {
      const { sessionToken, target } = (await req.json()) as { sessionToken?: string; target?: string };
      const profile = await this.load(username);
      if (!profile.auth || !sessionToken) return Response.json({ error: "unauthorized" }, { status: 401 });
      const callerHash = await hashToken(sessionToken);
      if (!profile.auth.sessions[callerHash]) return Response.json({ error: "unauthorized" }, { status: 401 });
      const killed = revokeSession(profile.auth.sessions, target || callerHash);
      await this.ctx.storage.put("profile", profile);
      return Response.json({ ok: killed });
    }

    // Accounts P0 — who am I? Bearer sessionToken → account flags + session list (NO secrets;
    // session ids are token HASHES, which can't be reversed to a usable token).
    if (req.method === "GET" && url.pathname.endsWith("/account/me")) {
      const auth = req.headers.get("Authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const profile = await this.load(username);
      if (!profile.auth || !token) return Response.json({ error: "unauthorized" }, { status: 401 });
      const callerHash = await hashToken(token);
      if (!profile.auth.sessions[callerHash]) return Response.json({ error: "unauthorized" }, { status: 401 });
      touchSession(profile.auth.sessions, callerHash, Date.now());
      await this.ctx.storage.put("profile", profile);
      const sessions = Object.entries(profile.auth.sessions).map(([id, m]) => ({
        id, current: id === callerHash, createdAt: m.createdAt, lastSeen: m.lastSeen, label: m.label,
      }));
      return Response.json({ username, claimed: true, verified: false, sessions });
    }

    // Accounts P0 — the hello seam (consumed by P1 worlds). Cheap validity check for a token.
    if (req.method === "POST" && url.pathname.endsWith("/account/verify-session")) {
      const { sessionToken } = (await req.json()) as { sessionToken?: string };
      const profile = await this.load(username);
      if (!profile.auth || !sessionToken) return Response.json({ valid: false });
      const ok = !!profile.auth.sessions[await hashToken(sessionToken)];
      return Response.json({ valid: ok });
    }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: CLEAN.

- [ ] **Step 4: Re-run the route-ordering guard (still green — new suffixes are distinct)**

Run: `npx vitest run test/account-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/user.ts
git commit -m "feat(accounts): User DO login, session revoke, /me, verify-session seam"
```

---

## Task 7: `worker.ts` — `/api/account/*` proxy routes + KV-counter rate limiting

**Files:**
- Modify: `src/worker.ts` (new routes near the other `/api/*` handlers; new helper functions)
- Test: `test/account-routes.test.ts` (pure `rateLimitDecision`)

- [ ] **Step 1: Write the failing rate-limit-decision test**

Append to `test/account-routes.test.ts`:

```ts
import { rateLimitDecision } from "../src/worker.ts";

describe("rateLimitDecision (pure)", () => {
  it("allows up to the limit then blocks", () => {
    expect(rateLimitDecision(0, 5)).toEqual({ allow: true, next: 1 });
    expect(rateLimitDecision(4, 5)).toEqual({ allow: true, next: 5 });
    expect(rateLimitDecision(5, 5)).toEqual({ allow: false, next: 5 });
    expect(rateLimitDecision(99, 5)).toEqual({ allow: false, next: 99 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/account-routes.test.ts`
Expected: FAIL — `rateLimitDecision` not exported from `worker.ts`.

- [ ] **Step 3: Add the rate-limit helpers + account routes to `worker.ts`**

In `src/worker.ts`, add the import for the account-route username guard — `normalizeUsername` and `isValidUsername` are already imported on line 9 (`isReserved` is enforced inside the DO via `canClaim`, so no new import needed there).

Add these **exported** helpers near the top of `src/worker.ts` (after the regex consts, before `export default`):

```ts
// Pure rate-limit decision: given the current window count + limit, allow or block and
// return the count to persist. Unit-tested; the KV plumbing around it is integration.
export function rateLimitDecision(count: number, limit: number): { allow: boolean; next: number } {
  if (count >= limit) return { allow: false, next: count };
  return { allow: true, next: count + 1 };
}

// KV-counter rate limit on the DIRECTORY namespace. Best-effort: a KV hiccup ALLOWS
// (fail-open) so a transient KV outage can't lock everyone out of claiming. `key` should
// already encode the scope (e.g. `rl:claim:<ip>`); `windowSec` is the bucket lifetime.
async function rateLimit(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const raw = await env.DIRECTORY.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    const { allow, next } = rateLimitDecision(count, limit);
    if (allow) await env.DIRECTORY.put(key, String(next), { expirationTtl: windowSec });
    return allow;
  } catch {
    return true; // fail-open
  }
}
```

Then add the account proxy block. Place it **before** the `/api/user/` block (it's more specific) — i.e. right after the Arena open-games block (`src/worker.ts:66`):

```ts
    // Accounts P0 — proxy /api/account/* to the per-username User DO, with KV rate limiting.
    if (url.pathname.startsWith("/api/account/")) {
      const sub = url.pathname.slice("/api/account/".length); // "preview" | "claim" | "login" | "sessions/revoke" | "me" | "verify-session"
      const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";

      const userDo = (name: string, doPath: string, init: RequestInit) =>
        env.USER.get(env.USER.idFromName(name)).fetch(`https://do/${doPath}?username=${encodeURIComponent(name)}`, init);

      // GET /api/account/me?username=<u> with Bearer token.
      if (sub === "me" && req.method === "GET") {
        const name = normalizeUsername(url.searchParams.get("username") ?? "");
        if (!isValidUsername(name)) return new Response("bad username", { status: 400 });
        return userDo(name, "account/me", { method: "GET", headers: { Authorization: req.headers.get("Authorization") ?? "" } });
      }

      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body: Record<string, unknown>;
      try { body = (await req.json()) as Record<string, unknown>; } catch { return new Response("bad json", { status: 400 }); }
      const name = normalizeUsername(typeof body.username === "string" ? body.username : "");
      if (!isValidUsername(name)) return new Response("bad username", { status: 400 });

      // Rate-limit the abusable surfaces (preview/claim/login) per-IP and per-username.
      if (sub === "preview" || sub === "claim" || sub === "login") {
        const okIp = await rateLimit(env, `rl:acct:${sub}:ip:${ip}`, 10, 60);
        const okName = await rateLimit(env, `rl:acct:${sub}:u:${name}`, 5, 60);
        if (!okIp || !okName) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "content-type": "application/json" } });
      }

      const doPath =
        sub === "preview" ? "account/preview" :
        sub === "claim" ? "account/claim" :
        sub === "login" ? "account/login" :
        sub === "sessions/revoke" ? "account/sessions/revoke" :
        sub === "verify-session" ? "account/verify-session" : null;
      if (!doPath) return new Response("not found", { status: 404 });
      return userDo(name, doPath, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    }
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run test/account-routes.test.ts && npm run typecheck`
Expected: PASS; typecheck CLEAN. (Exporting `rateLimitDecision` from `worker.ts` is safe — `worker.ts` already exports the DO classes and the default handler.)

- [ ] **Step 5: Confirm the module-graph guard still passes (worker.ts gained an export)**

Run: `npm run check-graph`
Expected: PASS. (If `module-graph.test.ts` asserts an exact export set for `worker.ts`, add `rateLimitDecision` to its expectation; otherwise no change.)

- [ ] **Step 6: Commit**

```bash
git add src/worker.ts test/account-routes.test.ts
git commit -m "feat(accounts): /api/account/* proxy + KV-counter rate limiting (fail-open)"
```

---

## Task 8: `hello` session-token seam (validated, stowed on the WS attachment, off the snapshot)

**Files:**
- Modify: `src/room.ts:276-277` (dispatch), `src/room.ts:314-339` (`onHello` signature + attachment)

> P0 ships only the *validation seam* — there are no claimed-world actions to gate yet. We validate the token (when present) and stow `authed` on the WS `serializeAttachment`, NOT on `PlayerState`, so it never enters the broadcast snapshot. P1 reads `attachment.authed` to gate owner-only world edits.

- [ ] **Step 1: Thread `sessionToken` through the dispatch**

In `src/room.ts`, replace the `hello` dispatch (line 277):

```ts
      case "hello":
        return this.onHello(ws, msg.username, msg.wordLength, msg.edition, msg.mode, msg.scienceOptOut, msg.public);
```

with:

```ts
      case "hello":
        return this.onHello(ws, msg.username, msg.wordLength, msg.edition, msg.mode, msg.scienceOptOut, msg.public, msg.sessionToken);
```

- [ ] **Step 2: Accept `sessionToken` in `onHello` and validate it**

In `src/room.ts`, change the `onHello` signature (lines 314-322) to add the parameter:

```ts
  private async onHello(
    ws: WebSocket,
    usernameRaw: string,
    wordLength?: number,
    edition?: string,
    mode?: RoomMode,
    scienceOptOut = false,
    isPublic = false,
    sessionToken?: string,
  ): Promise<void> {
```

Then replace the attachment line (currently `ws.serializeAttachment({ username });` at line 339) with the validated version:

```ts
    // Auth seam (P0): if the client presented a session token, ask the owning User DO whether
    // it's valid and stow the verdict on the WS attachment — NEVER on PlayerState (which is
    // broadcast). Casual play sends no token → no extra DO hop. Best-effort: a hiccup ⇒ unauthed.
    let authed = false;
    if (sessionToken) {
      try {
        const res = await this.env.USER.get(this.env.USER.idFromName(username))
          .fetch(`https://do/account/verify-session?username=${encodeURIComponent(username)}`, {
            method: "POST",
            body: JSON.stringify({ sessionToken }),
            headers: { "content-type": "application/json" },
          });
        if (res.ok) authed = !!((await res.json()) as { valid?: boolean }).valid;
      } catch (e) { console.error("verify-session failed", username, (e as Error).message); }
    }
    ws.serializeAttachment({ username, authed });
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: CLEAN. (`msg.sessionToken` is now on the `hello` type from Task 1; existing reads of `ws.deserializeAttachment()` that expect `{ username }` still work — `authed` is additive.)

- [ ] **Step 4: Run the room test suite to confirm no regression**

Run: `npx vitest run test/room-core.test.ts test/room-seed.test.ts test/room-finish-broadcast.test.ts`
Expected: PASS (the attachment shape change is additive; the snapshot is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/room.ts
git commit -m "feat(accounts): hello session-token validation seam (authed on WS attachment, off snapshot)"
```

---

## Task 9: Client — `account.js` (secure sheet + login + token storage), `app.js` wiring, profile badge

**Files:**
- Create: `public/account.js`
- Modify: `public/app.js:31-39` (LS map), `public/app.js:1405-1413` (hello send)
- Modify: `public/profile.js` (claimed marker)
- Modify: `public/style.css` (sheet + badge styles)

> P0 UI is intentionally thin: a self-contained `account.js` module with the API client + a passphrase sheet + a login form, wired into `app.js` at two points (token storage + the hello send), plus a claimed marker on `/@username`.

- [ ] **Step 1: Add the session-token storage key to the LS map**

In `public/app.js`, add a line to the `LS` object (lines 31-39):

```js
const LS = {
  username: "wr.username",
  session: "wr.session", // raw account session token (bearer) — present only for a secured name
  preferredLength: "wr.length",
  replay: "wr.replay", // structured per-guess payout log, keyed per game (slug:round)
  clearHint: "wr.clearHint", // one-time "press Esc / hold ⌫ to clear the row" nudge
  dailySolve: "wr.dailySolve", // your own daily solve (letters + colors), per date — CLIENT-ONLY
                               // so the home stamp shows real letters without the public
                               // profile ever leaking today's answer.
};
```

- [ ] **Step 2: Create the client module**

Create `public/account.js`:

```js
// public/account.js — accounts P0 client: session-token storage + the "🔒 secure this
// account" sheet (preview→commit) + a login form. Server is authoritative for the
// passphrase (generated + hashed in the User DO); this never sees the word list.

const SESSION_KEY = "wr.session";

export function getSessionToken() { return localStorage.getItem(SESSION_KEY) || ""; }
export function setSessionToken(t) { if (t) localStorage.setItem(SESSION_KEY, t); }
export function clearSessionToken() { localStorage.removeItem(SESSION_KEY); }

async function postJSON(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Ask the server to preview a fresh passphrase (re-roll calls this again).
export function previewPassphrase(username) { return postJSON("/api/account/preview", { username }); }
// Commit the previewed claim; on success persist the returned session token.
export async function commitClaim(username, nonce) {
  const r = await postJSON("/api/account/claim", { username, nonce });
  if (r.ok && r.data.sessionToken) setSessionToken(r.data.sessionToken);
  return r;
}
// Log in on a new device; on success persist the token.
export async function login(username, passphrase) {
  const r = await postJSON("/api/account/login", { username, passphrase });
  if (r.ok && r.data.sessionToken) setSessionToken(r.data.sessionToken);
  return r;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Build + show the secure-account sheet. `username` is the active (unclaimed) name.
// onClaimed() is called after a successful commit so the host can refresh chrome.
export async function openSecureSheet(username, onClaimed) {
  const overlay = document.createElement("div");
  overlay.className = "acct-overlay";
  document.body.appendChild(overlay);
  const close = () => overlay.remove();

  let nonce = "";
  async function roll() {
    overlay.querySelector(".acct-phrase").textContent = "…";
    const r = await previewPassphrase(username);
    if (!r.ok) {
      overlay.querySelector(".acct-phrase").textContent =
        r.data.error === "reserved" ? "That name is reserved." :
        r.data.error === "already_claimed" ? "This name is already secured." :
        r.status === 429 ? "Slow down a moment, then try again." : "Couldn't generate a phrase.";
      overlay.querySelector(".acct-confirm").disabled = true;
      return;
    }
    nonce = r.data.nonce;
    overlay.querySelector(".acct-phrase").textContent = r.data.passphrase;
    overlay.querySelector(".acct-confirm").disabled = false;
  }

  overlay.innerHTML = `
    <div class="acct-sheet" role="dialog" aria-modal="true" aria-label="Secure this account">
      <h2>🔒 Secure @${esc(username)}</h2>
      <p class="acct-lede">Your name is the public handle. This 6-word phrase is the secret that proves it's yours — like a key. Write it down: we store only a one-way hash and <strong>can't reset it</strong>. (A warm backup — sign in with Google/email — is coming.)</p>
      <p class="acct-phrase" aria-live="polite">…</p>
      <div class="acct-actions">
        <button class="acct-roll" type="button">🎲 Re-roll</button>
        <button class="acct-copy" type="button">Copy</button>
      </div>
      <label class="acct-ack"><input type="checkbox" class="acct-ack-box"> I've written it down somewhere safe.</label>
      <div class="acct-actions">
        <button class="acct-cancel" type="button">Cancel</button>
        <button class="acct-confirm" type="button" disabled>Secure my account</button>
      </div>
    </div>`;

  overlay.querySelector(".acct-roll").addEventListener("click", roll);
  overlay.querySelector(".acct-cancel").addEventListener("click", close);
  overlay.querySelector(".acct-copy").addEventListener("click", () => {
    navigator.clipboard?.writeText(overlay.querySelector(".acct-phrase").textContent || "").catch(() => {});
  });
  const confirmBtn = overlay.querySelector(".acct-confirm");
  const ackBox = overlay.querySelector(".acct-ack-box");
  const sync = () => { confirmBtn.disabled = !ackBox.checked || !nonce; };
  ackBox.addEventListener("change", sync);
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    const r = await commitClaim(username, nonce);
    if (r.ok) { close(); if (onClaimed) onClaimed(); }
    else { overlay.querySelector(".acct-phrase").textContent = "Claim failed — re-roll and try again."; }
  });

  await roll();
  // Confirm stays disabled until BOTH a phrase exists and the ack box is checked.
  confirmBtn.disabled = true;
}
```

- [ ] **Step 3: Thread the session token into the `hello` send**

In `public/app.js`, import the getter near the other imports at the top of the file:

```js
import { getSessionToken } from "/account.js";
```

Then add `sessionToken` to the `hello` payload (lines 1405-1413):

```js
    send({
      type: "hello",
      username: getUsername(),
      wordLength: getPreferredLength(),
      edition: getActiveEditionId(), // seeds a fresh room with the creator's theme
      mode: "race", // only valid selectable mode today
      scienceOptOut: !getSettings().communityScience,
      public: game.publicArena === true, // host opted into the public Arena open-games list
      sessionToken: getSessionToken() || undefined, // P0 auth seam; absent for unsecured names
    });
```

- [ ] **Step 4: Render the claimed/verified marker on the profile**

In `public/profile.js`, replace the `<h1 class="profile-name">` line (line 49) so it shows a badge when the projected profile reports `claimed`:

```js
    <h1 class="profile-name">@${escapeHtml(username)}${p.claimed ? ' <span class="claimed-badge" title="Secured account">🔒</span>' : ""}${p.verified ? ' <span class="verified-badge" title="Verified">✔</span>' : ""}</h1>
```

(`p.claimed` / `p.verified` come straight from the `/api/user/<name>` JSON, which `publicProfile` now includes — Task 4.)

- [ ] **Step 5: Add minimal styles**

Append to `public/style.css`:

```css
/* --- Accounts P0: secure-account sheet + claimed badge --- */
.acct-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: grid; place-items: center; z-index: 1000; padding: 1rem; }
.acct-sheet { background: var(--bg, #fff); color: var(--fg, #111); max-width: 28rem; width: 100%; border-radius: 1rem; padding: 1.5rem; box-shadow: 0 12px 40px rgba(0,0,0,.3); }
.acct-sheet h2 { margin: 0 0 .5rem; }
.acct-lede { font-size: .9rem; opacity: .85; line-height: 1.45; }
.acct-phrase { font-family: ui-monospace, monospace; font-size: 1.15rem; letter-spacing: .02em; background: rgba(127,127,127,.12); border-radius: .6rem; padding: .8rem 1rem; word-spacing: .25em; text-align: center; margin: .75rem 0; min-height: 1.4em; }
.acct-actions { display: flex; gap: .5rem; justify-content: flex-end; margin-top: .5rem; }
.acct-actions button { padding: .5rem .9rem; border-radius: .5rem; border: 1px solid rgba(127,127,127,.4); background: transparent; cursor: pointer; }
.acct-confirm:not(:disabled) { background: var(--accent, #4c8bf5); color: #fff; border-color: transparent; }
.acct-confirm:disabled { opacity: .5; cursor: not-allowed; }
.acct-ack { display: flex; gap: .5rem; align-items: center; font-size: .85rem; margin: .75rem 0; }
.claimed-badge, .verified-badge { font-size: .8em; vertical-align: middle; }
```

- [ ] **Step 6: Verify in the running app (no automated client test for the sheet — manual)**

Run: `npm run dev`
Then, in a browser at `http://localhost:8787`: pick a fresh username, open the secure sheet (Step 7 wires the entry point — for now call `import("/account.js").then(m => m.openSecureSheet(getUsername()))` from the console), confirm: a 6-word phrase renders, 🎲 re-roll changes it, the confirm button is disabled until the ack box is checked, and after confirming, `localStorage.getItem("wr.session")` is set. Reload `/@<name>` and confirm the 🔒 badge renders.

- [ ] **Step 7: Wire a visible entry point**

Add a "🔒 Secure this account" affordance where the active player's identity is shown. Locate the hub/settings render in `public/app.js` (search for where `getUsername()` is shown in the hub, near the avatar). Add a button that, only when `getUsername()` is set and `getSessionToken()` is empty, calls:

```js
import("/account.js").then((m) => m.openSecureSheet(getUsername(), () => location.reload()));
```

Keep it minimal — a single text button in the settings/avatar area is sufficient for P0. (Exact insertion point depends on the current hub markup; place it adjacent to the existing username display.)

- [ ] **Step 8: Commit**

```bash
git add public/account.js public/app.js public/profile.js public/style.css
git commit -m "feat(accounts): client secure-account sheet, login, token-in-hello, claimed badge"
```

---

## Task 10: Manual smoke checklist + docs

**Files:**
- Modify: `public/llms.txt` (note the new account capability), this plan's checklist

- [ ] **Step 1: Run the full test suite + typecheck (the ship gate)**

Run: `npm test && npm run typecheck`
Expected: ALL green. If `module-graph.test.ts` fails on the new `worker.ts` export, update its expectation to include `rateLimitDecision`.

- [ ] **Step 2: Multi-device manual smoke (the spec's acceptance flow)**

With `npm run dev` running (or a deployed preview):
1. **Secure** — Device A: play as a fresh `@smoketest`, open the secure sheet, write down the phrase, confirm. `wr.session` is set; `/@smoketest` shows 🔒.
2. **Secret never leaks** — `curl localhost:8787/api/user/smoketest` → response contains `"claimed":true` but NO `salt`, `phraseHash`, `auth`, or `pendingClaim`.
3. **Login elsewhere** — Device B (different browser / incognito): call `login("smoketest", "<the phrase>")` → returns a session token; `me` lists 2 sessions.
4. **Wrong phrase** — `login("smoketest", "wordul wrong wrong wrong wrong wrong")` → 401 `invalid_credentials`.
5. **Re-claim blocked** — `previewPassphrase("smoketest")` → 409 `already_claimed`.
6. **Reserved** — `previewPassphrase("admin")` → 400 `reserved`.
7. **Revoke** — from A, `POST /api/account/sessions/revoke {username, sessionToken:<A>, target:<B's id from /me>}` → B's token now fails `verify-session`.
8. **Rate limit** — hammer `/api/account/login` for `smoketest` >5×/min → 429 `rate_limited`, recovers after the window.

Record pass/fail for each inline here:

```
[ ] 1 secure   [ ] 2 no-leak   [ ] 3 login-B   [ ] 4 wrong-phrase
[ ] 5 re-claim [ ] 6 reserved  [ ] 7 revoke    [ ] 8 rate-limit
```

- [ ] **Step 3: Note the capability in `llms.txt`**

Add a line to `public/llms.txt` under the appropriate section, e.g.:

```
- Accounts: a username can be secured with a 6-word "wordul-passphrase" (no email/password required); secured names are marked 🔒. Securing is opt-in — casual play needs no account.
```

- [ ] **Step 4: Commit**

```bash
git add public/llms.txt docs/superpowers/plans/2026-06-04-wordul-accounts-p0-implementation.md
git commit -m "docs(accounts): llms.txt account capability + P0 smoke checklist"
```

- [ ] **Step 5: Ship**

Run: `bash dev/ship.sh`
(Tests → rebase on `origin/main` → backup tag → merge → CI deploys `origin/main`. Never `wrangler deploy` by hand.)

---

## Self-Review (run against the spec)

**Spec coverage:**
- Continuity-claim, no login screen on the happy path → Task 9 secure sheet (preview→commit from the active session). ✅
- 6-word `wordul`-anchored passphrase, 5 random non-derived words, re-rollable, shown once, hash-only → Tasks 2-3 (`makePassphrase` takes no username; `account-crypto` stores salt+hash; preview returns raw once, persists only the hash). ✅
- PBKDF2-SHA256, per-account salt, no offline brute force → Task 2 + Task 7 rate-limit. ✅
- Session tokens: 32-byte random, store SHA-256 only, multi-device, revocable → Tasks 2, 6. ✅
- `claimed` flag + claim transition (open→claimed, idempotent reject, reserved, show receipts) → Tasks 3 (`canClaim`) + 5 (claim returns `history`). ✅
- Reserved-name blocklist in `identity.ts` → Task 3. ✅
- Anti-abuse floor (rate-limit claim/login per IP + per username) → Task 7. ✅
- Public directory projection (claimed/verified, no secrets) → Tasks 3 (`projectDirectory`/`publicProfile`) + 4 (GET strips) + 5 (KV write). ✅
- Auth on the existing `User` DO, pure logic separated → Tasks 3-6. ✅
- `auth.methods` reserved upgrade seam → Task 3 type. ✅
- `hello` optional `sessionToken` validation seam, unauth hello still works → Tasks 1, 8. ✅
- Forward invariant (server-validated, non-client-derivable scores) → **documentation-only constraint on P4**, not built here; recorded in the spec. ✅ (no P0 task — correct.)

**Placeholder scan:** every code step contains complete code; commands have expected output. No TBD/TODO. ✅

**Type consistency:** `AuthRecord`/`SessionMeta`/`PendingClaim`/`PublicProfile` defined once in `account-core.ts`, imported by `types.ts`; `makePassphrase(rng)`/`canClaim(profile, username)`/`addSession`/`revokeSession`/`touchSession`/`projectDirectory`/`publicProfile`/`validatePassphraseShape` signatures match across Tasks 3-6; `hashPassphrase`/`verifyPassphrase`/`mintToken`/`hashToken` match Tasks 2-6; `rateLimitDecision` exported in Task 7 and tested. DO route suffixes (`/account/preview|claim|login|sessions/revoke|me|verify-session`) are distinct from the money-path suffixes and guard-tested. ✅
