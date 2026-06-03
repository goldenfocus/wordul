// test/feed.test.ts
import { describe, expect, it } from "vitest";
import { buildDailyPost, grayOpenerRate, letterRevealRate } from "../src/feed.ts";
import type { SciencePublicDailySummary } from "../src/science.ts";
import type { World } from "../src/daily-core.ts";

function summary(date: string, over: Partial<SciencePublicDailySummary> = {}): SciencePublicDailySummary {
  return {
    schemaVersion: 1, date, createdAt: 0, updatedAt: 0,
    totals: { events: 0, roundsStarted: 0, acceptedGuesses: 0, playerFinishes: 100,
      wins: 64, losses: 30, resigns: 6, powerups: 0, botEvents: 0 },
    segments: { roomKind: {}, wordLength: {}, mode: {}, edition: {} },
    participants: { roundStarts: 0,
      observedHumansAtStart: { count: 0, sum: 0, min: null, max: null, mean: null },
      observedBotsAtStart: { count: 0, sum: 0, min: null, max: null, mean: null } },
    guesses: {},
    outcomes: { byResult: {}, guessDistribution: { "1": 4, "3": 30, "4": 40, "5": 20, "6": 6 },
      elapsedMs: { count: 0, sum: 0, min: null, max: null, mean: null },
      points: { count: 0, sum: 0, min: null, max: null, mean: null } },
    powerups: { reveal_letter: 0, vowel_count: 0 },
    hintUsage: { revealHints: {}, vowelHints: {} },
    generatedAt: 0,
    privacy: { noUsernames: true, noRawTimelines: true, wordStatsK: 3, wordStats: "k-anonymized" },
    ...over,
  };
}

const world = (over: Partial<World> = {}): World => ({
  date: "2026-06-02", word: "CRANE", edition: "default", voice: "yang",
  story: { title: "Why CRANE?", body: "A bird and a machine." }, createdAt: 0, ...over,
});

describe("buildDailyPost — extended findings", () => {
  it("adds first-try, gray-opener, and letter-reveal findings when data supports them", () => {
    const s = summary("2026-06-02", {
      guesses: {
        "1": { count: 90, solved: 4, grayOnly: 30, greenTiles: 0, yellowTiles: 0, maskPatterns: {},
          elapsedMs: { count: 0, sum: 0, min: null, max: null, mean: null } },
      },
      hintUsage: { revealHints: { "0": 89, "1": 11 }, vowelHints: {} },
    });
    const post = buildDailyPost(s, world(), [], { todayUTC: "2026-06-03" });
    const byKind = Object.fromEntries(post.findings.map((f) => [f.kind, f]));
    expect(byKind.first_try_solves.value).toBe(4);          // guessDistribution["1"] = 4 of 100
    expect(byKind.gray_opener_rate.value).toBe(33);          // 30 of 90 opening guesses all-gray
    expect(byKind.letter_reveal_rate.value).toBe(11);        // 11 of 100 revealed a letter
  });

  it("omits findings the data cannot support", () => {
    const post = buildDailyPost(summary("2026-06-02", { guesses: {}, hintUsage: { revealHints: {}, vowelHints: {} } }),
      world(), [], { todayUTC: "2026-06-03" });
    const kinds = post.findings.map((f) => f.kind);
    expect(kinds).not.toContain("gray_opener_rate");
    expect(kinds).not.toContain("letter_reveal_rate");
  });
});

describe("buildDailyPost — past-day data block", () => {
  it("computes an honest solve rate, median, and participation from the summary", () => {
    const post = buildDailyPost(summary("2026-06-02"), world(), [], { todayUTC: "2026-06-03" });
    expect(post.kind).toBe("daily-discovery");
    expect(post.slug).toBe("2026-06-02");
    expect(post.published).toBe(true);
    const byKind = Object.fromEntries(post.findings.map((f) => [f.kind, f]));
    expect(byKind.solve_rate.value).toBe(64);
    expect(byKind.solve_rate.display).toBe("64%");
    expect(byKind.median_guesses.value).toBe(4); // weighted median of the distribution
    expect(byKind.participation.value).toBe(100);
  });
});
