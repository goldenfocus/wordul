import { describe, it, expect } from "vitest";
import { dayTheme } from "../public/hub.js";

const IDS = ["default", "yang", "jackpot", "arcade", "editorial", "tactile"];

describe("dayTheme", () => {
  it("is deterministic for a fixed date", () => {
    const d = new Date("2026-06-02T12:00:00Z");
    expect(dayTheme(d, IDS)).toBe(dayTheme(d, IDS));
  });
  it("never returns the default edition when others exist", () => {
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.UTC(2026, 5, 1 + i));
      expect(dayTheme(d, IDS)).not.toBe("default");
      expect(IDS).toContain(dayTheme(d, IDS));
    }
  });
  it("rotates across consecutive days", () => {
    const a = dayTheme(new Date(Date.UTC(2026, 5, 1)), IDS);
    const b = dayTheme(new Date(Date.UTC(2026, 5, 2)), IDS);
    expect(a).not.toBe(b);
  });
  it("returns 'default' when the pool is empty", () => {
    expect(dayTheme(new Date(), ["default"])).toBe("default");
  });
});
