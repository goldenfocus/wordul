import { describe, it, expect } from "vitest";
import { recentGameView, prettyRoomLabel, humanizeReason, formatLedgerRow } from "../public/profile-core.js";

const daily = (date, over = {}) => ({
  roomPath: `daily/${date}`, finishedAt: 1, wordLength: 5, result: "won", guesses: 3,
  opponents: [], solveGrid: ["yxxxx", "ggggg"], words: ["AROSE", "BRAVE"], ...over,
});
const room = (path, over = {}) => ({
  roomPath: path, finishedAt: 1, wordLength: 5, result: "lost", guesses: 6, opponents: [], ...over,
});

describe("recentGameView", () => {
  const today = "2026-06-04";

  it("never carries the redundant top-level word field", () => {
    // The server drops g.word; recentGameView must not resurrect it (letters come from words[]).
    const v = recentGameView({ ...daily("2026-06-01"), word: "ZZZZZ" }, { today, playedToday: true });
    expect(v.word).toBeUndefined();
    expect(JSON.stringify(v)).not.toContain("ZZZZZ");
  });

  it("labels a daily game 'Daily' + its date, won as 'solved in N'", () => {
    const v = recentGameView(daily("2026-06-01"), { today, playedToday: true });
    expect(v.kind).toBe("daily");
    expect(v.label).toBe("Daily · 2026-06-01");
    expect(v.icon).toBe("✅");
    expect(v.result).toBe("solved in 3");
    expect(v.roomHref).toBeNull();           // never navigate to /@daily/<date> (that shows YOUR board)
  });

  it("shows a past daily's FULL letter-card (that day is over — letters are fair game)", () => {
    const v = recentGameView(daily("2026-06-01"), { today, playedToday: false });
    expect(v.locked).toBe(false);
    expect(v.grid).toEqual(["yxxxx", "ggggg"]);
    expect(v.words).toEqual(["AROSE", "BRAVE"]);
  });

  it("locks TODAY's daily until the viewer has played (no colors, no letters)", () => {
    const v = recentGameView(daily(today), { today, playedToday: false });
    expect(v.locked).toBe(true);
    expect(v.grid).toBeNull();
    expect(v.words).toBeNull();
  });

  it("unlocks today's daily once the viewer has played (colors; letters only if the server shipped them)", () => {
    const v = recentGameView(daily(today, { words: undefined }), { today, playedToday: true });
    expect(v.locked).toBe(false);
    expect(v.grid).toEqual(["yxxxx", "ggggg"]);
    expect(v.words).toBeNull();               // server withholds today's letters → letterless
  });

  it("renders a room game's stored letter-card (no link fallback when a board exists)", () => {
    const v = recentGameView(room("crane/snappy-moose", { solveGrid: ["xyxxx"], words: ["AUDIO"] }), { today, playedToday: true });
    expect(v.kind).toBe("room");
    expect(v.label).toBe("Snappy Moose");
    expect(v.result).toBe("missed");
    expect(v.grid).toEqual(["xyxxx"]);
    expect(v.words).toEqual(["AUDIO"]);
    expect(v.roomHref).toBeNull();
  });

  it("falls back to a room link for a legacy room game with no stored board", () => {
    const v = recentGameView(room("crane/snappy-moose"), { today, playedToday: true });
    expect(v.grid).toBeNull();
    expect(v.roomHref).toBe("/@crane/snappy-moose");
  });
});

describe("humanizeReason", () => {
  it("maps the two known mint reasons to friendly labels", () => {
    expect(humanizeReason("mint:daily")).toBe("Daily solve");
    expect(humanizeReason("mint:cashout")).toBe("Race win");
  });
  it("cleans an unknown reason into a title-case label", () => {
    expect(humanizeReason("mint:weekly_streak")).toBe("Weekly Streak");
    expect(humanizeReason("bonus")).toBe("Bonus");
  });
  it("never throws on junk", () => {
    expect(humanizeReason("")).toBe("");
    expect(humanizeReason(undefined)).toBe("");
  });
});

describe("formatLedgerRow", () => {
  const now = Date.UTC(2026, 5, 5, 12, 0, 0); // 2026-06-05 noon UTC

  it("formats a daily earning with valid parts (icon, label, +amount, parts)", () => {
    const tx = {
      token: "gold", delta: 133, reason: "mint:daily", ts: now,
      parts: [{ label: "score", delta: 28 }, { label: "daily", delta: 100 }, { label: "speed", delta: 5 }],
    };
    const row = formatLedgerRow(tx, now);
    expect(row.icon).toBe("🎁");
    expect(row.label).toBe("Daily solve");
    expect(row.amount).toBe("+133");
    expect(row.parts).toEqual([
      { label: "score", delta: 28 },
      { label: "daily", delta: 100 },
      { label: "speed", delta: 5 },
    ]);
  });

  it("formats a race win flat (🏁, no parts)", () => {
    const tx = { token: "gold", delta: 40, reason: "mint:cashout", ts: now };
    const row = formatLedgerRow(tx, now);
    expect(row.icon).toBe("🏁");
    expect(row.label).toBe("Race win");
    expect(row.amount).toBe("+40");
    expect(row.parts).toEqual([]);
  });

  it("DROPS malformed parts whose Σ ≠ delta (shows the total only)", () => {
    const tx = {
      token: "gold", delta: 133, reason: "mint:daily", ts: now,
      parts: [{ label: "score", delta: 28 }, { label: "daily", delta: 100 }], // sums 128 ≠ 133
    };
    const row = formatLedgerRow(tx, now);
    expect(row.parts).toEqual([]);
    expect(row.amount).toBe("+133");
  });

  it("keeps parts when Σ exactly equals delta", () => {
    const tx = {
      token: "gold", delta: 128, reason: "mint:daily", ts: now,
      parts: [{ label: "score", delta: 28 }, { label: "daily", delta: 100 }],
    };
    expect(formatLedgerRow(tx, now).parts).toHaveLength(2);
  });

  it("labels today's earning 'Today' and an older one by month/day", () => {
    const today = { token: "gold", delta: 10, reason: "mint:cashout", ts: now };
    const older = { token: "gold", delta: 10, reason: "mint:cashout", ts: Date.UTC(2026, 5, 1, 12, 0, 0) };
    expect(formatLedgerRow(today, now).date).toBe("Today");
    expect(formatLedgerRow(older, now).date).not.toBe("Today");
    expect(formatLedgerRow(older, now).date).toBeTruthy();
  });
});

describe("prettyRoomLabel", () => {
  it("turns a slug into spaced Title Case", () => {
    expect(prettyRoomLabel("snappy-moose")).toBe("Snappy Moose");
    expect(prettyRoomLabel("abc")).toBe("Abc");
    expect(prettyRoomLabel("")).toBe("");
  });
});
