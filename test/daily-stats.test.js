import { describe, it, expect } from "vitest";
import { computeDailyStatsView, computeRosterView } from "../public/daily-stats.js";

describe("computeDailyStatsView", () => {
  const summary = {
    totals: { roundsStarted: 1248, playerFinishes: 1100, wins: 900, losses: 180, resigns: 20 },
    outcomes: {
      guessDistribution: { 1: 5, 2: 40, 3: 200, 4: 350, 5: 200, 6: 105 },
      points: { mean: 4200.5 },
    },
  };

  it("uses roundsStarted as the play count, falling back to playerFinishes", () => {
    expect(computeDailyStatsView(summary).played).toBe(1248);
    expect(computeDailyStatsView({ totals: { playerFinishes: 77 } }).played).toBe(77);
  });

  it("computes solve rate over finished games", () => {
    // wins 900 / (900+180+20 = 1100) = 81.8% -> 82
    expect(computeDailyStatsView(summary).winRate).toBe(82);
  });

  it("computes average guesses among solved games only", () => {
    const v = computeDailyStatsView(summary);
    const solved = 5 + 40 + 200 + 350 + 200 + 105; // 900
    const weighted = 1 * 5 + 2 * 40 + 3 * 200 + 4 * 350 + 5 * 200 + 6 * 105; // 4115
    expect(v.avgGuesses).toBeCloseTo(weighted / solved, 6);
  });

  it("surfaces average score and a distribution for bars", () => {
    const v = computeDailyStatsView(summary);
    expect(v.avgScore).toBe(4200.5);
    expect(v.maxCount).toBe(350);
    expect(v.distRows).toHaveLength(8); // guesses 1..8 (variable-length rows cap at 8)
    expect(v.distRows[3]).toEqual({ guesses: 4, count: 350 });
    expect(v.distRows[6]).toEqual({ guesses: 7, count: 0 });
  });

  it("degrades to nulls / zeros on an empty or missing summary", () => {
    for (const empty of [null, undefined, {}, { totals: {} }]) {
      const v = computeDailyStatsView(empty);
      expect(v.played).toBe(0);
      expect(v.winRate).toBeNull();
      expect(v.avgGuesses).toBeNull();
      expect(v.avgScore).toBeNull();
      expect(v.maxCount).toBe(0);
    }
  });
});

describe("computeRosterView", () => {
  it("marks the viewer row and preserves order", () => {
    const full = { players: [
      { rank: 1, username: "ava", gold: 1240, guesses: 2, won: true, durationMs: 95000 },
      { rank: 2, username: "me", gold: 540, guesses: 4, won: true, durationMs: 200000 },
    ], total: 2 };
    const v = computeRosterView(full, "me");
    expect(v.rows.map((r) => r.username)).toEqual(["ava", "me"]);
    expect(v.rows[1].isYou).toBe(true);
    expect(v.total).toBe(2);
  });

  it("handles an empty/absent roster", () => {
    expect(computeRosterView(null, "me")).toEqual({ rows: [], total: 0 });
  });
});
