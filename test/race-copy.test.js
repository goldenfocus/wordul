import { describe, it, expect } from "vitest";
import { lossKind } from "/race-copy.js";

describe("lossKind", () => {
  it("outpaced: lost with rows left while another player won", () => {
    expect(lossKind({ status: "lost", guessCount: 2, maxGuesses: 6, winner: "pax", me: "yan" })).toBe("outpaced");
  });
  it("exhausted: lost after using every row", () => {
    expect(lossKind({ status: "lost", guessCount: 6, maxGuesses: 6, winner: "pax", me: "yan" })).toBe("exhausted");
  });
  it("exhausted: lost with no winner (everyone ran out)", () => {
    expect(lossKind({ status: "lost", guessCount: 6, maxGuesses: 6, winner: null, me: "yan" })).toBe("exhausted");
  });
  it("null when I won or am still playing", () => {
    expect(lossKind({ status: "won", guessCount: 3, maxGuesses: 6, winner: "yan", me: "yan" })).toBe(null);
    expect(lossKind({ status: "playing", guessCount: 1, maxGuesses: 6, winner: null, me: "yan" })).toBe(null);
  });
  it("exhausted when the winner is me (defensive)", () => {
    expect(lossKind({ status: "lost", guessCount: 2, maxGuesses: 6, winner: "yan", me: "yan" })).toBe("exhausted");
  });
});
