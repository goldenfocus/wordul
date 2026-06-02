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

import { fnv1a, fallbackWord } from "../src/daily-core.ts";

describe("fnv1a", () => {
  it("is a stable 32-bit unsigned integer for a string", () => {
    const h = fnv1a("2026-06-02");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(fnv1a("2026-06-02")).toBe(h); // deterministic
  });
  it("differs for different inputs", () => {
    expect(fnv1a("2026-06-02")).not.toBe(fnv1a("2026-06-03"));
  });
});

describe("fallbackWord", () => {
  const pool = ["ALPHA", "BRAVO", "CRANE", "DELTA", "EAGLE"];
  it("is deterministic per date and always in the pool", () => {
    const w = fallbackWord("2026-06-02", pool);
    expect(pool).toContain(w);
    expect(fallbackWord("2026-06-02", pool)).toBe(w);
  });
  it("varies across dates (spread over a month of dates)", () => {
    const picks = new Set(
      Array.from({ length: 28 }, (_, i) =>
        fallbackWord(`2026-06-${String(i + 1).padStart(2, "0")}`, pool)),
    );
    expect(picks.size).toBeGreaterThan(1);
  });
  it("falls back to the first word when the pool is empty", () => {
    expect(fallbackWord("2026-06-02", [])).toBe("");
  });
});
