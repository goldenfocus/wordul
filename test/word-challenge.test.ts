// Wiki word challenge — the pure server pieces (spec:
// docs/superpowers/specs/2026-06-05-wiki-word-challenge-design.md).
import { describe, it, expect } from "vitest";
import { wordChallengeIdFromBytes, addAttempt } from "../src/challenge-core.ts";
import { tapeFromSolveGrid } from "../src/ghost-core.ts";
import { bestGameForWord, type GameRecord } from "../src/records.ts";

describe("wordChallengeIdFromBytes", () => {
  it("maps hash bytes to a 5-char base62 id (route-compatible)", () => {
    const id = wordChallengeIdFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect(id).toMatch(/^[0-9A-Za-z]{5}$/);
  });

  it("is deterministic and input-sensitive", () => {
    // The id reads the digest's first 5 bytes (SHA-256 diffuses any input change
    // across all of them) — so the test inputs differ within that window.
    const a = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    const b = new Uint8Array([9, 9, 9, 9, 8, 9, 9, 9, 9, 9]);
    expect(wordChallengeIdFromBytes(a)).toBe(wordChallengeIdFromBytes(a));
    expect(wordChallengeIdFromBytes(a)).not.toBe(wordChallengeIdFromBytes(b));
  });
});

describe("word→id over the REAL answer list", () => {
  it("no two answer words share a canonical challenge id (collision ratchet)", async () => {
    // 62^5 ≈ 916M ids for ~2.3k words — collisions are astronomically unlikely, but a
    // collision would silently merge two words' leaderboards, so we pin it here.
    const { ANSWER_WORDS } = await import("../src/words.ts");
    const seen = new Map<string, string>();
    for (const word of ANSWER_WORDS) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`word:${word.toUpperCase()}`));
      const id = wordChallengeIdFromBytes(new Uint8Array(digest));
      const prior = seen.get(id);
      expect(prior, `id collision: ${prior} vs ${word} → ${id}`).toBeUndefined();
      seen.set(id, word);
    }
    expect(seen.size).toBe(ANSWER_WORDS.size);
  });
});

describe("addAttempt — one-shot per username", () => {
  const first = { username: "papa", score: "4/6", solved: true, guesses: 4, at: 100 };

  it("keeps the FIRST attempt; a repeat changes nothing", () => {
    const attempts = [first];
    const repeat = addAttempt(attempts, { username: "papa", score: "2/6", solved: true, guesses: 2, at: 200 });
    expect(repeat).toBe(true);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].guesses).toBe(4); // the 2/6 re-roll never lands
  });

  it("a new player's first attempt lands", () => {
    const attempts = [first];
    const repeat = addAttempt(attempts, { username: "pina", score: "3/6", solved: true, guesses: 3, at: 300 });
    expect(repeat).toBe(false);
    expect(attempts).toHaveLength(2);
  });
});

describe("tapeFromSolveGrid", () => {
  it("re-cuts a stored colors-only grid into a cadence-paced ghost tape", () => {
    const tape = tapeFromSolveGrid({
      username: "papa", wordLength: 5, maxGuesses: 6,
      solveGrid: ["xxyxx", "xygxx", "ggggg"], won: true,
    });
    expect(tape).not.toBeNull();
    const guesses = tape!.events.filter((e) => e.k === "guess");
    expect(guesses).toHaveLength(3);
    expect(guesses[0].k === "guess" && guesses[0].mask).toEqual(["cold", "cold", "warm", "cold", "cold"]);
    expect(guesses[2].k === "guess" && guesses[2].status).toBe("won");
    const finish = tape!.events[tape!.events.length - 1];
    expect(finish).toMatchObject({ k: "finish", status: "won", guesses: 3 });
    // Cadence: strictly increasing, watchable pacing.
    const ts = tape!.events.map((e) => e.t);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
    expect(ts[ts.length - 1]).toBeLessThan(60_000);
  });

  it("rejects malformed rows (wrong length / unknown cell) — never a corrupt tape", () => {
    expect(tapeFromSolveGrid({ username: "p", wordLength: 5, maxGuesses: 6, solveGrid: ["xx"], won: false })).toBeNull();
    expect(tapeFromSolveGrid({ username: "p", wordLength: 5, maxGuesses: 6, solveGrid: ["xxAxx"], won: false })).toBeNull();
    expect(tapeFromSolveGrid({ username: "p", wordLength: 5, maxGuesses: 6, solveGrid: [], won: false })).toBeNull();
  });

  it("never contains letters — masks and metadata only", () => {
    const tape = tapeFromSolveGrid({
      username: "papa", wordLength: 5, maxGuesses: 6, solveGrid: ["ggggg"], won: true,
    });
    const json = JSON.stringify(tape);
    expect(json).not.toMatch(/"word"/);
    expect(json).not.toMatch(/[A-FH-VX-Z]{5}/); // no 5-letter uppercase payloads beyond color names
  });
});

describe("bestGameForWord", () => {
  const g = (over: Partial<GameRecord>): GameRecord => ({
    roomPath: "daily/2026-06-01", finishedAt: 1, wordLength: 5, word: "OCEAN",
    result: "won", guesses: 4, opponents: [], solveGrid: ["xxxxx", "ggggg"], ...over,
  });

  it("prefers the best win (fewest guesses)", () => {
    const games = [
      g({ guesses: 4, finishedAt: 10 }),
      g({ guesses: 3, finishedAt: 5, solveGrid: ["xxyxx", "ggggg"] }),
      g({ word: "SLATE", guesses: 2, finishedAt: 20 }), // other word — ignored
    ];
    expect(bestGameForWord(games, "OCEAN")?.guesses).toBe(3);
  });

  it("falls back to the most recent run when no win exists", () => {
    const games = [
      g({ result: "lost", guesses: 6, finishedAt: 10 }),
      g({ result: "lost", guesses: 6, finishedAt: 50, solveGrid: ["yyyyy"] }),
    ];
    expect(bestGameForWord(games, "OCEAN")?.solveGrid).toEqual(["yyyyy"]);
  });

  it("returns null when the word was never played or grid is missing", () => {
    expect(bestGameForWord([g({ word: "SLATE" })], "OCEAN")).toBeNull();
    expect(bestGameForWord([g({ solveGrid: undefined })], "OCEAN")).toBeNull();
    expect(bestGameForWord([], "OCEAN")).toBeNull();
  });

  it("matches case-insensitively (records store uppercase)", () => {
    expect(bestGameForWord([g({})], "ocean")).not.toBeNull();
  });
});
