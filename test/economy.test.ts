import { describe, it, expect } from "vitest";
import {
  POINTS, SPEED_CAP, SPEED_WINDOW_MS, comboMultiplier, escalatedPenalty,
  orderedDiscoveriesInLast, deadLettersFrom, wastedDeadLettersInLast,
  pointsEarned, speedBonusPoints, goldFromPoints, balance,
} from "../src/economy.ts";
import type { GuessRow } from "../src/economy.ts";

// helper: build a GuessRow from a word + a mask string ("g"=green,"y"=yellow,"x"=gray)
const row = (word: string, m: string): GuessRow => ({
  word: word.toUpperCase(),
  mask: [...m].map((c) => (c === "g" ? "green" : c === "y" ? "yellow" : "gray")),
});

describe("comboMultiplier", () => {
  it("is 1x for 0-1 discoveries, scales 0.5 per extra", () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBe(1.5);
    expect(comboMultiplier(5)).toBe(3);
  });
});

describe("escalatedPenalty", () => {
  it("is base on first reuse, linear after", () => {
    expect(escalatedPenalty(50, 0)).toBe(50);
    expect(escalatedPenalty(50, 2)).toBe(150);
  });
});

describe("orderedDiscoveriesInLast", () => {
  it("lists new yellows then new greens, ascending, dup-safe", () => {
    const guesses = [row("CRANE", "gyxxx")]; // C green, R yellow
    const d = orderedDiscoveriesInLast(guesses);
    expect(d.map((x) => x.kind)).toEqual(["yellow", "green"]);
    expect(d.map((x) => x.index)).toEqual([1, 0]);
  });
  it("does not re-count a color already seen at that index", () => {
    const guesses = [row("CRANE", "gxxxx"), row("CLOUD", "gxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]); // C green was already green
  });

  it("a moving yellow letter pays its yellow once, not again at a new position", () => {
    // R proven present (yellow) at pos1 in guess1; reappears yellow at pos0 in guess2.
    // Dedup by LETTER → no new yellow discovery for R in guess2.
    const guesses = [row("CRANE", "xyxxx"), row("RUMBA", "yxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]);
  });

  it("yellow→green upgrade: the green still pays (dedup green by POSITION)", () => {
    // R yellow at pos1 in guess1 (letter proven present). In guess2 R lands green at pos1.
    // Green dedup is by position; pos1 was never green before → green R pos1 pays.
    const guesses = [row("CRANE", "xyxxx"), row("BREAD", "xgxxx")];
    const d = orderedDiscoveriesInLast(guesses);
    expect(d).toEqual([{ index: 1, kind: "green", letter: "R" }]);
  });

  it("a carried green never re-pays at the same position", () => {
    const guesses = [row("CRANE", "gxxxx"), row("CLOUD", "gxxxx"), row("CHALK", "gxxxx")];
    expect(orderedDiscoveriesInLast(guesses)).toEqual([]); // C green at pos0 long proven
  });
});

describe("deadLettersFrom / wastedDeadLettersInLast", () => {
  it("marks a gray-everywhere letter dead and flags its reuse", () => {
    const prior = [row("CRANE", "xxxxx")]; // all gray -> C,R,A,N,E dead
    expect(deadLettersFrom(prior).has("C")).toBe(true);
    const guesses = [...prior, row("CLOUD", "xxxxx")];
    expect(wastedDeadLettersInLast(guesses)).toEqual({ letters: ["C"], count: 1 });
  });
  it("a letter green somewhere is never dead (dup-safe)", () => {
    const prior = [row("EERIE", "gxxxx")]; // first E green -> E not dead
    expect(deadLettersFrom(prior).has("E")).toBe(false);
  });
});

describe("pointsEarned", () => {
  it("pays greens+yellows with combo and a solve+speed bonus", () => {
    // 5 greens, combo(5)=3x -> round(500*3)=1500, +solve 500 +speed 300*5=1500 => 3500
    const guesses = [row("CRANE", "ggggg")];
    expect(pointsEarned(guesses, 6)).toBe(1500 + 500 + 1500);
  });
  it("subtracts capped, escalating wasted-letter penalties", () => {
    // guess1 all gray (C,R,A,N,E dead), guess2 "CRUMB" reuses C and R (2 dead letters),
    // no discoveries -> 50 + 50 = 100 penalty, total -100.
    const guesses = [row("CRANE", "xxxxx"), row("CRUMB", "xxxxx")];
    expect(pointsEarned(guesses, 6)).toBe(-100);
  });
});

describe("speedBonusPoints", () => {
  it("decays linearly from SPEED_CAP at 0ms to 0 at the window edge", () => {
    expect(SPEED_CAP).toBe(500);
    expect(SPEED_WINDOW_MS).toBe(180000);
    expect(speedBonusPoints(0)).toBe(500);
    expect(speedBonusPoints(90000)).toBe(250);
    expect(speedBonusPoints(180000)).toBe(0);
    expect(speedBonusPoints(200000)).toBe(0); // clamps over-window to 0
    expect(speedBonusPoints(-50)).toBe(500);  // clamps negatives (elapsed never < 0)
  });
});

describe("CRANE → CRANK economy case", () => {
  // Answer CRANK. Guess1 CRANE → C,R,A,N green, E gray. Guess2 CRANK → all green (solve).
  const guesses = [row("CRANE", "ggggx"), row("CRANK", "ggggg")];

  it("guess2 yields only the new green K at pos5 (no re-paid greens, no phantom yellow)", () => {
    expect(orderedDiscoveriesInLast(guesses)).toEqual([
      { index: 4, kind: "green", letter: "K" },
    ]);
  });

  it("pointsEarned reflects the discoveries + solve, independent of the speed clock", () => {
    // guess1: 4 new greens, combo(4)=2.5× → round(400*2.5)=1000.
    // guess2: 1 new green (K), combo(1)=1× → 100. Solve at guess2: +500 +300*guessesLeft(6-2=4)=1200.
    // pointsEarned uses the GUESS-count speed bonus (speedPerGuessLeft), not wall-clock speedBonusPoints.
    expect(pointsEarned(guesses, 6)).toBe(1000 + 100 + 500 + 1200);
  });
});

describe("goldFromPoints", () => {
  it("converts points to gold and never mints negative", () => {
    expect(goldFromPoints(3500)).toBe(35);
    expect(goldFromPoints(-100)).toBe(0);
  });
});

describe("balance", () => {
  it("sums signed deltas for a token and allows negative", () => {
    const led = [
      { token: "gold", delta: 100, reason: "mint:cashout", ts: 1 },
      { token: "gold", delta: -300, reason: "spend:buyin", ts: 2 },
      { token: "other", delta: 999, reason: "x", ts: 3 },
    ];
    expect(balance(led, "gold")).toBe(-200);
  });
});
