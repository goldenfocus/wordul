import { describe, it, expect } from "vitest";
import { newGreensInLast, newYellowsInLast, orderedDiscoveriesInLast } from "/celebrate.js";

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

describe("newYellowsInLast", () => {
  it("returns 0 for no guesses", () => {
    expect(newYellowsInLast([])).toBe(0);
    expect(newYellowsInLast(undefined)).toBe(0);
  });
  it("counts yellows in the only guess", () => {
    expect(newYellowsInLast([g("CRANE", [Y, X, Y, X, X])])).toBe(2);
  });
  it("only counts yellows that are NEW per position vs prior guesses", () => {
    const guesses = [
      g("CRANE", [Y, X, X, X, X]),   // col 0 yellow
      g("COVEN", [Y, X, Y, X, X]),   // col 0 already yellow, col 2 is new
    ];
    expect(newYellowsInLast(guesses)).toBe(1);
  });
  it("ignores greens", () => {
    expect(newYellowsInLast([g("CRANE", [G, G, X, X, X])])).toBe(0);
  });
  it("does not re-pay a moving yellow (letter already proven present)", () => {
    // R proven present in guess1; relocating it in guess2 earns no new yellow.
    const guesses = [g("CRANE", [X, Y, X, X, X]), g("RUMBA", [Y, X, X, X, X])];
    expect(newYellowsInLast(guesses)).toBe(0);
  });
});

describe("orderedDiscoveriesInLast", () => {
  it("returns [] for no guesses", () => {
    expect(orderedDiscoveriesInLast([])).toEqual([]);
    expect(orderedDiscoveriesInLast(undefined)).toEqual([]);
  });
  it("returns [] when the latest row has no mask", () => {
    expect(orderedDiscoveriesInLast([{ word: "CRANE" }])).toEqual([]);
  });
  it("orders yellows before greens in a single guess (small→big)", () => {
    // CRANE: C yellow (0), N green (3). Yellow must come first.
    expect(orderedDiscoveriesInLast([g("CRANE", [Y, X, X, G, X])])).toEqual([
      { index: 0, kind: "yellow", letter: "C" },
      { index: 3, kind: "green", letter: "N" },
    ]);
  });
  it("returns ALL yellows (ascending index) THEN all greens (ascending index)", () => {
    // CRANE: yellows at 1,4 (R,E); greens at 0,2 (C,A).
    expect(orderedDiscoveriesInLast([g("CRANE", [G, Y, G, X, Y])])).toEqual([
      { index: 1, kind: "yellow", letter: "R" },
      { index: 4, kind: "yellow", letter: "E" },
      { index: 0, kind: "green", letter: "C" },
      { index: 2, kind: "green", letter: "A" },
    ]);
  });
  it("excludes greens already discovered at that position in an earlier guess", () => {
    const guesses = [
      g("CRANE", [G, X, X, X, X]),   // col 0 green
      g("COVEN", [G, X, X, G, X]),   // col 0 already green; col 3 is NEW
    ];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([
      { index: 3, kind: "green", letter: "E" },
    ]);
  });
  it("excludes a yellow whose LETTER was already proven present in an earlier guess", () => {
    const guesses = [
      g("CRANE", [Y, X, X, X, X]),   // C proven present (yellow)
      g("COVEN", [Y, X, Y, X, X]),   // C already present (dropped); V is NEW
    ];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([
      { index: 2, kind: "yellow", letter: "V" },
    ]);
  });
  it("handles duplicate letters per position, not per letter", () => {
    // SASSY: same letter S green at index 0 and yellow at index 2 — counted by
    // position, so both surface (green after yellow in beat order).
    expect(orderedDiscoveriesInLast([g("SASSY", [G, X, Y, X, X])])).toEqual([
      { index: 2, kind: "yellow", letter: "S" },
      { index: 0, kind: "green", letter: "S" },
    ]);
  });
  // REGRESSION (F6): the client discovery list must match the SERVER mint
  // (src/economy.ts) so the hacker-log never shows a line the server never paid.
  // The server dedups yellows BY LETTER (a known-present letter relocating earns
  // nothing); the client used to dedup BY POSITION and re-paid "moving" yellows,
  // surfacing phantom "yellow X" lines that the authoritative mint never produced.
  describe("no double-pay parity with the server mint (src/economy.ts)", () => {
    it("CRANE → CRANK: guess2 yields ONLY the new green K (no phantom yellow, no re-paid greens)", () => {
      const guesses = [g("CRANE", [G, G, G, G, X]), g("CRANK", [G, G, G, G, G])];
      expect(orderedDiscoveriesInLast(guesses)).toEqual([
        { index: 4, kind: "green", letter: "K" },
      ]);
    });
    it("a moving yellow letter pays its yellow ONCE, not again at a new position", () => {
      // R yellow at pos1 in guess1 (letter proven present). In guess2 R just relocates
      // to pos0 — the server pays nothing; the client must NOT log a phantom yellow R.
      const guesses = [g("CRANE", [X, Y, X, X, X]), g("RUMBA", [Y, X, X, X, X])];
      expect(orderedDiscoveriesInLast(guesses)).toEqual([]);
    });
    it("a yellow letter that later lands green still pays its green (position never green)", () => {
      // R yellow pos1 guess1 (present). guess2 BREAD: R green at pos1 → new green pays.
      const guesses = [g("CRANE", [X, Y, X, X, X]), g("BREAD", [X, G, X, X, X])];
      expect(orderedDiscoveriesInLast(guesses)).toEqual([
        { index: 1, kind: "green", letter: "R" },
      ]);
    });
  });

  it("matches newGreensInLast / newYellowsInLast counts (invariant)", () => {
    const fixtures = [
      [g("CRANE", [Y, X, X, G, X])],
      [g("CRANE", [G, Y, G, X, Y])],
      [
        g("CRANE", [G, X, X, X, X]),
        g("COVEN", [G, X, X, G, X]),
      ],
      [
        g("CRANE", [Y, X, X, X, X]),
        g("COVEN", [Y, X, Y, X, X]),
      ],
      [g("SASSY", [G, X, Y, X, X])],
    ];
    for (const f of fixtures) {
      const out = orderedDiscoveriesInLast(f);
      expect(out.filter((d) => d.kind === "green").length).toBe(newGreensInLast(f));
      expect(out.filter((d) => d.kind === "yellow").length).toBe(newYellowsInLast(f));
    }
  });
});
