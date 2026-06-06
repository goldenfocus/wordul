import { describe, it, expect } from "vitest";
import { lossKind, duelVerdict } from "/race-copy.js";

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

// The untold-duel verdict: a ?vs= challenge races in the dark (no live ghost) and the
// score settles HERE, at the end, by guesses — never by synthetic replay timing.
describe("duelVerdict", () => {
  const base = { maxGuesses: 6, name: "yang" };

  it("fewer guesses wins when both solved", () => {
    expect(duelVerdict({ ...base, myWon: true, myGuesses: 3, theirWon: true, theirGuesses: 5 }))
      .toBe("You out-worded @yang — 3/6 vs 5/6 👑");
    expect(duelVerdict({ ...base, myWon: true, myGuesses: 5, theirWon: true, theirGuesses: 3 }))
      .toBe("@yang takes it — 3/6 vs your 5/6.");
  });

  it("equal solves are a dead heat", () => {
    expect(duelVerdict({ ...base, myWon: true, myGuesses: 4, theirWon: true, theirGuesses: 4 }))
      .toBe("Dead heat — you both got it in 4/6. Twinning.");
  });

  it("a solve beats a bust either way", () => {
    expect(duelVerdict({ ...base, myWon: true, myGuesses: 6, theirWon: false, theirGuesses: 6 }))
      .toBe("You out-worded @yang — 6/6 vs X/6 👑");
    expect(duelVerdict({ ...base, myWon: false, myGuesses: 6, theirWon: true, theirGuesses: 6 }))
      .toBe("@yang takes it — 6/6 vs your X/6.");
  });

  it("both busting keeps the word's secret", () => {
    expect(duelVerdict({ ...base, myWon: false, myGuesses: 6, theirWon: false, theirGuesses: 4 }))
      .toBe("The word beat you both. Some words keep their secrets.");
  });
});
