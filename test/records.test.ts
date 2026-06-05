import { describe, it, expect } from "vitest";
import { buildGameRecords, encodeSolveGrid, encodeSolveWords, toPublicGame } from "../src/records.ts";

describe("encodeSolveGrid", () => {
  it("encodes each guess mask as a g/y/x row string", () => {
    const grid = encodeSolveGrid([
      { mask: ["gray", "yellow", "gray", "gray", "green"] },
      { mask: ["green", "green", "green", "green", "green"] },
    ]);
    expect(grid).toEqual(["xyxxg", "ggggg"]);
  });

  it("returns an empty array for no rows", () => {
    expect(encodeSolveGrid([])).toEqual([]);
  });
});

describe("encodeSolveWords", () => {
  it("uppercases each guessed word, parallel to the grid rows", () => {
    expect(encodeSolveWords([{ word: "arose" }, { word: "Brave" }])).toEqual(["AROSE", "BRAVE"]);
  });
  it("tolerates missing words and no rows", () => {
    expect(encodeSolveWords([{}])).toEqual([""]);
    expect(encodeSolveWords([])).toEqual([]);
  });
});

describe("toPublicGame (live-daily letter guard)", () => {
  const rec = {
    roomPath: "daily/2026-06-05", finishedAt: 1, wordLength: 5, word: "CRANK",
    result: "won" as const, guesses: 2, opponents: [], solveGrid: ["yxxxx", "ggggg"], words: ["AUDIO", "CRANK"],
  };
  it("drops the top-level word always, keeps colors + letters for a NON-live game", () => {
    const pub = toPublicGame(rec, "daily/2026-06-04");
    expect((pub as Record<string, unknown>).word).toBeUndefined();
    expect(pub.solveGrid).toEqual(["yxxxx", "ggggg"]);
    expect(pub.words).toEqual(["AUDIO", "CRANK"]);
  });
  it("strips the letters (word + words) for the LIVE daily, keeps colors", () => {
    const pub = toPublicGame(rec, "daily/2026-06-05");
    expect(JSON.stringify(pub)).not.toContain("CRANK");
    expect(pub.words).toBeUndefined();
    expect(pub.solveGrid).toEqual(["yxxxx", "ggggg"]);
  });
});

describe("buildGameRecords", () => {
  it("builds one personalized record per player with the others as opponents", () => {
    const recs = buildGameRecords({
      roomPath: "yan/friday-night",
      word: "CRANE",
      wordLength: 5,
      finishedAt: 1000,
      players: [
        { username: "yan", status: "won", guesses: 3 },
        { username: "bob", status: "lost", guesses: 6 },
      ],
    });
    expect(recs.yan).toEqual({
      roomPath: "yan/friday-night", word: "CRANE", wordLength: 5, finishedAt: 1000,
      result: "won", guesses: 3,
      opponents: [{ username: "bob", result: "lost", guesses: 6 }],
    });
    expect(recs.bob.result).toBe("lost");
    expect(recs.bob.opponents).toEqual([{ username: "yan", result: "won", guesses: 3 }]);
  });
  it("treats a still-playing status as a loss at finish", () => {
    const recs = buildGameRecords({
      roomPath: "yan/x", word: "PLAID", wordLength: 5, finishedAt: 1,
      players: [{ username: "yan", status: "playing", guesses: 2 }],
    });
    expect(recs.yan.result).toBe("lost");
  });
});
