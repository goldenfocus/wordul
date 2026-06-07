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

describe("fallbackWord — server-only salt (NO-OP when empty)", () => {
  // A pool big enough that a salt can land on a different index.
  const pool = ["ALPHA", "BRAVO", "CRANE", "DELTA", "EAGLE", "FROST", "GLINT", "HAVEN"];
  const dates = ["2026-06-01", "2026-06-02", "2026-06-15", "2026-12-31", "2027-01-09"];

  it("salt='' reproduces the exact unsalted pick for several dates (date + '' === date)", () => {
    for (const d of dates) {
      const unsalted = pool[fnv1a(d) % pool.length];
      expect(fallbackWord(d, pool, "")).toBe(unsalted);
    }
  });

  it("the omitted-salt path equals the unsalted pick for several dates", () => {
    for (const d of dates) {
      const unsalted = pool[fnv1a(d) % pool.length];
      expect(fallbackWord(d, pool)).toBe(unsalted);       // default arg
      expect(fallbackWord(d, pool)).toBe(fallbackWord(d, pool, "")); // == explicit empty
    }
  });

  it("a non-empty salt is deterministic and changes the pick for at least one date", () => {
    const salt = "s3cr3t-server-only";
    // Deterministic: same (date, salt) → same word every call.
    for (const d of dates) {
      expect(fallbackWord(d, pool, salt)).toBe(fallbackWord(d, pool, salt));
    }
    // And it must actually diverge from the unsalted pick for at least one date,
    // proving the salt is wired into the seed (not silently dropped).
    const changed = dates.some(
      (d) => fallbackWord(d, pool, salt) !== fallbackWord(d, pool, ""),
    );
    expect(changed).toBe(true);
  });
});

import { houseWorld, resolveWorld, normalizeWorld } from "../src/daily-core.ts";
import type { World } from "../src/daily-core.ts";

