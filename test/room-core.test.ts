import { describe, it, expect } from "vitest";
import { outpacedLosers } from "../src/room-core.ts";
import type { PlayerState } from "../src/types.ts";

function player(username: string, status: PlayerState["status"], isBot = false): PlayerState {
  return { username, connected: true, guesses: [], status, isBot, points: 0, pointsSpent: 0 };
}

describe("outpacedLosers", () => {
  it("returns every still-playing non-winner (human + bot), excludes the winner and the already-out", () => {
    const players = [
      player("yan", "won"),
      player("alex", "playing"),
      player("maya", "playing", true),
      player("sam", "lost"),
    ];
    expect(outpacedLosers(players, "yan").sort()).toEqual(["alex", "maya"]);
  });

  it("is empty when nobody else is still playing", () => {
    expect(outpacedLosers([player("yan", "won"), player("alex", "lost")], "yan")).toEqual([]);
  });

  it("excludes the winner even when their status is still 'playing'", () => {
    const players = [player("yan", "playing"), player("alex", "playing")];
    expect(outpacedLosers(players, "yan")).toEqual(["alex"]);
  });
});
