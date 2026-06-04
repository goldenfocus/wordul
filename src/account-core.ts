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