describe("houseWorld", () => {
  it("wraps the deterministic fallback word in the base-look house World", () => {
    const w = houseWorld("2026-06-02", 1_700_000_000_000);
    expect(w.date).toBe("2026-06-02");
    expect(w.word).toMatch(/^[A-Z]+$/);
    expect(w.word.length).toBe(5); // fallback uses the 5-letter pool
    // Unauthored days wear the signature Wordul edition so the daily expands the
    // home page in place; only a curated World re-themes the day. Voice stays yang
    // (text companion, decoupled from visuals).
    expect(w.edition).toBe("default");
    expect(w.voice).toBe("yang");
    // House days ship NO story — the "no curator claimed" filler read as noise on
    // the golden card. The story block is curated-content-only (Yan, Jun 7 2026).
    expect(w.story).toBeUndefined();
    expect(houseWorld("2026-06-02", 1).word).toBe(w.word); // deterministic word
  });
  it("threads salt through to the house word: empty salt == omitted, set salt is deterministic", () => {
    const base = houseWorld("2026-06-02", 1).word;
    expect(houseWorld("2026-06-02", 1, "").word).toBe(base);            // empty salt = NO-OP
    const salted = houseWorld("2026-06-02", 1, "server-secret").word;
    expect(salted).toBe(houseWorld("2026-06-02", 1, "server-secret").word); // deterministic
    expect(salted).toMatch(/^[A-Z]+$/);
    expect(salted.length).toBe(5); // still drawn from the 5-letter pool
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
  it("empty/omitted salt reproduces the unsalted house word; a curated date ignores salt", () => {
    const base = resolveWorld({}, "2026-06-05", 99).word;
    expect(resolveWorld({}, "2026-06-05", 99, "").word).toBe(base);          // empty = NO-OP
    expect(resolveWorld({}, "2026-06-05", 99).word).toBe(base);              // omitted = same
    // Salt only seeds the house fallback — a scheduled World is returned verbatim.
    expect(resolveWorld({ "2026-06-02": curated }, "2026-06-02", 99, "server-secret").word).toBe("EMBER");
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

// ----- Vibe Studio v1, Increment 1: additive themed World fields -----

describe("World type — vibe fields", () => {
  it("accepts a fully-enriched World fixture (compile-time shape)", () => {
    const w: World = {
      date: "2026-06-10", word: "EMBER", edition: "yang", voice: "yang",
      story: { title: "t", body: "b" },
      vibeTitle: "Embers",
      rows: 6,
      invented: false,
      colorScheme: { a1: "#f0c14b", a2: "#6f9e7a", a3: "#0b0a0c" },
      glow: { atmosphere: 0.4, header: 0.2 },
      images: { header: "designs/x/header.jpg" },
      playlist: { keys: ["designs/x/1.mp3"], autoplayOnEntry: true },
      createdAt: 1,
    };
    expect(w.vibeTitle).toBe("Embers");
  });
});

describe("normalizeWorld — rows", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("defaults rows to 6 when absent", () => {
    expect(normalizeWorld(base)?.rows).toBe(6);
  });
  it("keeps a valid rows value", () => {
    expect(normalizeWorld({ ...base, rows: 4 })?.rows).toBe(4);
  });
  it("clamps rows below 3 up to 3 and above 10 down to 10", () => {
    expect(normalizeWorld({ ...base, rows: 1 })?.rows).toBe(3);
    expect(normalizeWorld({ ...base, rows: 99 })?.rows).toBe(10);
  });
  it("defaults rows to 6 for a non-numeric value", () => {
    expect(normalizeWorld({ ...base, rows: "lots" })?.rows).toBe(6);
  });
});

describe("normalizeWorld — invented words", () => {
  const base = { date: "2026-06-10", story: { title: "t", body: "b" } };
  it("accepts a real pooled word with invented false/absent", () => {
    expect(normalizeWorld({ ...base, word: "EMBER" })?.word).toBe("EMBER");
    expect(normalizeWorld({ ...base, word: "EMBER" })?.invented).toBe(false);
  });
  it("rejects a non-pooled word when invented is not set", () => {
    expect(normalizeWorld({ ...base, word: "ZZZZX" })).toBeNull();
  });
  it("accepts a non-pooled word when invented is true and flags it", () => {
    const w = normalizeWorld({ ...base, word: "ZZZZX", invented: true });
    expect(w?.word).toBe("ZZZZX");
    expect(w?.invented).toBe(true);
  });
  it("still enforces length 4–12 even when invented is true", () => {
    expect(normalizeWorld({ ...base, word: "ABC", invented: true })).toBeNull();      // 3
    expect(normalizeWorld({ ...base, word: "ABCDEFGHIJKLM", invented: true })).toBeNull(); // 13
    expect(normalizeWorld({ ...base, word: "ABCD", invented: true })?.word).toBe("ABCD");  // 4 ok
  });
});

describe("normalizeWorld — colorScheme", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits colorScheme when absent", () => {
    expect(normalizeWorld(base)?.colorScheme).toBeUndefined();
  });
  it("keeps a valid hex trio", () => {
    const cs = { a1: "#f0c14b", a2: "#6f9e7a", a3: "#0B0A0C" };
    expect(normalizeWorld({ ...base, colorScheme: cs })?.colorScheme).toEqual(cs);
  });
  it("accepts hsl() / rgb() colors", () => {
    const cs = { a1: "hsl(45 80% 62%)", a2: "rgb(111,158,122)", a3: "#000" };
    expect(normalizeWorld({ ...base, colorScheme: cs })?.colorScheme).toEqual(cs);
  });
  it("drops the whole colorScheme if any color is invalid (does not reject the World)", () => {
    const w = normalizeWorld({ ...base, colorScheme: { a1: "#f0c14b", a2: "notacolor", a3: "#000" } });
    expect(w).not.toBeNull();
    expect(w?.colorScheme).toBeUndefined();
  });
});

describe("normalizeWorld — glow", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits glow when absent", () => {
    expect(normalizeWorld(base)?.glow).toBeUndefined();
  });
  it("keeps and clamps provided glow bands to 0–1", () => {
    const w = normalizeWorld({ ...base, glow: { atmosphere: 0.5, header: 2, footer: -1 } });
    expect(w?.glow).toEqual({ atmosphere: 0.5, header: 1, footer: 0 });
  });
  it("ignores non-numeric glow bands", () => {
    const w = normalizeWorld({ ...base, glow: { atmosphere: "bright", middle: 0.3 } });
    expect(w?.glow).toEqual({ middle: 0.3 });
  });
});

describe("normalizeWorld — images", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits images when absent", () => {
    expect(normalizeWorld(base)?.images).toBeUndefined();
  });
  it("keeps only string band keys", () => {
    const w = normalizeWorld({ ...base, images: { header: "d/h.jpg", middle: 5, footer: "d/f.jpg" } });
    expect(w?.images).toEqual({ header: "d/h.jpg", footer: "d/f.jpg" });
  });
});

describe("normalizeWorld — playlist", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits playlist when absent", () => {
    expect(normalizeWorld(base)?.playlist).toBeUndefined();
  });
  it("keeps string keys and the autoplay flag", () => {
    const w = normalizeWorld({ ...base, playlist: { keys: ["a.mp3", 3, "b.mp3"], autoplayOnEntry: true } });
    expect(w?.playlist).toEqual({ keys: ["a.mp3", "b.mp3"], autoplayOnEntry: true });
  });
  it("defaults autoplayOnEntry to false and drops an empty playlist", () => {
    expect(normalizeWorld({ ...base, playlist: { keys: ["a.mp3"] } })?.playlist)
      .toEqual({ keys: ["a.mp3"], autoplayOnEntry: false });
    expect(normalizeWorld({ ...base, playlist: { keys: [] } })?.playlist).toBeUndefined();
  });
});

