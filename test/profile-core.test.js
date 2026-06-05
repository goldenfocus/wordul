import { describe, it, expect } from "vitest";
import { recentGameView, prettyRoomLabel } from "../public/profile-core.js";

const daily = (date, over = {}) => ({
  roomPath: `daily/${date}`, finishedAt: 1, wordLength: 5, result: "won", guesses: 3,
  opponents: [], solveGrid: ["yxxxx", "ggggg"], ...over,
});
const room = (path, over = {}) => ({
  roomPath: path, finishedAt: 1, wordLength: 5, result: "lost", guesses: 6, opponents: [], ...over,
});

describe("recentGameView", () => {
  const today = "2026-06-04";

  it("never carries the answer word, even if one leaks back into the record", () => {
    const v = recentGameView({ ...daily("2026-06-01"), word: "CRANK" }, { today, playedToday: true });
    expect(JSON.stringify(v)).not.toContain("CRANK");
  });

  it("labels a daily game 'Daily' + its date, won as 'solved in N'", () => {
    const v = recentGameView(daily("2026-06-01"), { today, playedToday: true });
    expect(v.kind).toBe("daily");
    expect(v.label).toBe("Daily · 2026-06-01");
    expect(v.icon).toBe("✅");
    expect(v.result).toBe("solved in 3");
    expect(v.roomHref).toBeNull();           // never navigate to /@daily/<date> (that shows YOUR board)
  });

  it("shows a past daily's letterless grid (that day is over — no spoiler)", () => {
    const v = recentGameView(daily("2026-06-01"), { today, playedToday: false });
    expect(v.locked).toBe(false);
    expect(v.grid).toEqual(["yxxxx", "ggggg"]);
  });

  it("locks TODAY's daily until the viewer has played (colors could hint the live answer)", () => {
    const v = recentGameView(daily(today), { today, playedToday: false });
    expect(v.locked).toBe(true);
    expect(v.grid).toBeNull();               // withhold colors entirely while locked
  });

  it("unlocks today's daily once the viewer has played", () => {
    const v = recentGameView(daily(today), { today, playedToday: true });
    expect(v.locked).toBe(false);
    expect(v.grid).toEqual(["yxxxx", "ggggg"]);
  });

  it("renders a room game as a link to the room (no stored grid to show)", () => {
    const v = recentGameView(room("crane/snappy-moose"), { today, playedToday: true });
    expect(v.kind).toBe("room");
    expect(v.label).toBe("Snappy Moose");
    expect(v.result).toBe("missed");
    expect(v.icon).toBe("❌");
    expect(v.grid).toBeNull();
    expect(v.roomHref).toBe("/@crane/snappy-moose");
    expect(v.locked).toBe(false);
  });
});

describe("prettyRoomLabel", () => {
  it("turns a slug into spaced Title Case", () => {
    expect(prettyRoomLabel("snappy-moose")).toBe("Snappy Moose");
    expect(prettyRoomLabel("abc")).toBe("Abc");
    expect(prettyRoomLabel("")).toBe("");
  });
});
