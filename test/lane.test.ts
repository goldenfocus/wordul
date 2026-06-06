import { describe, it, expect } from "vitest";
import { VANILLA, WILD, laneSig, lanePreset, type Ruleset } from "../src/lane.ts";

describe("lane core", () => {
  it("presets toggle only power-ups (stakes is out of scope)", () => {
    expect(VANILLA).toEqual({ powerUps: false });
    expect(WILD).toEqual({ powerUps: true });
  });

  it("laneSig is a stable, distinct signature per preset", () => {
    expect(laneSig(VANILLA)).toBe("p0");
    expect(laneSig(WILD)).toBe("p1");
    expect(laneSig(VANILLA)).not.toBe(laneSig(WILD));
  });

  it("lanePreset maps UI names to a FRESH ruleset (mutation-safe)", () => {
    expect(lanePreset("vanilla")).toEqual(VANILLA);
    expect(lanePreset("wild")).toEqual(WILD);
    const a: Ruleset = lanePreset("vanilla");
    a.powerUps = true;
    expect(VANILLA.powerUps).toBe(false); // constant untouched
  });

  it("lanePreset defaults unknown input to WILD (preserves power-ups-everywhere)", () => {
    expect(lanePreset("nope")).toEqual(WILD);
    expect(lanePreset(undefined)).toEqual(WILD);
  });
});
