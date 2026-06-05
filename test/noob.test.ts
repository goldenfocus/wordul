import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { noobGuess, NOOB, mistakeRateFor } from "../src/noob.ts";
import { computeNextGuess, type BotView } from "../src/solver.ts";
import { WORDS_BY_SIZE } from "../src/wordsbysize.ts";

describe("noobGuess", () => {
  it("never returns a word of the wrong length", () => {
    for (const wordLength of [5, 6, 7]) {
      const view: BotView = { wordLength, ownGuesses: [] };
      for (const roll of [0, 0.2, 0.39, 0.4, 0.7, 0.99]) {
        expect(noobGuess(view, NOOB, roll).length).toBe(wordLength);
      }
    }
  });

  it("returns the sharp guess when roll >= mistakeRate (boundary + high)", () => {
    const view: BotView = { wordLength: 5, ownGuesses: [] };
    const sharp = computeNextGuess(view);
    expect(noobGuess(view, NOOB, NOOB.mistakeRate)).toBe(sharp); // boundary: >= is sharp
    expect(noobGuess(view, NOOB, 0.99)).toBe(sharp);
  });

  it("returns a legal sub-optimal green-honoring word when roll < mistakeRate", () => {
    // Confirmed green 'C' at position 0.
    const view: BotView = {
      wordLength: 5,
      ownGuesses: [{ word: "CRANE", mask: ["hot", "cold", "cold", "cold", "cold"] }],
    };
    const sharp = computeNextGuess(view);
    const slip = noobGuess(view, NOOB, 0);
    expect(slip.length).toBe(5);
    expect(WORDS_BY_SIZE[5].answers).toContain(slip); // legal answer-pool word
    expect(slip[0]).toBe("C"); // honors the confirmed green
    expect(slip).not.toBe(sharp); // a believable slip, not the optimal play
  });

  it("imports nothing answer-bearing (src-reading blindness guard)", () => {
    // Mirrors solver.test.ts:65-77 — inspect CODE not prose. This guard lives HERE,
    // not in module-graph.test.ts (which only scans public/ and cannot see src/).
    const raw = readFileSync(new URL("../src/noob.ts", import.meta.url), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["']\.\/room/);
    expect(code).not.toMatch(/from\s+["']\.\/user/);
    expect(code).not.toMatch(/from\s+["']\.\/daily/);
    expect(code).not.toMatch(/from\s+["']\.\/economy/);
    expect(code).not.toMatch(/scoreGuess/);
    expect(code).not.toMatch(/\.word\b/); // must destructure { word, mask }, never .word access
  });
});

describe("mistakeRateFor", () => {
  it("equals the base NOOB rate at length 5 and below", () => {
    expect(mistakeRateFor(4)).toBeCloseTo(NOOB.mistakeRate);
    expect(mistakeRateFor(5)).toBeCloseTo(NOOB.mistakeRate);
  });

  it("rises monotonically with length above 5", () => {
    expect(mistakeRateFor(6)).toBeGreaterThan(mistakeRateFor(5));
    expect(mistakeRateFor(7)).toBeGreaterThan(mistakeRateFor(6));
    expect(mistakeRateFor(9)).toBeGreaterThan(mistakeRateFor(7));
  });

  it("never reaches certainty (stays a valid probability)", () => {
    for (const len of [5, 6, 7, 8, 9, 10, 11, 12]) {
      const r = mistakeRateFor(len);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });
});

describe("mistakeRateFor(length, opponents)", () => {
  it("defaults to the single-opponent rate when opponents is omitted", () => {
    expect(mistakeRateFor(5)).toBe(mistakeRateFor(5, 1));
  });

  it("is non-decreasing in length", () => {
    for (let len = 4; len < 12; len++) {
      expect(mistakeRateFor(len + 1, 1)).toBeGreaterThanOrEqual(mistakeRateFor(len, 1));
    }
  });

  it("is non-decreasing in opponents (more bots → each fumbles a bit more)", () => {
    for (let opp = 1; opp < 6; opp++) {
      expect(mistakeRateFor(6, opp + 1)).toBeGreaterThanOrEqual(mistakeRateFor(6, opp));
    }
  });

  it("stays strictly below 1 even at the extremes", () => {
    expect(mistakeRateFor(12, 8)).toBeLessThan(1);
    expect(mistakeRateFor(12, 8)).toBeGreaterThanOrEqual(0);
  });
});
