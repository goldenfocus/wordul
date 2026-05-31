// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getGold, setGold, earnGold, spendGold } from "/edition.js";

beforeEach(() => localStorage.clear());

describe("wallet", () => {
  it("defaults to 50 gold", () => { expect(getGold()).toBe(50); });
  it("earnGold pays more for fewer guesses, min 10", () => {
    setGold(0); expect(earnGold(1)).toBe(60); expect(getGold()).toBe(60);
    setGold(0); expect(earnGold(6)).toBe(10);
  });
  it("spendGold refuses overspend and never goes negative", () => {
    setGold(15); expect(spendGold(20)).toBe(false); expect(getGold()).toBe(15);
    expect(spendGold(10)).toBe(true); expect(getGold()).toBe(5);
  });
  it("resets corrupt balance to 50", () => {
    localStorage.setItem("wordul.gold", "not-a-number"); expect(getGold()).toBe(50);
  });
});
