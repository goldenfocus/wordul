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
import { secureIndex } from "../src/account-crypto.ts";
import type { UserProfile } from "../src/types.ts";

// Deterministic index source for reproducible passphrase tests — mirrors makePassphrase's
// injected `pickIndex` contract: (mod) => uniform-ish integer in [0, mod). (Production
// injects the CSPRNG secureIndex; this LCG is for deterministic assertions only.)
function seededIndex(seed: number): (mod: number) => number {
  let s = seed >>> 0;
  return (mod) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s % mod;
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
    const words = makePassphrase(seededIndex(7));
    expect(words[0]).toBe(PHRASE_ANCHOR);
    expect(words.length).toBe(PHRASE_WORD_COUNT + 1);
    for (const w of words.slice(1)) expect(PHRASE_WORDS).toContain(w);
  });

  it("works with the production CSPRNG source (secureIndex) — the server path", () => {
    // Server calls makePassphrase(secureIndex); exercise that exact path (no injected
    // determinism) so a regression in the crypto index surfaces here.
    const words = makePassphrase(secureIndex);
    expect(words[0]).toBe(PHRASE_ANCHOR);
    expect(words.length).toBe(PHRASE_WORD_COUNT + 1);
    expect(new Set(words.slice(1)).size).toBe(PHRASE_WORD_COUNT); // distinct
    for (const w of words.slice(1)) expect(PHRASE_WORDS).toContain(w);
  });

  it("is not derived from any username — output words come only from PHRASE_WORDS", () => {
    // The function takes no username parameter at all, so a handle cannot leak into the
    // phrase; assert every generated word is from the curated list (never a handle).
    const words = makePassphrase(seededIndex(99));
    for (const w of words.slice(1)) expect(PHRASE_WORDS).toContain(w);
  });

  it("re-rolls to a different phrase", () => {
    const a = makePassphrase(seededIndex(1)).join(" ");
    const b = makePassphrase(seededIndex(2)).join(" ");
    expect(a).not.toBe(b);
  });
});

describe("validatePassphraseShape", () => {
  it("accepts anchor + N valid words", () => {
    const words = makePassphrase(seededIndex(3));
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
    expect(pub.username).toBe("zang");      // non-secret fields must survive the strip
    expect(pub.createdAt).toBe(1000);
  });
});
