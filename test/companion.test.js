import { describe, it, expect } from "vitest";
import {
  scoreWin, scoreGreens, scoreMistake, shouldSpeak, resolveTier, splitTemplate,
} from "/companion.js";

const cfg = {
  voiceBudget: { routine: 0.33 },
  win: { genius: { maxGuesses: 2 }, clutch: { minGuesses: 6 } },
  greens: { thresholds: [2, 3, 4, 5] },
  mistake: { sloppy: { repeatedKnownGray: true } },
};

describe("scoreWin", () => {
  it("1-2 guesses is genius", () => {
    expect(scoreWin(1, cfg)).toBe("genius");
    expect(scoreWin(2, cfg)).toBe("genius");
  });
  it("3-5 guesses is solid", () => {
    expect(scoreWin(3, cfg)).toBe("solid");
    expect(scoreWin(5, cfg)).toBe("solid");
  });
  it("6th-guess win is clutch", () => {
    expect(scoreWin(6, cfg)).toBe("clutch");
  });
});

describe("scoreGreens", () => {
  it("buckets by the real count", () => {
    expect(scoreGreens(2, cfg)).toBe("2");
    expect(scoreGreens(3, cfg)).toBe("3");
    expect(scoreGreens(5, cfg)).toBe("5");
  });
  it("clamps above the top threshold", () => {
    expect(scoreGreens(6, cfg)).toBe("5");
  });
  it("clamps below the bottom threshold", () => {
    expect(scoreGreens(1, cfg)).toBe("2");
  });
});

describe("scoreMistake", () => {
  it("is sloppy when a known dead letter was reused", () => {
    expect(scoreMistake({ reusedDeadLetter: true }, cfg)).toBe("sloppy");
  });
  it("is normal for a clean wrong guess", () => {
    expect(scoreMistake({ reusedDeadLetter: false }, cfg)).toBe("normal");
    expect(scoreMistake({}, cfg)).toBe("normal");
  });
});

describe("shouldSpeak", () => {
  const never = () => 1, always = () => 0;
  it("always speaks big moments + wins + losses", () => {
    expect(shouldSpeak("win", "genius", cfg, never)).toBe(true);
    expect(shouldSpeak("loss", null, cfg, never)).toBe(true);
    expect(shouldSpeak("greens", "4", cfg, never)).toBe(true);
    expect(shouldSpeak("wrong", "sloppy", cfg, never)).toBe(true);
  });
  it("gates a normal wrong guess + invalid by the routine budget", () => {
    expect(shouldSpeak("wrong", "normal", cfg, never)).toBe(false);
    expect(shouldSpeak("wrong", "normal", cfg, always)).toBe(true);
    expect(shouldSpeak("invalid", null, cfg, never)).toBe(false);
    expect(shouldSpeak("invalid", null, cfg, always)).toBe(true);
  });
});

describe("resolveTier", () => {
  it("maps each scored event to its tier", () => {
    expect(resolveTier("win", { guessesUsed: 2 }, cfg)).toBe("genius");
    expect(resolveTier("greens", { count: 3 }, cfg)).toBe("3");
    expect(resolveTier("wrong", { reusedDeadLetter: true }, cfg)).toBe("sloppy");
    expect(resolveTier("wrong", { reusedDeadLetter: false }, cfg)).toBe("normal");
  });
  it("returns null for flat banks", () => {
    expect(resolveTier("invalid", {}, cfg)).toBeNull();
    expect(resolveTier("idle", {}, cfg)).toBeNull();
    expect(resolveTier("loss", { answer: "CRANE" }, cfg)).toBeNull();
  });
});

describe("splitTemplate", () => {
  it("splits a {answer} line into trimmed prefix + suffix", () => {
    expect(splitTemplate("The word was {answer}.")).toEqual({ prefix: "The word was", suffix: "." });
  });
  it("handles a missing token (whole line is the prefix)", () => {
    expect(splitTemplate("No token here")).toEqual({ prefix: "No token here", suffix: "" });
  });
  it("handles a trailing token (empty suffix)", () => {
    expect(splitTemplate("It was {answer}")).toEqual({ prefix: "It was", suffix: "" });
  });
});
