import { describe, it, expect } from "vitest";
import { makeChallengeId, computeRecord, toMeta } from "/src/challenge-core.ts";

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
