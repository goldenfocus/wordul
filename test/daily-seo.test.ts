import { describe, it, expect } from "vitest";
import { isValidDateString, dailyDateFromPathname, dailyPrevNext, giftPatternFromSearch, dailyOgFromPathname, buildGiftMeta } from "../src/daily-seo.ts";

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

import { buildDailyMeta, buildDailyJsonLd, dailySitemapUrls } from "../src/daily-seo.ts";
import type { World } from "../src/daily-core.ts";

const world: World = {
  date: "2026-06-02", word: "EMBER", edition: "yang", voice: "yang",
  story: { title: "Why EMBER?", body: "A small warmth that refuses to go out." },
  createdAt: 1,
};

describe("buildDailyMeta", () => {
  it("builds title/description/canonical pointing at the dated permalink", () => {
    const m = buildDailyMeta("2026-06-02", world, "https://wordul.com");
    expect(m.title).toContain("Wordul of the Day");
    expect(m.title).toContain("June 2, 2026");
    expect(m.canonical).toBe("https://wordul.com/daily/2026-06-02");
    expect(m.description.length).toBeGreaterThan(0);
  });
});

describe("buildDailyJsonLd", () => {
  it("emits a schema.org graph with WebPage + Game and the story body", () => {
    const ld = buildDailyJsonLd("2026-06-02", world, "https://wordul.com") as any;
    expect(ld["@context"]).toBe("https://schema.org");
    const types = ld["@graph"].map((n: any) => n["@type"]);
    expect(types).toContain("WebPage");
    expect(types).toContain("Game");
    const page = ld["@graph"].find((n: any) => n["@type"] === "WebPage");
    expect(page.url).toBe("https://wordul.com/daily/2026-06-02");
  });
});

describe("dailySitemapUrls", () => {
  it("emits /, /daily/archive, and one URL per date", () => {
    const urls = dailySitemapUrls(["2026-06-02", "2026-06-01"], "https://wordul.com");
    expect(urls).toContain("https://wordul.com/");
    expect(urls).toContain("https://wordul.com/daily/archive");
    expect(urls).toContain("https://wordul.com/daily/2026-06-02");
    expect(urls).toContain("https://wordul.com/daily/2026-06-01");
  });
});

describe("gift pattern (dare ritual)", () => {
  it("accepts a strictly valid ?g= pattern", () => {
    expect(giftPatternFromSearch("?g=chwcc-hhhhh")).toBe("chwcc-hhhhh");
    expect(giftPatternFromSearch("?g=hhhhh")).toBe("hhhhh");
    expect(giftPatternFromSearch("?g=ccccc-ccccc-ccccc-ccccc-ccccc-hhhhh")).toBe("ccccc-ccccc-ccccc-ccccc-ccccc-hhhhh");
  });

  it("rejects malformed patterns", () => {
    for (const bad of ["", "?g=", "?g=hhhh", "?g=hhhhhh", "?g=abcde", "?g=hhhhh-", "?g=HHHHH",
      "?g=ccccc-ccccc-ccccc-ccccc-ccccc-ccccc-hhhhh", "?x=hhhhh"]) {
      expect(giftPatternFromSearch(bad)).toBe(null);
    }
  });

  it("parses /daily/og/<date>/<pattern>.png", () => {
    expect(dailyOgFromPathname("/daily/og/2026-06-07/chwcc-hhhhh.png"))
      .toEqual({ date: "2026-06-07", pattern: "chwcc-hhhhh" });
  });

  it("rejects bad og paths (date, pattern, shape)", () => {
    for (const bad of [
      "/daily/og/2026-13-07/hhhhh.png",
      "/daily/og/2026-06-07/hhhh.png",
      "/daily/og/2026-06-07/abcde.png",
      "/daily/og/2026-06-07/hhhhh",
      "/daily/og/hhhhh.png",
    ]) expect(dailyOgFromPathname(bad)).toBe(null);
  });

  it("buildGiftMeta derives the solved count only from an all-hot last row", () => {
    expect(buildGiftMeta("ccccc-hhhhh").description).toContain("Solved in 2");
    expect(buildGiftMeta("ccccc-chwcc").description).not.toContain("Solved");
    expect(buildGiftMeta("hhhhh").title).toBe("You've been dared — Wordul of the Day");
  });
});
