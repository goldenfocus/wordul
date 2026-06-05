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
  goldHistory,
} from "../src/account-core.ts";
import type { LedgerTx } from "../src/economy.ts";
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

  it("withholds the LIVE daily's letters but reveals every PAST game's full letter-card", () => {
    const p = baseProfile({
      games: [
        // TODAY's daily (live) — letters must NOT leave the server.
        { roomPath: "daily/2026-06-05", finishedAt: 9, wordLength: 5, word: "CRANK", result: "won", guesses: 3, opponents: [], solveGrid: ["yxxxx", "gyxyx", "ggggg"], words: ["AUDIO", "STERN", "CRANK"] },
        // A PAST daily — answer is historical, so the letters are fair game.
        { roomPath: "daily/2026-06-01", finishedAt: 7, wordLength: 5, word: "BRAVE", result: "won", guesses: 2, opponents: [], solveGrid: ["xxxxx", "ggggg"], words: ["AROSE", "BRAVE"] },
        // A room game — not the shared daily answer, ships freely.
        { roomPath: "crane/snappy-moose", finishedAt: 8, wordLength: 5, word: "NIECE", result: "lost", guesses: 6, opponents: [{ username: "yan", result: "won", guesses: 4 }], solveGrid: ["xyxxx"], words: ["AUDIO"] },
      ],
    });
    const pub = publicProfile(p, "daily/2026-06-05");
    const json = JSON.stringify(pub);
    // Live answer never leaves — neither the top-level word nor the words array.
    expect(json).not.toContain("CRANK");
    expect(pub.games[0].words).toBeUndefined();
    expect(pub.games[0].solveGrid).toEqual(["yxxxx", "gyxyx", "ggggg"]); // colors stay (home recap)
    // Past + room games carry their letters so a full card can render.
    expect(pub.games[1].words).toEqual(["AROSE", "BRAVE"]);
    expect(pub.games[2].words).toEqual(["AUDIO"]);
    // The redundant top-level word is always dropped, on every record.
    for (const g of pub.games) expect((g as Record<string, unknown>).word).toBeUndefined();
    expect(pub.games[2].opponents[0].username).toBe("yan");
  });

  it("reveals all letters when nothing is live (empty liveDailyPath)", () => {
    const p = baseProfile({
      games: [{ roomPath: "daily/2026-06-05", finishedAt: 9, wordLength: 5, word: "CRANK", result: "won", guesses: 1, opponents: [], words: ["CRANK"] }],
    });
    expect(publicProfile(p, "").games[0].words).toEqual(["CRANK"]);
  });

  it("ships goldHistory (newest-first) and NO raw ledger; still strips auth/pendingClaim", () => {
    const ledger: LedgerTx[] = [
      { token: "gold", delta: 10, reason: "mint:cashout", ts: 1 },
      { token: "scrap", delta: 5, reason: "mint:other", ts: 2 },
      { token: "gold", delta: 133, reason: "mint:daily", ts: 3, parts: [{ label: "score", delta: 28 }, { label: "daily", delta: 100 }, { label: "speed", delta: 5 }] },
    ];
    const p = baseProfile({
      ledger,
      auth: { v: 1, salt: "SECRET_SALT", phraseHash: "SECRET_HASH", sessions: {}, claimedAt: 5 },
      pendingClaim: { salt: "PSALT", phraseHash: "PHASH", nonce: "NONCE", createdAt: 9 },
    });
    const pub = publicProfile(p);
    // Raw ledger no longer leaves the server.
    expect((pub as Record<string, unknown>).ledger).toBeUndefined();
    // goldHistory: gold-only, newest-first, parts preserved verbatim.
    expect(pub.goldHistory.map((t) => t.delta)).toEqual([133, 10]);
    expect(pub.goldHistory[0].parts).toEqual([{ label: "score", delta: 28 }, { label: "daily", delta: 100 }, { label: "speed", delta: 5 }]);
    // Secrets still stripped.
    const json = JSON.stringify(pub);
    expect(json).not.toContain("SECRET_SALT");
    expect(json).not.toContain("NONCE");
    expect((pub as Record<string, unknown>).auth).toBeUndefined();
    expect((pub as Record<string, unknown>).pendingClaim).toBeUndefined();
  });
});

describe("goldHistory (pure projection)", () => {
  it("filters to gold only, newest-first", () => {
    const p = baseProfile({
      ledger: [
        { token: "gold", delta: 1, reason: "mint:daily", ts: 1 },
        { token: "scrap", delta: 9, reason: "x", ts: 2 },
        { token: "gold", delta: 2, reason: "mint:cashout", ts: 3 },
      ],
    });
    const out = goldHistory(p);
    expect(out.every((t) => t.token === "gold")).toBe(true);
    expect(out.map((t) => t.delta)).toEqual([2, 1]); // newest-first
  });

  it("caps to the last `limit` gold entries (before reversing)", () => {
    const ledger: LedgerTx[] = [];
    for (let i = 0; i < 80; i++) ledger.push({ token: "gold", delta: i, reason: "mint:daily", ts: i });
    const p = baseProfile({ ledger });
    const out = goldHistory(p, 50);
    expect(out.length).toBe(50);
    // Keeps the chronological TAIL (deltas 30..79), newest-first → 79 down to 30.
    expect(out[0].delta).toBe(79);
    expect(out[49].delta).toBe(30);
  });

  it("tolerates a missing ledger", () => {
    const p = baseProfile({});
    (p as Record<string, unknown>).ledger = undefined;
    expect(goldHistory(p)).toEqual([]);
  });
});
