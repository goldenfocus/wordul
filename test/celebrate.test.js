import { describe, it, expect } from "vitest";
import { newGreensInLast } from "/celebrate.js";

const g = (word, mask) => ({ word, mask });
const G = "green", Y = "yellow", X = "gray";

describe("newGreensInLast", () => {
  it("returns 0 for no guesses", () => {
    expect(newGreensInLast([])).toBe(0);
    expect(newGreensInLast(undefined)).toBe(0);
  });
  it("counts greens in the only guess", () => {
    expect(newGreensInLast([g("CRANE", [G, X, X, G, X])])).toBe(2);
  });
  it("only counts greens that are NEW vs prior guesses", () => {
    const guesses = [
      g("CRANE", [G, X, X, X, X]),   // col 0 green
      g("COVEN", [G, X, X, G, X]),   // col 0 already green, col 3 is new
    ];
    expect(newGreensInLast(guesses)).toBe(1);
  });
  it("returns 0 when the latest guess adds no new greens", () => {
    const guesses = [
      g("CRANE", [G, X, G, X, X]),
      g("CHILD", [G, X, G, X, X]),   // same greens, nothing new
    ];
    expect(newGreensInLast(guesses)).toBe(0);
  });
  it("ignores yellows", () => {
    expect(newGreensInLast([g("CRANE", [Y, Y, X, X, Y])])).toBe(0);
  });
});
