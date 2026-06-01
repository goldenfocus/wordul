import { describe, it, expect } from "vitest";
import { summarizeRoomGame } from "../src/records.ts";

describe("summarizeRoomGame", () => {
  it("flags solo and carries winner + scores", () => {
    const g = summarizeRoomGame({
      round: 3,
      word: "crane",
      winner: "yan",
      finishedAt: 1000,
      players: [{ username: "yan", status: "won", guesses: 3 }],
    });
    expect(g.solo).toBe(true);
    expect(g.round).toBe(3);
    expect(g.winner).toBe("yan");
    expect(g.players[0]).toEqual({ username: "yan", result: "won", guesses: 3 });
  });

  it("marks a race (>1 player), maps non-winners to lost, keeps no-winner null", () => {
    const g = summarizeRoomGame({
      round: 1,
      word: "spoon",
      winner: null,
      finishedAt: 2000,
      players: [
        { username: "yan", status: "lost", guesses: 6 },
        { username: "alex", status: "playing", guesses: 4 },
      ],
    });
    expect(g.solo).toBe(false);
    expect(g.winner).toBe(null);
    expect(g.players.map((p) => p.result)).toEqual(["lost", "lost"]);
  });
});
