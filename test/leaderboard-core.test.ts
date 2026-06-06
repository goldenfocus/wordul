import { describe, it, expect } from "vitest";
import { topDaily, fullDaily, type RankablePlayer } from "../src/leaderboard-core.ts";

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

  it("ranks bots inline and excludes only unscored (still-playing / failed-mint) players", () => {
    const players: RankablePlayer[] = [
      p("ava", 1240, 2),
      { username: "clanker", guessCount: 2, won: true, goldAwarded: 9999, isBot: true },
      { username: "still", guessCount: 1, won: false, goldAwarded: undefined },
    ];
    const { top, total } = topDaily(players, "ava", 3);
    expect(top.map((e) => e.username)).toEqual(["clanker", "ava"]);
    expect(total).toBe(2);
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

  it("carries the resigned flag through and sinks a 0-gold quitter to the bottom", () => {
    const players: RankablePlayer[] = [
      p("ava", 1240, 2),                                                              // solved
      { username: "quit", guessCount: 2, won: false, resigned: true, goldAwarded: 0 }, // gave up, forfeited
      { username: "tried", guessCount: 6, won: false, goldAwarded: 90 },              // ran out, kept gold
    ];
    const { top } = topDaily(players, "quit", 3);
    expect(top.map((e) => e.username)).toEqual(["ava", "tried", "quit"]); // quitter last (0 gold)
    expect(top.find((e) => e.username === "quit")).toMatchObject({ gold: 0, resigned: true, won: false });
    expect(top.find((e) => e.username === "tried")?.resigned).toBeUndefined(); // ran-out is not a resign
  });

  it("clamps n into [1,10] and defaults bad n to 3", () => {
    const players = [p("a", 5, 2), p("b", 4, 2), p("c", 3, 2), p("d", 2, 2)];
    expect(topDaily(players, "a", 0).top).toHaveLength(3);   // 0 → default 3
    expect(topDaily(players, "a", 99).top).toHaveLength(4);  // clamp ≤10, but only 4 exist
    expect(topDaily(players, "a", 2).top).toHaveLength(2);
  });

  it("carries grid and durationMs through into top entries", () => {
    const players: RankablePlayer[] = [
      { username: "ava", guessCount: 2, won: true, goldAwarded: 1240, grid: ["ggggg"], durationMs: 134000 },
    ];
    const { top } = topDaily(players, "ava", 3);
    expect(top[0].grid).toEqual(["ggggg"]);
    expect(top[0].durationMs).toBe(134000);
  });

  it("leaves grid/durationMs undefined when not provided", () => {
    const { top } = topDaily([p("ava", 1240, 2)], "ava", 3);
    expect(top[0].grid).toBeUndefined();
    expect(top[0].durationMs).toBeUndefined();
  });
});

describe("fullDaily", () => {
  it("returns every ranked player with a 1-based rank, sorted like topDaily", () => {
    const players = [
      p("ava", 1240, 2), p("bao", 1090, 3), p("cy", 980, 3),
      p("dot", 700, 4), p("me", 540, 4),
    ];
    const view = fullDaily(players, "me");
    expect(view.players.map((e) => e.username)).toEqual(["ava", "bao", "cy", "dot", "me"]);
    expect(view.players.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(view.total).toBe(5);
    expect(view.youRank).toBe(5);
  });

  it("ranks bots inline, excludes only unscored players, and reports youRank null when unranked", () => {
    const players: RankablePlayer[] = [
      p("ava", 1240, 2),
      { username: "clanker", guessCount: 2, won: true, goldAwarded: 9999, isBot: true },
      { username: "still", guessCount: 1, won: false, goldAwarded: undefined },
    ];
    const view = fullDaily(players, "ghost");
    expect(view.players.map((e) => e.username)).toEqual(["clanker", "ava"]);
    expect(view.total).toBe(2);
    expect(view.youRank).toBeNull();
  });

  it("carries durationMs through (grid is left to the caller and may be absent)", () => {
    const players: RankablePlayer[] = [
      { username: "ava", guessCount: 2, won: true, goldAwarded: 1240, durationMs: 95000 },
    ];
    const view = fullDaily(players, "ava");
    expect(view.players[0].durationMs).toBe(95000);
    expect(view.players[0].grid).toBeUndefined();
  });

  it("reports youRank null for an anonymous viewer (empty username)", () => {
    expect(fullDaily([p("ava", 1240, 2)], "").youRank).toBeNull();
  });
});

describe("score + bots on the board", () => {
  const players = [
    { username: "yan", guessCount: 4, won: true, goldAwarded: 119, score: 1900 },
    { username: "maya", guessCount: 3, won: true, isBot: true, goldAwarded: 125, score: 2100 },
    { username: "mid-game", guessCount: 2, won: false, score: 800 }, // no goldAwarded → unranked
  ];

  it("ranks bots inline by the same gold-desc sort", () => {
    const view = fullDaily(players, "yan");
    expect(view.players.map((p) => p.username)).toEqual(["maya", "yan"]);
    expect(view.players[0].rank).toBe(1);
    expect(view.total).toBe(2);
  });

  it("passes score through to entries", () => {
    const view = fullDaily(players, "yan");
    expect(view.players.map((p) => p.score)).toEqual([2100, 1900]);
  });

  it("never leaks isBot on output rows (worduler cover rule)", () => {
    for (const row of fullDaily(players, "yan").players) {
      expect("isBot" in row).toBe(false);
    }
    for (const row of topDaily(players, "yan", 3).top) {
      expect("isBot" in row).toBe(false);
    }
  });

  it("still requires a confirmed goldAwarded to rank", () => {
    expect(fullDaily(players, "mid-game").youRank).toBe(null);
  });
});
