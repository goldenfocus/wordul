import { describe, it, expect } from "vitest";
import { VANILLA, WILD, laneSig, rulesetOf, powerUpsOn } from "/lane.js";

describe("lane browser twin", () => {
  it("mirrors the server presets + signature", () => {
    expect(VANILLA).toEqual({ powerUps: false });
    expect(WILD).toEqual({ powerUps: true });
    expect(laneSig(WILD)).toBe("p1");
  });

  it("reads power-up availability off a snapshot", () => {
    expect(powerUpsOn({ ruleset: WILD })).toBe(true);
    expect(powerUpsOn({ ruleset: VANILLA })).toBe(false);
  });

  it("defaults a snapshot with NO ruleset to Wild (legacy compat)", () => {
    expect(rulesetOf({})).toEqual(WILD);
    expect(powerUpsOn(undefined)).toBe(true);
    expect(powerUpsOn(null)).toBe(true);
  });
});
