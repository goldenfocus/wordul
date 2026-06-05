import { describe, it, expect } from "vitest";
import { recentGameView, prettyRoomLabel } from "../public/profile-core.js";

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

describe("prettyRoomLabel", () => {
  it("turns a slug into spaced Title Case", () => {
    expect(prettyRoomLabel("snappy-moose")).toBe("Snappy Moose");
    expect(prettyRoomLabel("abc")).toBe("Abc");
    expect(prettyRoomLabel("")).toBe("");
  });
});