describe("normalizeWorld — vibeTitle", () => {
  const base = { date: "2026-06-10", word: "EMBER", story: { title: "t", body: "b" } };
  it("omits vibeTitle when absent", () => {
    expect(normalizeWorld(base)?.vibeTitle).toBeUndefined();
  });
  it("keeps a string vibeTitle, ignores non-strings", () => {
    expect(normalizeWorld({ ...base, vibeTitle: "Embers" })?.vibeTitle).toBe("Embers");
    expect(normalizeWorld({ ...base, vibeTitle: 42 })?.vibeTitle).toBeUndefined();
  });
});

describe("normalizeWorld — back-compat", () => {
  it("normalizes a pre-vibe World without adding visual fields (only rows/invented defaults)", () => {
    const old = {
      date: "2026-05-31", word: "EMBER", edition: "yang", voice: "yang",
      story: { title: "Why EMBER?", body: "warmth" }, createdAt: 1,
    };
    const w = normalizeWorld(old)!;
    expect(w.colorScheme).toBeUndefined();
    expect(w.glow).toBeUndefined();
    expect(w.images).toBeUndefined();
    expect(w.playlist).toBeUndefined();
    expect(w.vibeTitle).toBeUndefined();
    expect(w.rows).toBe(6);
    expect(w.invented).toBe(false);
    expect(w.word).toBe("EMBER");
    expect(w.edition).toBe("yang");
    expect(w.story.title).toBe("Why EMBER?");
  });
});

import { saltForDate } from "../src/daily-core.ts";

describe("saltForDate (cutoff gate — closes the daily-answer leak without rewriting history)", () => {
  const FROM = "2026-06-05";
  it("returns '' (no-op) for dates before the cutoff, even with a secret set", () => {
    expect(saltForDate("2026-06-04", "s3cr3t", FROM)).toBe("");
    expect(saltForDate("2025-01-01", "s3cr3t", FROM)).toBe("");
  });
  it("applies the secret on/after the cutoff date", () => {
    expect(saltForDate("2026-06-05", "s3cr3t", FROM)).toBe("s3cr3t");
    expect(saltForDate("2026-12-31", "s3cr3t", FROM)).toBe("s3cr3t");
  });
  it("is a no-op when the secret is unset/empty regardless of date", () => {
    expect(saltForDate("2026-06-05", undefined, FROM)).toBe("");
    expect(saltForDate("2026-06-05", "", FROM)).toBe("");
  });
  it("keeps past/today house picks identical while changing future ones", () => {
    const answers = ["AAAAA", "BBBBB", "CCCCC", "DDDDD", "EEEEE"];
    for (const d of ["2026-06-03", "2026-06-04"]) {
      expect(fallbackWord(d, answers, saltForDate(d, "s3cr3t", FROM))).toBe(fallbackWord(d, answers, ""));
    }
    const future = ["2026-06-05", "2026-06-06", "2026-06-07", "2026-06-08", "2026-06-09"];
    const diverged = future.some(
      (d) => fallbackWord(d, answers, saltForDate(d, "s3cr3t", FROM)) !== fallbackWord(d, answers, ""),
    );
    expect(diverged).toBe(true);
  });
});

describe("normalizeWorld (regression after bundle extraction)", () => {
  it("defaults edition/voice/rows + accepts a valid dated world", () => {
    const w = normalizeWorld({ date: "2026-06-10", word: "ember", story: { title: "Why", body: "B" } });
    expect(w).not.toBeNull();
    expect(w!.word).toBe("EMBER");
    expect(w!.edition).toBe("default");
    expect(w!.voice).toBe("yang");
    expect(w!.rows).toBe(6);
  });
  it("preserves the FULL playable + dated payload (anti-drop guard)", () => {
    const w = normalizeWorld({
      date: "2026-06-10", word: "ember", invented: false, voice: "luna", rows: 8,
      vibeTitle: "Embers", bonusWord: "glow",
      story: { title: "Why", body: "B", tip: "warm" },
      colorScheme: { a1: "#012", a2: "#345", a3: "#678" },
      glow: { atmosphere: 0.5, header: 0.2 },
      curator: { username: "zang", message: "hi" },
    })!;
    expect(w.voice).toBe("luna");
    expect(w.rows).toBe(8);
    expect(w.vibeTitle).toBe("Embers");
    expect(w.bonusWord).toBe("GLOW");
    expect(w.story.tip).toBe("warm");
    expect(w.colorScheme).toEqual({ a1: "#012", a2: "#345", a3: "#678" });
    expect(w.glow).toEqual({ atmosphere: 0.5, header: 0.2 });
    expect(w.curator).toEqual({ username: "zang", message: "hi" });
  });
  it("rejects a bad date", () => {
    expect(normalizeWorld({ date: "nope", word: "ember", story: { title: "t", body: "b" } })).toBeNull();
  });
  it("rejects a non-pool word that is not invented", () => {
    expect(normalizeWorld({ date: "2026-06-10", word: "zzzzz", story: { title: "t", body: "b" } })).toBeNull();
  });
  it("accepts an invented non-pool word", () => {
    expect(normalizeWorld({ date: "2026-06-10", word: "zzzzz", invented: true, story: { title: "t", body: "b" } })).not.toBeNull();
  });
});
