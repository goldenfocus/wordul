import { describe, it, expect } from "vitest";
import { buildShareCardModel } from "/share-card.js";

describe("share-card model", () => {
  const guesses = [
    { word: "CRANE", mask: ["gray","gray","yellow","gray","green"] },
    { word: "SLATE", mask: ["green","green","green","green","green"] },
  ];

  it("carries the color grid, name, score, phrase, and cta — but NEVER the word", () => {
    const m = buildShareCardModel({ username: "yan", guesses, won: true, score: "2/6",
      answer: "SLATE", challengeUrl: "wordul.com/c/x7gk2" });
    expect(m.grid).toEqual([["gray","gray","yellow","gray","green"], ["green","green","green","green","green"]]);
    expect(m.name).toBe("@yan");
    expect(m.score).toBe("2/6");
    expect(typeof m.phrase).toBe("string");
    expect(m.phrase.length).toBeGreaterThan(0);
    expect(m.cta).toBe("wordul.com/c/x7gk2");
    expect(JSON.stringify(m)).not.toContain("SLATE");
    expect(m).not.toHaveProperty("answer");
    expect(m).not.toHaveProperty("words");
  });

  it("marks a loss with X score", () => {
    const m = buildShareCardModel({ username: "amy", guesses: [guesses[0]], won: false,
      score: "X/6", answer: "SLATE", challengeUrl: "wordul.com/c/x7gk2" });
    expect(m.score).toBe("X/6");
    expect(m.won).toBe(false);
  });
});
