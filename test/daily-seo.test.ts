import { describe, it, expect } from "vitest";
import { isValidDateString, dailyDateFromPathname, dailyPrevNext } from "../src/daily-seo.ts";

describe("isValidDateString", () => {
  it("accepts real calendar dates", () => {
    expect(isValidDateString("2026-06-02")).toBe(true);
    expect(isValidDateString("2024-02-29")).toBe(true); // leap day
  });
  it("rejects malformed or impossible dates", () => {
    expect(isValidDateString("2026-6-2")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("nope")).toBe(false);
  });
});

describe("dailyDateFromPathname", () => {
  it("extracts the date from /daily/<date>", () => {
    expect(dailyDateFromPathname("/daily/2026-06-02")).toBe("2026-06-02");
  });
  it("returns null for non-daily or invalid paths", () => {
    expect(dailyDateFromPathname("/daily/archive")).toBeNull();
    expect(dailyDateFromPathname("/daily/2026-02-30")).toBeNull();
    expect(dailyDateFromPathname("/@yan/room")).toBeNull();
  });
});

describe("dailyPrevNext", () => {
  it("computes adjacent UTC dates, including month + leap boundaries", () => {
    expect(dailyPrevNext("2026-06-02")).toEqual({ prev: "2026-06-01", next: "2026-06-03" });
    expect(dailyPrevNext("2026-03-01")).toEqual({ prev: "2026-02-28", next: "2026-03-02" });
    expect(dailyPrevNext("2024-02-28")).toEqual({ prev: "2024-02-27", next: "2024-02-29" });
  });
});
