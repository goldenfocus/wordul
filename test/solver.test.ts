import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { scoreGuess } from "../src/color.ts";
import { WORDS_BY_SIZE } from "../src/wordsbysize.ts";
import { computeNextGuess, type BotView } from "../src/solver.ts";

// v0.0000 — "it twitches": prove a blind solver can play one real game from
// public masks alone, and prove it is STRUCTURALLY incapable of seeing the answer.

// Drive a full game against a known answer using the REAL scoreGuess, exactly
// as the room would. The solver only ever receives the masks it earned.
function playToEnd(answer: string, maxGuesses = 12, style = 0): string[] {
  const view: BotView = { wordLength: answer.length, ownGuesses: [] };
  const played: string[] = [];
  for (let i = 0; i < maxGuesses; i++) {
    const word = computeNextGuess(view, style);
    played.push(word);
    const mask = scoreGuess(word, answer);
    view.ownGuesses.push({ word, mask });
    if (mask.every((c) => c === "hot")) break;
  }
  return played;
}

describe("solver — the blind brain (v0.0000)", () => {
  it("solves a real 5-letter game from masks only", () => {
    const answer = "CRANE";
    const played = playToEnd(answer);
    expect(played.at(-1)!.toUpperCase()).toBe(answer);
  });

  it("solves a sample of real answers within the guess budget", () => {
    const answers = WORDS_BY_SIZE[5].answers.slice(0, 40);
    for (const answer of answers) {
      const played = playToEnd(answer.toUpperCase());
      const solved = played.at(-1)!.toUpperCase() === answer.toUpperCase();
      expect(solved, `failed to solve ${answer} in ${played.length}: ${played.join(",")}`).toBe(true);
    }
  });

  it("handles the duplicate-letter trap (gray = upper bound, not exclusion)", () => {
    // ABBEY has two B's; a guess with two B's where one is green and one gray
    // must NOT prune ABBEY. Real scoreGuess emits exactly that mask.
    const answer = "ABBEY";
    const played = playToEnd(answer);
    expect(played.at(-1)!.toUpperCase()).toBe(answer);
  });

  it("is deterministic: same view yields the same guess", () => {
    const view: BotView = { wordLength: 5, ownGuesses: [] };
    expect(computeNextGuess(view)).toBe(computeNextGuess(view));
  });

  it("never crashes on an empty candidate set", () => {
    // An impossible constraint: green 'Q' at every position. No answer matches.
    const view: BotView = {
      wordLength: 5,
      ownGuesses: [{ word: "QQQQQ", mask: ["hot", "hot", "hot", "hot", "hot"] }],
    };
    expect(() => computeNextGuess(view)).not.toThrow();
  });

  // One cast, many lines: styles exist so two wordulers holding the same masks
  // never trace identical boards (the clone tell that exposed Nova and Juno).
  it("style 0 is the original brain (default param unchanged)", () => {
    const view: BotView = { wordLength: 5, ownGuesses: [] };
    expect(computeNextGuess(view, 0)).toBe(computeNextGuess(view));
  });

  it("distinct styles open with distinct words", () => {
    const view: BotView = { wordLength: 5, ownGuesses: [] };
    const openers = new Set(Array.from({ length: 7 }, (_, k) => computeNextGuess(view, k)));
    expect(openers.size).toBe(7);
  });

  it("every style still solves real games within the guess budget", () => {
    const answers = WORDS_BY_SIZE[5].answers.slice(0, 10);
    for (let style = 0; style < 7; style++) {
      for (const answer of answers) {
        const played = playToEnd(answer.toUpperCase(), 12, style);
        const solved = played.at(-1)!.toUpperCase() === answer.toUpperCase();
        expect(solved, `style ${style} failed ${answer} in ${played.length}: ${played.join(",")}`).toBe(true);
      }
    }
  });

  it("style wraps safely when fewer candidates remain than the style index", () => {
    // CRAN_ pinned green with E ruled out leaves only a handful of candidates; a high
    // style must still return a legal pool word (mod the field), never throw or go blank.
    const view: BotView = {
      wordLength: 5,
      ownGuesses: [{ word: "CRANE", mask: ["hot", "hot", "hot", "hot", "cold"] }],
    };
    for (const style of [0, 6, 13, 999]) {
      const word = computeNextGuess(view, style);
      expect(word.length).toBe(5);
      expect(WORDS_BY_SIZE[5].answers).toContain(word);
    }
  });

  // THE SACRED TEST. Cheat-isolation by construction: the solver's source must
  // never reach the answer. If this fails, the whole vision is dead.
  it("is structurally blind — imports nothing answer-bearing", () => {
    const raw = readFileSync(new URL("../src/solver.ts", import.meta.url), "utf8");
    // Inspect CODE, not prose: strip block + line comments so the wall is tested
    // against what executes, not what the comments happen to mention.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["']\.\/room/);
    expect(code).not.toMatch(/from\s+["']\.\/user/);
    expect(code).not.toMatch(/scoreGuess/);
    expect(code).not.toMatch(/\.word\b/);
    // BotView is the entire game-state surface — it has no `word` field.
    const view: BotView = { wordLength: 5, ownGuesses: [] };
    expect("word" in view).toBe(false);
  });
});
