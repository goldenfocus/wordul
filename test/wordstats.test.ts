import { describe, it, expect } from "vitest";
import { emptyWordStats, applyWordGame, deriveWordStats } from "../src/wordstats.ts";

describe("word stats", () => {
  it("counts answered, wins and guess distribution", () => {
    let s = emptyWordStats();
    s = applyWordGame(s, { result: "won", guesses: 3 });
    s = applyWordGame(s, { result: "won", guesses: 4 });
    s = applyWordGame(s, { result: "lost", guesses: 6 });
    expect(s.answered).toBe(3);
    expect(s.wins).toBe(2);
    expect(s.guessDistribution).toEqual({ 3: 1, 4: 1 });
  });
  it("derives solve rate and average guesses (wins only)", () => {
    let s = emptyWordStats();
    s = applyWordGame(s, { result: "won", guesses: 2 });
    s = applyWordGame(s, { result: "won", guesses: 4 });
    s = applyWordGame(s, { result: "lost", guesses: 6 });
    const v = deriveWordStats(s);
    expect(v.answered).toBe(3);
    expect(v.solveRate).toBeCloseTo(2 / 3);
    expect(v.avgGuesses).toBeCloseTo(3); // (2+4)/2
  });
  it("never-played derives to neverPlayed", () => {
    const v = deriveWordStats(emptyWordStats());
    expect(v.neverPlayed).toBe(true);
    expect(v.avgGuesses).toBeNull();
  });
});
