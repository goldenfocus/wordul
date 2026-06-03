import { describe, it, expect } from "vitest";
import { outpacedLosers } from "../src/room-core.ts";
import type { PlayerState } from "../src/types.ts";
import { rematchReduce, botAccepts, nextAlarmAt, REMATCH_TIMEOUT_MS } from "../src/room-core.ts";

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

describe("rematchReduce", () => {
  const NOW = 1_000_000;

  it("propose (none pending, human opponent): sets state, emits proposed + schedule_timeout", () => {
    const r = rematchReduce(null, { kind: "propose", from: "yan", opponentIsBot: false, now: NOW });
    expect(r.rematch).toEqual({ proposer: "yan", deadline: NOW + REMATCH_TIMEOUT_MS });
    expect(r.effects).toEqual([{ kind: "proposed", proposer: "yan" }, { kind: "schedule_timeout" }]);
  });

  it("propose against a bot also schedules the bot decision", () => {
    const r = rematchReduce(null, { kind: "propose", from: "yan", opponentIsBot: true, now: NOW });
    expect(r.effects).toContainEqual({ kind: "schedule_bot" });
  });

  it("mutual propose (other side already pending) ⇒ accept + start, once", () => {
    const r = rematchReduce({ proposer: "alex", deadline: NOW }, { kind: "propose", from: "yan", opponentIsBot: false, now: NOW });
    expect(r.rematch).toBe(null);
    expect(r.effects).toEqual([{ kind: "accepted", by: "yan" }, { kind: "start" }]);
  });

  it("re-propose by the same proposer is a no-op", () => {
    const state = { proposer: "yan", deadline: NOW };
    const r = rematchReduce(state, { kind: "propose", from: "yan", opponentIsBot: false, now: NOW });
    expect(r.rematch).toBe(state);
    expect(r.effects).toEqual([]);
  });

  it("accept by the non-proposer ⇒ accepted + start", () => {
    const r = rematchReduce({ proposer: "alex", deadline: NOW }, { kind: "accept", from: "yan" });
    expect(r.rematch).toBe(null);
    expect(r.effects).toEqual([{ kind: "accepted", by: "yan" }, { kind: "start" }]);
  });

  it("accept by the proposer themselves is ignored", () => {
    const state = { proposer: "yan", deadline: NOW };
    expect(rematchReduce(state, { kind: "accept", from: "yan" }).effects).toEqual([]);
  });

  it("decline ⇒ cancelled{declined}", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "decline" });
    expect(r.rematch).toBe(null);
    expect(r.effects).toEqual([{ kind: "cancelled", reason: "declined" }]);
  });

  it("timeout ⇒ cancelled{timeout}", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "timeout" });
    expect(r.effects).toEqual([{ kind: "cancelled", reason: "timeout" }]);
  });

  it("left ⇒ cancelled{left}", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "left" });
    expect(r.effects).toEqual([{ kind: "cancelled", reason: "left" }]);
  });

  it("bot_decision accept ⇒ accepted{by:bot} + start", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "bot_decision", accept: true, bot: "maya" });
    expect(r.rematch).toBe(null);
    expect(r.effects).toEqual([{ kind: "accepted", by: "maya" }, { kind: "start" }]);
  });

  it("bot_decision decline ⇒ cancelled{declined} + bot_leaves", () => {
    const r = rematchReduce({ proposer: "yan", deadline: NOW }, { kind: "bot_decision", accept: false, bot: "maya" });
    expect(r.effects).toEqual([{ kind: "cancelled", reason: "declined" }, { kind: "bot_leaves" }]);
  });

  it("any input with no pending proposal is a safe no-op", () => {
    for (const input of [
      { kind: "accept", from: "x" }, { kind: "decline" },
      { kind: "timeout" }, { kind: "left" }, { kind: "bot_decision", accept: true, bot: "m" },
    ] as const) {
      expect(rematchReduce(null, input)).toEqual({ rematch: null, effects: [] });
    }
  });
});

describe("botAccepts", () => {
  it("accepts below the threshold, declines at/above it", () => {
    expect(botAccepts(0)).toBe(true);
    expect(botAccepts(0.79)).toBe(true);
    expect(botAccepts(0.8)).toBe(false);
    expect(botAccepts(0.99)).toBe(false);
  });
});

describe("nextAlarmAt", () => {
  it("returns the earliest non-null deadline, or null when none", () => {
    expect(nextAlarmAt([null, 500, undefined, 200])).toBe(200);
    expect(nextAlarmAt([null, undefined])).toBe(null);
    expect(nextAlarmAt([])).toBe(null);
  });
});
