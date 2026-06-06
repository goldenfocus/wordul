import { describe, it, expect } from "vitest";
import { computeDailyStatsFromRoster, computeRosterView } from "../public/daily-stats.js";

describe("computeDailyStatsFromRoster", () => {
  // Mirrors the Jun 6 screenshot bug: tiles must agree with the player list, always.
  const full = {
    players: [
      { rank: 1, username: "word", gold: 125, guesses: 3, won: true,  score: 2500, durationMs: 234000 },
      { rank: 2, username: "yan",  gold: 119, guesses: 4, won: true,  score: 2100, durationMs: 141000 },
      { rank: 3, username: "yang", gold: 119, guesses: 4, won: true,  score: 2080, durationMs: 139000 },
      { rank: 4, username: "papa", gold: 117, guesses: 4, won: true,  score: 2000, durationMs: 260000 },
      { rank: 5, username: "oops", gold: 100, guesses: 8, won: false, score: 600 },
      { rank: 6, username: "quit", gold: 0,   guesses: 2, won: false, score: 0, resigned: true },
    ],
    total: 6,
  };

  it("played = roster length; tiles can never disagree with the list", () => {
    expect(computeDailyStatsFromRoster(full).played).toBe(6);
  });

  it("solve rate over all finishers", () => {
    expect(computeDailyStatsFromRoster(full).winRate).toBe(67); // 4/6 → 66.7 → 67
  });

  it("avg guesses among solves only", () => {
    expect(computeDailyStatsFromRoster(full).avgGuesses).toBeCloseTo((3 + 4 + 4 + 4) / 4, 6);
  });

  it("avg score is the mean of roster scores", () => {
    const mean = (2500 + 2100 + 2080 + 2000 + 600 + 0) / 6;
    expect(computeDailyStatsFromRoster(full).avgScore).toBeCloseTo(mean, 6);
  });

  it("distribution counts winners by guess count", () => {
    const v = computeDailyStatsFromRoster(full);
    const at = (g) => v.distRows.find((r) => r.guesses === g)?.count ?? 0;
    expect(at(3)).toBe(1);
    expect(at(4)).toBe(3);
    expect(at(2)).toBe(0); // the resigner's 2 rows are NOT a 2-guess solve
    expect(v.maxCount).toBe(3);
  });

  it("failed = lost without resigning; resigners counted separately", () => {
    const v = computeDailyStatsFromRoster(full);
    expect(v.losses).toBe(1);
  });

  it("empty/cold day yields zeros and null averages", () => {
    const v = computeDailyStatsFromRoster(null);
    expect(v.played).toBe(0);
    expect(v.winRate).toBe(null);
    expect(v.avgGuesses).toBe(null);
    expect(v.avgScore).toBe(null);
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
