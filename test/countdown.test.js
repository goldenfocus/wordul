import { describe, it, expect } from "vitest";
import { countdownNumber } from "../public/countdown.js";

describe("countdownNumber", () => {
  const goAt = 3000; // 3s from t=0

  it("shows 3 at the very start", () => {
    expect(countdownNumber(goAt, 0)).toBe(3);
  });
  it("shows 2 once under 2s remain", () => {
    expect(countdownNumber(goAt, 1000)).toBe(2); // 2000ms left
    expect(countdownNumber(goAt, 1999)).toBe(2); // 1001ms left
  });
  it("shows 1 in the final second", () => {
    expect(countdownNumber(goAt, 2000)).toBe(1); // 1000ms left
    expect(countdownNumber(goAt, 2999)).toBe(1); // 1ms left
  });
  it("returns null at/after goAt (GO! burst takes over)", () => {
    expect(countdownNumber(goAt, 3000)).toBe(null);
    expect(countdownNumber(goAt, 5000)).toBe(null);
  });
});
