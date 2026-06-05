import { describe, it, expect } from "vitest";
import { countVowels, greenedPositions, revealUngreened } from "../src/color.ts";
import type { Color } from "../src/color.ts";

const row = (mask: Color[]) => ({ mask });
const G: Color = "hot", Y: Color = "warm", X: Color = "cold";

describe("countVowels", () => {
  it("counts A E I O U (case-insensitive)", () => {
    expect(countVowels("CRANE")).toBe(2);
    expect(countVowels("rhythm")).toBe(0);
    expect(countVowels("AUDIO")).toBe(4);
  });
});

describe("greenedPositions", () => {
  it("unions green indices across guesses", () => {
    const s = greenedPositions([row([G, X, X, X, X]), row([X, X, G, X, X])]);
    expect([...s].sort()).toEqual([0, 2]);
  });
});

describe("revealUngreened", () => {
  it("returns the leftmost not-yet-green position + its letter", () => {
    // col 0 already green → reveal should skip it and return col 1
    expect(revealUngreened("CRANE", [row([G, X, X, X, X])])).toEqual({ index: 1, letter: "R" });
  });
  it("returns the first position when nothing greened", () => {
    expect(revealUngreened("CRANE", [])).toEqual({ index: 0, letter: "C" });
  });
  it("returns null when every position is greened", () => {
    expect(revealUngreened("CAT", [row([G, G, G])])).toBeNull();
  });
  it("skips positions the player already knows (progressive reveal)", () => {
    // index 0 already revealed → next buy returns index 1
    expect(revealUngreened("CRANE", [], [0])).toEqual({ index: 1, letter: "R" });
    // 0 and 1 known → returns index 2
    expect(revealUngreened("CRANE", [], [0, 1])).toEqual({ index: 2, letter: "A" });
  });
  it("returns null when greened + known cover the whole word", () => {
    expect(revealUngreened("CAT", [row([G, X, X])], [1, 2])).toBeNull();
  });
});
