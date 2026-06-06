import { describe, it, expect } from "vitest";
import { MODES, DEFAULT_MODE, isAvailableMode, defaultRulesetForMode, initialRuleset, seededRuleset } from "../src/modes.ts";
import { VANILLA, WILD } from "../src/lane.ts";

describe("modes registry", () => {
  it("has race as the default and only available mode for now", () => {
    expect(DEFAULT_MODE).toBe("race");
    expect(MODES.race.available).toBe(true);
  });

  it("ships the roadmap as unavailable modes with blurbs", () => {
    expect(MODES.longgame.available).toBe(false);
    expect(MODES.challenge.available).toBe(false);
    for (const m of Object.values(MODES)) {
      expect(typeof m.label).toBe("string");
      expect(m.blurb.length).toBeGreaterThan(0);
    }
  });

  it("isAvailableMode only accepts available, known modes", () => {
    expect(isAvailableMode("race")).toBe(true);
    expect(isAvailableMode("longgame")).toBe(false);
    expect(isAvailableMode("nope")).toBe(false);
    expect(isAvailableMode(undefined)).toBe(false);
  });
});

describe("mode rulesets", () => {
  it("every mode declares a defaultRuleset; race is Wild", () => {
    for (const m of Object.values(MODES)) expect(m.defaultRuleset).toBeDefined();
    expect(MODES.race.defaultRuleset).toEqual(WILD);
  });

  it("defaultRulesetForMode falls back to Wild for unknown modes", () => {
    expect(defaultRulesetForMode("race")).toEqual(WILD);
    expect(defaultRulesetForMode("nope")).toEqual(WILD);
  });

  it("initialRuleset: daily is Vanilla, normal rooms take the mode default", () => {
    expect(initialRuleset(true, "race")).toEqual(VANILLA);  // daily flagship is fair
    expect(initialRuleset(false, "race")).toEqual(WILD);
  });

  it("seededRuleset: explicit unlocked lane overrides the mode default", () => {
    expect(seededRuleset("race", "vanilla")).toEqual(VANILLA);
    expect(seededRuleset("race", "wild")).toEqual(WILD);
    expect(seededRuleset("race", undefined)).toEqual(WILD); // no override → mode default
  });
});
