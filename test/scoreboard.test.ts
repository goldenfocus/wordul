import { describe, it, expect } from "vitest";
import { bumpScoreboard } from "../src/scoreboard.ts";

describe("bumpScoreboard", () => {
  it("records win for the winner and loss for the other participant", () => {
    let b = bumpScoreboard([], { winner: "yan", participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 1, losses: 0, ties: 0, played: 1 },
      { username: "bob", wins: 0, losses: 1, ties: 0, played: 1 },
    ]);
    b = bumpScoreboard(b, { winner: "bob", participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 1, losses: 1, ties: 0, played: 2 },
      { username: "bob", wins: 1, losses: 1, ties: 0, played: 2 },
    ]);
  });
  it("records a tie for everyone when nobody won", () => {
    const b = bumpScoreboard([], { winner: null, participants: ["yan", "bob"] });
    expect(b).toEqual([
      { username: "yan", wins: 0, losses: 0, ties: 1, played: 1 },
      { username: "bob", wins: 0, losses: 0, ties: 1, played: 1 },
    ]);
  });
  it("does not record a loss when the winner is not a participant", () => {
    const b = bumpScoreboard([], { winner: "ghost", participants: ["yan"] });
    expect(b).toEqual([{ username: "yan", wins: 0, losses: 0, ties: 0, played: 1 }]);
  });
  it("backfills losses/ties on a pre-existing entry", () => {
    const legacy = [{ username: "yan", wins: 2, played: 3 }];
    const b = bumpScoreboard(legacy, { winner: "yan", participants: ["yan"] });
    expect(b).toEqual([{ username: "yan", wins: 3, losses: 0, ties: 0, played: 4 }]);
  });
});
