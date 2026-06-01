import { describe, it, expect } from "vitest";
import { deadLettersFrom, wastedDeadLettersInLast } from "/celebrate.js";
import { GOLD, escalatedPenalty } from "/gold.js";

const g = (word, mask) => ({ word, mask });
const G = "green", Y = "yellow", X = "gray";

describe("deadLettersFrom", () => {
  it("returns an empty Set for no guesses", () => {
    expect(deadLettersFrom([]).size).toBe(0);
    expect(deadLettersFrom(undefined).size).toBe(0);
  });

  it("flags a letter that is gray everywhere and never colored", () => {
    // CRANE: every tile gray → the answer shares none of these letters.
    const dead = deadLettersFrom([g("CRANE", [X, X, X, X, X])]);
    expect([...dead].sort()).toEqual(["A", "C", "E", "N", "R"]);
  });

  it("skips guesses with no mask", () => {
    const dead = deadLettersFrom([{ word: "CRANE" }, g("BLIMP", [X, X, X, X, X])]);
    expect([...dead].sort()).toEqual(["B", "I", "L", "M", "P"]);
  });

  it("DUP-SAFE: a letter gray at one position but green/yellow elsewhere is NOT dead", () => {
    // SASSY vs an answer with one S: scoreGuess paints one S green, the rest gray.
    // The answer DOES contain S — flagging it dead would wrongly penalize reuse.
    const dead = deadLettersFrom([g("SASSY", [G, X, X, X, X])]);
    expect(dead.has("S")).toBe(false);
    // A (gray, never colored) and Y (gray, never colored) ARE dead.
    expect(dead.has("A")).toBe(true);
    expect(dead.has("Y")).toBe(true);
  });

  it("DUP-SAFE across guesses: gray in one guess, yellow in another → not dead", () => {
    const guesses = [
      g("SPORE", [X, X, X, X, X]), // S looks dead here…
      g("TOAST", [X, X, X, Y, X]), // …but S is yellow at index 3 → answer has it
    ];
    expect(deadLettersFrom(guesses).has("S")).toBe(false);
  });

  it("green and yellow letters never appear in the dead Set", () => {
    const dead = deadLettersFrom([g("CRANE", [G, Y, X, X, X])]);
    expect(dead.has("C")).toBe(false); // green
    expect(dead.has("R")).toBe(false); // yellow
    expect(dead.has("A")).toBe(true);  // gray, uncolored
  });
});

describe("wastedDeadLettersInLast", () => {
  it("returns count 0 with fewer than 2 guesses (nothing proven dead yet)", () => {
    expect(wastedDeadLettersInLast([]).count).toBe(0);
    expect(wastedDeadLettersInLast([g("CRANE", [X, X, X, X, X])]).count).toBe(0);
  });

  it("counts a dead letter (proven by a prior guess) reused in the last guess", () => {
    const guesses = [
      g("DROWN", [X, X, X, X, X]), // D proven dead
      g("DAILY", [X, G, X, X, X]), // reuses D at index 0 → wasted
    ];
    const out = wastedDeadLettersInLast(guesses);
    expect(out.letters).toEqual(["D"]);
    expect(out.count).toBe(1);
  });

  it("SELF-CONTAMINATION GUARD: derives dead-knowledge from PRIOR guesses only", () => {
    // Z is gray ONLY in the last guess — first-time use, not yet proven dead.
    // It must NOT be counted (you can't waste a letter you didn't know was dead).
    const guesses = [
      g("CRANE", [X, G, X, X, X]),
      g("ZIPPY", [X, G, X, X, X]), // Z's own gray here is its first appearance
    ];
    expect(wastedDeadLettersInLast(guesses).count).toBe(0);
  });

  it("dedupes per-letter: the same dead letter typed twice counts once", () => {
    const guesses = [
      // Only D is dead here: I/N/E are yellow/green (alive), so they can't be wasted.
      g("DINE", [X, Y, G, Y]),     // D gray (dead); I,N,E colored (alive)
      g("DODO", [X, G, X, G]),     // D at index 0 AND index 2 → one wasted letter
    ];
    const out = wastedDeadLettersInLast(guesses);
    expect(out.letters).toEqual(["D"]);
    expect(out.count).toBe(1);
  });

  it("reuse of a letter that is actually in the answer is NOT wasted (dup-safe)", () => {
    const guesses = [
      g("SUSHI", [G, Y, G, Y, Y]), // every letter colored → nothing proven dead
      g("SUSHI", [G, Y, G, Y, Y]), // reusing all of them is fine (none are dead)
    ];
    expect(wastedDeadLettersInLast(guesses).count).toBe(0);
  });
});

describe("escalatedPenalty", () => {
  it("first reuse (reuseCount 0) costs the base penalty", () => {
    expect(escalatedPenalty(GOLD.wastedLetterPenalty, 0)).toBe(50);
  });

  it("escalates linearly: 2nd = 2×base, 3rd = 3×base", () => {
    expect(escalatedPenalty(50, 1)).toBe(100);
    expect(escalatedPenalty(50, 2)).toBe(150);
  });

  it("is monotonically increasing in reuseCount", () => {
    let prev = -Infinity;
    for (let r = 0; r <= 5; r++) {
      const p = escalatedPenalty(50, r);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it("clamps a negative reuseCount to base (never below the floor)", () => {
    expect(escalatedPenalty(50, -3)).toBe(50);
  });
});

describe("penalty constants (C2)", () => {
  it("locks the C2 loss-penalty values", () => {
    expect(GOLD.invalidPenalty).toBe(50);
    expect(GOLD.wastedLetterPenalty).toBe(50);
    expect(GOLD.wastedCapPerGuess).toBe(200);
  });

  it("per-guess cap clamps an all-dead guess so it can't nuke the balance", () => {
    // Simulate the app.js hook math: 5 wasted letters, first-time each (reuse 0).
    const wastedLetters = ["A", "B", "C", "D", "E"];
    let penalty = 0;
    for (const _ of wastedLetters) penalty += escalatedPenalty(GOLD.wastedLetterPenalty, 0);
    expect(penalty).toBe(250); // 5 × 50, before the cap
    expect(Math.min(penalty, GOLD.wastedCapPerGuess)).toBe(200);
  });

  it("escalation sequencing: same mistake costs base then escalated across guesses", () => {
    // Mirror the read-then-increment order of the app.js Map.
    const reuse = new Map();
    const costFor = (letter) => {
      const r = reuse.get(letter) ?? 0;
      const cost = escalatedPenalty(GOLD.wastedLetterPenalty, r);
      reuse.set(letter, r + 1);
      return cost;
    };
    expect(costFor("D")).toBe(50);  // first reuse this game
    expect(costFor("D")).toBe(100); // second reuse → escalated
    expect(costFor("D")).toBe(150); // third reuse → escalated more
  });
});
