import { describe, it, expect } from "vitest";
import { activeDate } from "../src/daily-core.ts";

describe("activeDate", () => {
  it("returns the UTC YYYY-MM-DD for an instant", () => {
    // 2026-06-02T12:00:00Z
    expect(activeDate(Date.UTC(2026, 5, 2, 12, 0, 0))).toBe("2026-06-02");
  });

  it("rolls over exactly at 00:00:00 UTC, not before", () => {
    expect(activeDate(Date.UTC(2026, 5, 2, 23, 59, 59))).toBe("2026-06-02");
    expect(activeDate(Date.UTC(2026, 5, 3, 0, 0, 0))).toBe("2026-06-03");
  });

  it("zero-pads month and day", () => {
    expect(activeDate(Date.UTC(2026, 0, 9, 5, 0, 0))).toBe("2026-01-09");
  });
});
