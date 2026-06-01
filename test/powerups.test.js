import { describe, it, expect } from "vitest";
import { GOLD } from "/gold.js";
import {
  affordablePowerups,
  cheapestAvailableCost,
  shouldShowMagic,
} from "../public/powerups.js";

// A fresh round's power-up state: nothing revealed, vowel count unknown.
const freshState = () => ({ revealed: [], vowels: null });
const snap = (over = {}) => ({ phase: "playing", wordLength: 5, ...over });
const me = (over = {}) => ({ status: "playing", ...over });

describe("affordablePowerups", () => {
  it("returns nothing when you can't afford the cheapest power-up", () => {
    expect(affordablePowerups(0, freshState(), snap())).toEqual([]);
    expect(affordablePowerups(GOLD.vowelCost - 1, freshState(), snap())).toEqual([]);
  });
  it("returns only the vowel power-up when you can afford it but not a reveal", () => {
    const list = affordablePowerups(GOLD.vowelCost, freshState(), snap());
    expect(list.map((p) => p.id)).toEqual(["vowel"]);
  });
  it("returns both when you can afford a reveal", () => {
    const list = affordablePowerups(GOLD.revealCost, freshState(), snap());
    expect(list.map((p) => p.id).sort()).toEqual(["reveal", "vowel"]);
  });
  it("excludes the vowel power-up once the count is already known", () => {
    const list = affordablePowerups(GOLD.revealCost, { revealed: [], vowels: 2 }, snap());
    expect(list.map((p) => p.id)).toEqual(["reveal"]);
  });
  it("excludes reveal once every slot is known", () => {
    const allKnown = { revealed: [0, 1, 2, 3, 4].map((index) => ({ index, letter: "A" })), vowels: null };
    const list = affordablePowerups(GOLD.revealCost, allKnown, snap());
    expect(list.map((p) => p.id)).toEqual(["vowel"]);
  });
});

describe("cheapestAvailableCost", () => {
  it("is the vowel cost (the cheaper power-up) on a fresh round", () => {
    expect(cheapestAvailableCost(freshState(), snap())).toBe(GOLD.vowelCost);
  });
  it("falls back to the reveal cost once the vowel count is known", () => {
    expect(cheapestAvailableCost({ revealed: [], vowels: 3 }, snap())).toBe(GOLD.revealCost);
  });
  it("is null when no power-up is still buyable this round", () => {
    const allKnown = { revealed: [0, 1, 2, 3, 4].map((index) => ({ index, letter: "A" })), vowels: 7 };
    expect(cheapestAvailableCost(allKnown, snap())).toBe(null);
  });
});

describe("shouldShowMagic (✨ hide-unaffordable gate)", () => {
  it("hidden when gold is below the cheapest available power-up", () => {
    expect(shouldShowMagic(GOLD.vowelCost - 1, freshState(), snap(), me())).toBe(false);
  });
  it("shown once gold reaches the cheapest available power-up", () => {
    expect(shouldShowMagic(GOLD.vowelCost, freshState(), snap(), me())).toBe(true);
  });
  it("hidden when no power-up remains buyable, even with infinite gold", () => {
    const allKnown = { revealed: [0, 1, 2, 3, 4].map((index) => ({ index, letter: "A" })), vowels: 7 };
    expect(shouldShowMagic(999999, allKnown, snap(), me())).toBe(false);
  });
  it("hidden outside an active playing turn", () => {
    expect(shouldShowMagic(GOLD.revealCost, freshState(), snap({ phase: "lobby" }), me())).toBe(false);
    expect(shouldShowMagic(GOLD.revealCost, freshState(), snap(), me({ status: "won" }))).toBe(false);
    expect(shouldShowMagic(GOLD.revealCost, freshState(), null, me())).toBe(false);
    expect(shouldShowMagic(GOLD.revealCost, freshState(), snap(), null)).toBe(false);
  });
});
