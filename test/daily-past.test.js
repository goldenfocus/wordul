import { describe, it, expect } from "vitest";
import { renderPastDailyCard, clampOffset } from "../public/daily-past.js";

const stats = { played: 1204, winRate: 71 };
const base = { date: "2026-06-07", themeName: "Aurora", word: "CRANE", stats };

describe("clampOffset", () => {
  it("never goes past today (0) or before the oldest day", () => {
    expect(clampOffset(2, 5)).toBe(0);        // future clamped to today
    expect(clampOffset(-99, 5)).toBe(-4);     // oldest is -(n-1)
    expect(clampOffset(-3, 5)).toBe(-3);      // in range passes through
  });
});

describe("renderPastDailyCard", () => {
  it("always reveals the answer and the day's stats", () => {
    const html = renderPastDailyCard({ ...base, myRecord: null });
    expect(html).toContain("CRANE");
    expect(html).toContain("1,204");          // thousands-formatted played
    expect(html).toContain("71%");
  });

  it("shows a Play-it affordance when I did not play that day", () => {
    const html = renderPastDailyCard({ ...base, myRecord: null });
    expect(html).toContain("data-past-play");
    expect(html).not.toContain("data-past-replay");
  });

  it("shows my stamp + replay button when I played that day", () => {
    const myRecord = { won: true, guesses: 4, solveGrid: ["ggggg"], solveWords: ["CRANE"] };
    const html = renderPastDailyCard({ ...base, myRecord });
    expect(html).toContain("daily-stamp");    // renderStamp output
    expect(html).toContain("data-past-replay");
    expect(html).toContain("4/6");            // result line (board rows for a 5-letter word)
  });
});
