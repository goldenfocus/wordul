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
    const pattern = maskToPattern(["hot", "warm", "cold", "cold", "hot"]);
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

  // Jun 7 2026 incident: the Lab said "32% found it" while the two real daily players
  // both solved — pooled totals mixed room-race losses into the daily word's stats.
  // Per-kind scopes keep the daily readable on its own.
  describe("per-kind scopes", () => {
    const finish = (over: Record<string, unknown> = {}): ScienceEvent => ({
      ...base,
      type: "player_finished",
      outcome: "won",
      guesses: 3,
      elapsedMs: 30000,
      points: 1000,
      answer: "GOLLY",
      revealHints: 0,
      vowelHints: 0,
      ...over,
    } as ScienceEvent);

    it("segments finishes, openers and hints by roomKind so the daily is readable alone", () => {
      const state = emptyScienceState("2026-06-03", 0);
      applyScienceEvent(state, {
        ...base, type: "guess_accepted", guessNumber: 1, elapsedMs: 5000,
        mask: "XXXXX", green: 0, yellow: 0, gray: 5, statusAfter: "playing", points: 0,
      });
      applyScienceEvent(state, finish({ revealHints: 1 }));
      applyScienceEvent(state, finish({ roomKind: "room", outcome: "lost", guesses: 6, answer: "PIANO" }));
      applyScienceEvent(state, finish({ roomKind: "room", outcome: "lost", guesses: 6, answer: "PIANO" }));

      expect(state.kinds.daily?.playerFinishes).toBe(1);
      expect(state.kinds.daily?.wins).toBe(1);
      expect(state.kinds.daily?.guessDistribution).toEqual({ "3": 1 });
      expect(state.kinds.daily?.openers).toEqual({ count: 1, grayOnly: 1 });
      expect(state.kinds.daily?.revealHints).toEqual({ "1": 1 });
      expect(state.kinds.room?.playerFinishes).toBe(2);
      expect(state.kinds.room?.wins).toBe(0);
      expect(state.totals.playerFinishes).toBe(3); // pooled totals unchanged
    });

    it("keeps bot plays out of every kind scope", () => {
      const state = emptyScienceState("2026-06-03", 0);
      applyScienceEvent(state, finish({ isBot: true }));
      expect(state.kinds.daily).toBeUndefined();
      expect(state.totals.botEvents).toBe(1);
    });

    it("surfaces the daily answer's bucket below K only when explicitly requested", () => {
      const state = emptyScienceState("2026-06-03", 0);
      applyScienceEvent(state, finish());
      const pub = publicScienceSummary(state, { includeWords: true, dailyAnswer: "GOLLY" });
      expect(pub.words).toEqual({}); // the k-anonymized map still holds the K=3 line
      expect(pub.dailyWord?.finishes).toBe(1);
      expect(pub.dailyWord?.wins).toBe(1);
      expect(publicScienceSummary(state, { includeWords: true }).dailyWord).toBeUndefined();
    });
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
