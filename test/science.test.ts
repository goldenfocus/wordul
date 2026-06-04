import { describe, expect, it } from "vitest";
import {
  applyScienceEvent,
  buildWeeklyScienceSummary,
  countMask,
  emptyScienceState,
  maskToPattern,
  publicScienceSummary,
  type ScienceEvent,
} from "../src/science.ts";

const base = {
  at: 1000,
  date: "2026-06-03",
  roomKind: "daily" as const,
  wordLength: 5,
  maxGuesses: 6,
  mode: "race",
  edition: "yang",
};

describe("science aggregates", () => {
  it("turns masks into stable public patterns", () => {
    const pattern = maskToPattern(["green", "yellow", "gray", "gray", "green"]);
    expect(pattern).toBe("GYXXG");
    expect(countMask(pattern)).toEqual({ green: 2, yellow: 1, gray: 2 });
  });

  it("aggregates round, guess, power-up and finish events without usernames", () => {
    const state = emptyScienceState("2026-06-03", 0);
    const events: ScienceEvent[] = [
      { ...base, type: "round_started", participantCount: 2, botCount: 0 },
      {
        ...base,
        type: "guess_accepted",
        guessNumber: 1,
        elapsedMs: 12000,
        mask: "GXXYX",
        green: 1,
        yellow: 1,
        gray: 3,
        statusAfter: "playing",
        points: 150,
      },
      { ...base, type: "powerup_used", powerup: "vowel_count", guessNumber: 2, pointsSpent: 200 },
      {
        ...base,
        type: "player_finished",
        outcome: "won",
        guesses: 3,
        elapsedMs: 45000,
        points: 1300,
        answer: "CRANE",
        revealHints: 0,
        vowelHints: 1,
      },
    ];
    for (const e of events) applyScienceEvent(state, e);

    expect(state.totals.events).toBe(4);
    expect(state.totals.roundsStarted).toBe(1);
    expect(state.totals.acceptedGuesses).toBe(1);
    expect(state.totals.wins).toBe(1);
    expect(state.powerups.vowel_count).toBe(1);
    expect(state.guesses["1"].maskPatterns.GXXYX).toBe(1);
    expect(state.outcomes.guessDistribution["3"]).toBe(1);
    expect(state.hintUsage.vowelHints["1"]).toBe(1);
  });

  it("only publishes answer-level stats after the k threshold", () => {
    const state = emptyScienceState("2026-06-02", 0);
    for (let i = 0; i < 2; i++) {
      applyScienceEvent(state, {
        ...base,
        date: "2026-06-02",
        type: "player_finished",
        outcome: "won",
        guesses: 3,
        elapsedMs: 30000,
        points: 1000,
        answer: "CRANE",
        revealHints: 0,
        vowelHints: 0,
      });
    }
    expect(publicScienceSummary(state, { includeWords: true }).words).toEqual({});
    applyScienceEvent(state, {
      ...base,
      date: "2026-06-02",
      type: "player_finished",
      outcome: "lost",
      guesses: 6,
      elapsedMs: 90000,
      points: -100,
      answer: "CRANE",
      revealHints: 1,
      vowelHints: 0,
    });
    expect(publicScienceSummary(state, { includeWords: true }).words?.CRANE.finishes).toBe(3);
    expect(publicScienceSummary(state, { includeWords: false }).words).toBeUndefined();
  });

  it("builds a weekly rollup from public daily summaries", () => {
    const a = emptyScienceState("2026-06-02", 0);
    const b = emptyScienceState("2026-06-03", 0);
    applyScienceEvent(a, { ...base, date: "2026-06-02", type: "round_started", participantCount: 1, botCount: 0 });
    applyScienceEvent(b, { ...base, type: "round_started", participantCount: 2, botCount: 0 });

    const weekly = buildWeeklyScienceSummary([
      publicScienceSummary(a, { generatedAt: 1 }),
      publicScienceSummary(b, { generatedAt: 1 }),
    ], 2);

    expect(weekly.dates).toEqual(["2026-06-02", "2026-06-03"]);
    expect(weekly.totals.roundsStarted).toBe(2);
    expect(weekly.generatedAt).toBe(2);
  });
});
