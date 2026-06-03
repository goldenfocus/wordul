import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { noobGuess, NOOB } from "../src/noob.ts";
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
      ownGuesses: [{ word: "CRANE", mask: ["green", "gray", "gray", "gray", "gray"] }],
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
