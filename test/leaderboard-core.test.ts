import { describe, it, expect } from "vitest";
import { topDaily, type RankablePlayer } from "../src/leaderboard-core.ts";

// helper: a scored, finished human player
const p = (username: string, gold: number, guesses: number, won = true): RankablePlayer => ({
  username, guessCount: guesses, won, goldAwarded: gold,
});

describe("topDaily", () => {
  it("ranks by gold desc, then fewer guesses, then username", () => {
    const players = [p("bao", 980, 3), p("ava", 1240, 2), p("cy", 980, 2), p("dot", 980, 3)];
    const { top } = topDaily(players, "ava", 3);
    expect(top.map((e) => e.username)).toEqual(["ava", "cy", "bao"]);
    // bao vs dot tie on gold+guesses → username asc puts bao before dot (dot is 4th)
  });

  it("excludes bots and unscored (still-playing / failed-mint) players", () => {
    const players: RankablePlayer[] = [
      p("ava", 1240, 2),
      { username: "clanker", guessCount: 2, won: true, goldAwarded: 9999, isBot: true },
      { username: "still", guessCount: 1, won: false, goldAwarded: undefined },
    ];
    const { top, total } = topDaily(players, "ava", 3);
    expect(top.map((e) => e.username)).toEqual(["ava"]);
    expect(total).toBe(1);
  });

  it("returns you=null when the caller is inside the top N", () => {
    const players = [p("ava", 1240, 2), p("bao", 1090, 3), p("cy", 980, 3)];
    const view = topDaily(players, "bao", 3);
    expect(view.you).toBeNull();
    expect(view.top.find((e) => e.username === "bao")).toBeTruthy();
  });

  it("pins the caller with a 1-based rank when outside the top N", () => {
    const players = [
      p("ava", 1240, 2), p("bao", 1090, 3), p("cy", 980, 3),
      p("dot", 700, 4), p("me", 540, 4),
    ];
    const view = topDaily(players, "me", 3);
    expect(view.top).toHaveLength(3);
    expect(view.you).toEqual({ username: "me", gold: 540, guesses: 4, won: true, rank: 5 });
  });

  it("you=null when the caller has no scored row", () => {
    expect(topDaily([p("ava", 1240, 2)], "ghost", 3).you).toBeNull();
  });

  it("handles an empty board", () => {
    expect(topDaily([], "ava", 3)).toEqual({ top: [], you: null, total: 0 });
  });

  it("clamps n into [1,10] and defaults bad n to 3", () => {
    const players = [p("a", 5, 2), p("b", 4, 2), p("c", 3, 2), p("d", 2, 2)];
    expect(topDaily(players, "a", 0).top).toHaveLength(3);   // 0 → default 3
    expect(topDaily(players, "a", 99).top).toHaveLength(4);  // clamp ≤10, but only 4 exist
    expect(topDaily(players, "a", 2).top).toHaveLength(2);
  });
});
