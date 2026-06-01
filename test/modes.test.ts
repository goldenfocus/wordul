import { describe, it, expect } from "vitest";
import { MODES, DEFAULT_MODE, isAvailableMode } from "../src/modes.ts";

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
