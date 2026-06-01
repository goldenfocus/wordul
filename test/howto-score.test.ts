import { describe, it, expect } from "vitest";
import { score } from "../public/howto.js";
import { scoreGuess } from "../src/color.ts";

// The /how-to-play demos color tiles with a JS port of scoreGuess (public/howto.js).
// This test guarantees the port never drifts from the real server-side scorer — if
// someone changes scoring in color.ts, the demos must still tell the truth.

describe("howto demo scorer matches the real scoreGuess", () => {
  it("agrees on hand-picked cases incl. duplicate letters", () => {
    const cases: [string, string][] = [
      ["SLATE", "REACT"],
      ["TRACE", "REACT"],
      ["REACT", "REACT"],
      ["ALLOY", "LLAMA"], // duplicate L: the leftover-counter case
      ["EERIE", "THERE"], // multiple E's
      ["SPEED", "ERASE"],
      ["ABBEY", "BABES"],
    ];
    for (const [guess, answer] of cases) {
      expect(score(guess, answer)).toEqual(scoreGuess(guess, answer));
    }
  });

  it("agrees across many deterministic random pairs", () => {
    const words = [
      "REACT", "MONEY", "SLATE", "CRANE", "LLAMA", "ERASE", "THERE", "ABBEY",
      "SPEED", "ARISE", "NOTED", "TRACE", "EERIE", "ALLOY", "BABES", "STEEL",
    ];
    for (const guess of words) {
      for (const answer of words) {
        expect(score(guess, answer)).toEqual(scoreGuess(guess, answer));
      }
    }
  });
});
