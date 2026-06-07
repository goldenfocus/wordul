import { describe, it, expect } from "vitest";
import { dayTheme } from "../public/hub.js";

const IDS = ["default", "yang", "jackpot", "arcade", "editorial", "tactile"];

describe("dayTheme", () => {
  // The daily wears the base Wordul theme unless a curated World re-themes it via
  // the room snapshot — no client-side rotation, so starting the WOTD expands the
  // home page in place instead of cutting to a differently-skinned screen.
  it("always returns the default edition (base look unless curated)", () => {
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.UTC(2026, 5, 1 + i));
      expect(dayTheme(d, IDS)).toBe("default");
    }
  });
  it("returns 'default' even with a single-entry pool", () => {
    expect(dayTheme(new Date(), ["default"])).toBe("default");
  });
});
