import { describe, it, expect } from "vitest";
import { bumpScoreboard } from "../src/scoreboard.ts";

describe("bumpScoreboard", () => {
  it("adds entries, increments played for all and wins for the winner", () => {
    let b = bumpScoreboard([], { winner: "yan", participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 1, played: 1 },
      { username: "bob", wins: 0, played: 1 },
    ]);
    b = bumpScoreboard(b, { winner: "bob", participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 1, played: 2 },
      { username: "bob", wins: 1, played: 2 },
    ]);
  });
  it("handles a round nobody won", () => {
    const b = bumpScoreboard([], { winner: null, participants: ["yan"] });
    expect(b).toEqual([{ username: "yan", wins: 0, played: 1 }]);
  });
});
