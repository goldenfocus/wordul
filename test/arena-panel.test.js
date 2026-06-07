import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { arenaRowProps, arenaEmptyState, pickNextGame, seatLabel, isHot, nextPollMs } from "../public/arena-panel.js";
import { compactRowProps } from "../public/lobby-view.js";

const game = {
  routePath: "/@arena/maya-0",
  name: "Maya's room",
  host: "Maya",
  personaIcon: "🦊",
  edition: "default",
  wordLength: 5,
  seats: "1/2",
};

describe("arenaRowProps (F1)", () => {
  it("maps an OpenGame to row props", () => {
    expect(arenaRowProps(game)).toMatchObject({
      routePath: "/@arena/maya-0",
      avatar: "🦊",
      host: "Maya",
      wordLength: 5,
      seats: "1/2",
      edition: "default",
    });
  });
});

describe("arenaEmptyState (F2)", () => {
  it("null games → loading", () => {
    expect(arenaEmptyState(null, false)).toBe("loading");
  });
  it("isError → error (even with stale games)", () => {
    expect(arenaEmptyState([game], true)).toBe("error");
    expect(arenaEmptyState(null, true)).toBe("error");
  });
  it("empty array → empty", () => {
    expect(arenaEmptyState([], false)).toBe("empty");
  });
  it("non-empty array → list", () => {
    expect(arenaEmptyState([game], false)).toBe("list");
  });
});

describe("seatLabel (F4)", () => {
  it("returns the seats string", () => {
    expect(seatLabel({ seats: "4/5" })).toBe("4/5");
  });
  it("defaults to 1/2 when seats are missing", () => {
    expect(seatLabel({})).toBe("1/2");
    expect(seatLabel(null)).toBe("1/2");
  });
});

describe("isHot (F5) — FOMO highlight for near-full rooms", () => {
  it("true when exactly one seat remains", () => {
    expect(isHot({ seats: "4/5" })).toBe(true);
    expect(isHot({ seats: "5/6" })).toBe(true);
  });
  it("false with two or more seats free", () => {
    expect(isHot({ seats: "1/6" })).toBe(false);
    expect(isHot({ seats: "3/5" })).toBe(false);
  });
  it("false when full (about to vanish, not joinable)", () => {
    expect(isHot({ seats: "5/5" })).toBe(false);
  });
  it("false for malformed/missing seats", () => {
    expect(isHot({})).toBe(false);
    expect(isHot({ seats: "??" })).toBe(false);
  });
});

describe("pickNextGame (F3) — the 'Join next game' target", () => {
  const maya = { routePath: "/@arena/maya-0", host: "Maya" };
  const yan = { routePath: "/@yan/abcd", host: "yan" };
  const wurdl = { routePath: "/@arena/wurdl-2", host: "wurdl" };

  it("returns the first game that isn't the room just played", () => {
    expect(pickNextGame([maya, yan, wurdl], "/@arena/maya-0")).toBe("/@yan/abcd");
  });
  it("returns the first game when the current room isn't in the list", () => {
    expect(pickNextGame([maya, yan], "/@someone/gone")).toBe("/@arena/maya-0");
  });
  it("returns null when the only open game is the room just played", () => {
    expect(pickNextGame([maya], "/@arena/maya-0")).toBe(null);
  });
  it("returns null for an empty list", () => {
    expect(pickNextGame([], "/@arena/maya-0")).toBe(null);
  });
  it("returns null defensively for null/undefined games", () => {
    expect(pickNextGame(null, "/@arena/maya-0")).toBe(null);
    expect(pickNextGame(undefined, "/@arena/maya-0")).toBe(null);
  });
});

describe("nextPollMs (F6) — adaptive poll while the list is empty", () => {
  it("a populated list polls at the relaxed cadence", () => {
    expect(nextPollMs("list", false)).toBe(8000);
    expect(nextPollMs("list", true)).toBe(8000);
  });
  it("standalone arena with nothing tappable polls fast (empty/loading/error)", () => {
    expect(nextPollMs("empty", false)).toBe(2000);
    expect(nextPollMs("loading", false)).toBe(2000);
    expect(nextPollMs("error", false)).toBe(2000);
  });
  it("the in-room lobby rail never fast-polls (it lives for minutes)", () => {
    expect(nextPollMs("empty", true)).toBe(8000);
    expect(nextPollMs("error", true)).toBe(8000);
  });
});

describe("compact floor row", () => {
  it("row props carry a letters×rows board dimension (rows = smart default tries)", () => {
    const p = compactRowProps({ routePath: "/@m/x", personaIcon: "🦊", host: "maya", wordLength: 6, seats: "2/4", edition: "default" });
    expect(p.tries).toBe(7);
    expect(p.dim).toBe("6×7");
  });
});

describe("rail pill count plumbing", () => {
  const src = readFileSync(new URL("../public/arena-panel.js", import.meta.url), "utf8");
  it("mountArenaList reports the visible count via onCount", () => {
    expect(src).toContain("onCount");
    expect(src).toContain("onCount(state === \"list\" ? visible.length : 0)");
  });
});
