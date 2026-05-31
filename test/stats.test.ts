import { describe, it, expect } from "vitest";
import { emptyStats, applyGame, appendCapped } from "../src/stats.ts";

describe("applyGame", () => {
  it("counts plays, wins, streaks and guess distribution", () => {
    let s = emptyStats();
    s = applyGame(s, { result: "won", guesses: 3 });
    s = applyGame(s, { result: "won", guesses: 4 });
    expect(s).toMatchObject({
      gamesPlayed: 2, wins: 2, currentStreak: 2, bestStreak: 2,
      guessDistribution: { 3: 1, 4: 1 },
    });
  });
  it("resets current streak on a loss but keeps best", () => {
    let s = emptyStats();
    s = applyGame(s, { result: "won", guesses: 2 });
    s = applyGame(s, { result: "won", guesses: 2 });
    s = applyGame(s, { result: "lost", guesses: 8 });
    expect(s.currentStreak).toBe(0);
    expect(s.bestStreak).toBe(2);
    expect(s.gamesPlayed).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.guessDistribution[8]).toBeUndefined(); // losses don't count
  });
});

describe("appendCapped", () => {
  it("prepends most-recent and drops oldest beyond cap", () => {
    const out = appendCapped([3, 2, 1], 4, 3);
    expect(out).toEqual([4, 3, 2]);
  });
});
