import { describe, it, expect } from "vitest";
import { makeChallengeId, computeRecord, toMeta, ghostsOf, sanitizeGhosts } from "/src/challenge-core.ts";

describe("challenge-core", () => {
  it("makeChallengeId produces a 5-char base62 id from injected rng", () => {
    const id = makeChallengeId(() => 0);
    expect(id).toMatch(/^[0-9A-Za-z]{5}$/);
    expect(id.length).toBe(5);
  });

  it("computeRecord picks the solved attempt with fewest guesses", () => {
    const attempts = [
      { username: "amy", score: "4/6", solved: true, guesses: 4, at: 1 },
      { username: "ben", score: "X/6", solved: false, guesses: 6, at: 2 },
      { username: "cat", score: "3/6", solved: true, guesses: 3, at: 3 },
    ];
    expect(computeRecord(attempts)).toEqual({ username: "cat", score: "3/6", guesses: 3 });
  });

  it("computeRecord returns null when no one has solved", () => {
    expect(computeRecord([{ username: "ben", score: "X/6", solved: false, guesses: 6, at: 2 }])).toBeNull();
  });

  it("computeRecord breaks ties by earliest attempt", () => {
    const attempts = [
      { username: "late", score: "3/6", solved: true, guesses: 3, at: 50 },
      { username: "early", score: "3/6", solved: true, guesses: 3, at: 10 },
    ];
    expect(computeRecord(attempts).username).toBe("early");
  });

  it("toMeta never leaks the answer word", () => {
    const state = {
      id: "x7gk2", word: "SLATE", wordLength: 5, owner: "yan",
      ownerScore: "3/6", ownerGrid: [["hot","cold","cold","cold","cold"]],
      createdAt: 1, attempts: [],
    };
    const meta = toMeta(state);
    expect(meta).not.toHaveProperty("word");
    expect(JSON.stringify(meta)).not.toContain("SLATE");
    expect(meta.owner).toBe("yan");
    expect(meta.ownerScore).toBe("3/6");
    expect(meta.wordLength).toBe(5);
  });
});

describe("ghostsOf", () => {
  const base = {
    id: "Ab3Xy", word: "CRANE", wordLength: 5, owner: "paul",
    ownerScore: "4/6", ownerGrid: [], createdAt: 1, attempts: [],
  };

  it("returns null ghosts when no tape was filed", () => {
    expect(ghostsOf(base)).toEqual({ ghosts: null });
  });

  it("returns the tape and NEVER the word", () => {
    const tape = {
      v: 1, wordLength: 5, maxGuesses: 6,
      players: [{ username: "paul", host: true }],
      events: [{ t: 900, u: "paul", k: "guess", mask: ["hot", "hot", "hot", "hot", "hot"], status: "won" }],
    };
    const out = ghostsOf({ ...base, ghosts: tape });
    expect(out.ghosts).toEqual(tape);
    expect(JSON.stringify(out)).not.toContain("CRANE");
  });
});

// Mint-time gate for client-supplied tapes: POST /api/challenge forwards raw JSON
// into the DO, so anything not provably a masks-only tape must be dropped whole.
describe("sanitizeGhosts", () => {
  const valid = () => ({
    v: 1, wordLength: 5, maxGuesses: 6,
    players: [{ username: "papa", host: true }],
    events: [
      { t: 4500, u: "papa", k: "guess", mask: ["cold", "warm", "hot", "cold", "cold"], status: "playing" },
      { t: 9000, u: "papa", k: "guess", mask: ["hot", "hot", "hot", "hot", "hot"], status: "won" },
      { t: 9000, u: "papa", k: "finish", status: "won", guesses: 2 },
    ],
  });

  it("accepts a well-formed tape and strips unknown keys", () => {
    const tape = valid();
    tape.smuggled = "SLATE";
    tape.events[0].word = "CRANE";
    tape.players[0].word = "CRANE";
    const out = sanitizeGhosts(tape);
    expect(out).toBeTruthy();
    expect(JSON.stringify(out)).not.toContain("CRANE");
    expect(JSON.stringify(out)).not.toContain("SLATE");
    expect(out.events).toHaveLength(3);
    expect(out.events[0].mask).toEqual(["cold", "warm", "hot", "cold", "cold"]);
  });

  it("rejects non-color mask values", () => {
    const tape = valid();
    tape.events[0].mask[2] = "A"; // a letter where a color belongs
    expect(sanitizeGhosts(tape)).toBeUndefined();
  });

  it("rejects a mask whose length doesn't match wordLength", () => {
    const tape = valid();
    tape.events[0].mask = ["hot", "hot"];
    expect(sanitizeGhosts(tape)).toBeUndefined();
  });

  it("rejects garbage shapes outright", () => {
    expect(sanitizeGhosts(undefined)).toBeUndefined();
    expect(sanitizeGhosts(null)).toBeUndefined();
    expect(sanitizeGhosts("tape")).toBeUndefined();
    expect(sanitizeGhosts({ v: 2 })).toBeUndefined();
    expect(sanitizeGhosts({ ...valid(), events: "x" })).toBeUndefined();
    expect(sanitizeGhosts({ ...valid(), players: [] })).toBeUndefined();
  });

  it("rejects an oversized tape (event cap) and absurd dimensions", () => {
    const tape = valid();
    tape.events = Array.from({ length: 5001 }, (_, i) => ({ t: i, u: "papa", k: "typing", len: 1 }));
    expect(sanitizeGhosts(tape)).toBeUndefined();
    expect(sanitizeGhosts({ ...valid(), wordLength: 99 })).toBeUndefined();
    expect(sanitizeGhosts({ ...valid(), maxGuesses: 0 })).toBeUndefined();
  });

  it("forces t monotonic and finite", () => {
    const tape = valid();
    tape.events[1].t = -5; // travels back in time
    expect(sanitizeGhosts(tape)).toBeUndefined();
    const inf = valid();
    inf.events[0].t = Infinity;
    expect(sanitizeGhosts(inf)).toBeUndefined();
  });
});
