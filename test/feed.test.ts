// test/feed.test.ts
import { describe, expect, it } from "vitest";
import { buildDailyPost } from "../src/feed.ts";
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
