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

import { houseWorld, resolveWorld, normalizeWorld } from "../src/daily-core.ts";
import type { World } from "../src/daily-core.ts";

describe("houseWorld", () => {
  it("wraps the deterministic fallback word in a default-edition World", () => {
    const w = houseWorld("2026-06-02", 1_700_000_000_000);
    expect(w.date).toBe("2026-06-02");
    expect(w.word).toMatch(/^[A-Z]+$/);
    expect(w.word.length).toBe(5); // fallback uses the 5-letter pool
    expect(w.edition).toBe("default");
    expect(w.voice).toBe("yang");
    expect(typeof w.story.title).toBe("string");
    expect(typeof w.story.body).toBe("string");
    expect(houseWorld("2026-06-02", 1).word).toBe(w.word); // deterministic word
  });
});

describe("resolveWorld", () => {
  const curated: World = {
    date: "2026-06-02", word: "EMBER", edition: "yang", voice: "yang",
    story: { title: "Why EMBER?", body: "A small warmth that refuses to go out." },
    createdAt: 1,
  };
  it("returns the curated World when the date is scheduled", () => {
    expect(resolveWorld({ "2026-06-02": curated }, "2026-06-02", 99).word).toBe("EMBER");
  });
  it("falls back to a house World for an unscheduled date", () => {
    const w = resolveWorld({}, "2026-06-05", 99);
    expect(w.edition).toBe("default");
    expect(w.word.length).toBe(5);
  });
});

describe("normalizeWorld", () => {
  it("accepts a valid payload and uppercases the word", () => {
    const w = normalizeWorld({
      date: "2026-06-02", word: "ember", edition: "yang", voice: "yang",
      story: { title: "t", body: "b" },
    });
    expect(w?.word).toBe("EMBER");
    expect(typeof w?.createdAt).toBe("number");
  });
  it("rejects garbage / missing fields", () => {
    expect(normalizeWorld(null)).toBeNull();
    expect(normalizeWorld({ word: "ember" })).toBeNull();               // no date
    expect(normalizeWorld({ date: "nope", word: "EMBER", story: {} })).toBeNull(); // bad date
    expect(normalizeWorld({ date: "2026-06-02", word: "EM3ER", story: { title: "t", body: "b" } })).toBeNull();
  });
  it("accepts and round-trips an optional feedEditorial overlay", () => {
    const w = normalizeWorld({ date: "2026-06-02", word: "CRANE",
      story: { title: "t", body: "b" },
      feedEditorial: { title: "Hi", intro: "x", body: "y", media: { images: ["/a.png"] } } });
    expect(w?.feedEditorial?.title).toBe("Hi");
  });
  it("omits feedEditorial when absent (back-compat)", () => {
    const w = normalizeWorld({ date: "2026-06-02", word: "CRANE", story: { title: "t", body: "b" } });
    expect(w && "feedEditorial" in w).toBe(false);
  });
});
