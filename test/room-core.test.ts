import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { outpacedLosers } from "../src/room-core.ts";
import type { PlayerState } from "../src/types.ts";
import { rematchReduce, botAccepts, nextAlarmAt, REMATCH_TIMEOUT_MS, botDelay, dueBots, nextBotAlarmAt, hasConnectedHuman, guessesFor, clampRows, MIN_ROWS, MAX_ROWS } from "../src/room-core.ts";

function player(username: string, status: PlayerState["status"], isBot = false): PlayerState {
  return { username, connected: true, guesses: [], status, isBot, points: 0, pointsSpent: 0 };
}

describe("hasConnectedHuman (abandon-close gate)", () => {
  it("true when a non-bot player is connected", () => {
    expect(hasConnectedHuman([player("yan", "playing")])).toBe(true);
  });
  it("false when the only human disconnected (host left/refreshed)", () => {
    expect(hasConnectedHuman([{ ...player("yan", "playing"), connected: false }])).toBe(false);
  });
  it("ignores connected bots — a bot-only room reads as human-empty", () => {
    expect(hasConnectedHuman([player("maya", "playing", true)])).toBe(false);
  });
  it("true if any human is still connected alongside bots", () => {
    expect(hasConnectedHuman([
      player("maya", "playing", true),
      { ...player("yan", "playing"), connected: false },
      player("alex", "playing"),
    ])).toBe(true);
  });
  it("false for an empty room", () => {
    expect(hasConnectedHuman([])).toBe(false);
  });
});

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

  it("propose in a solo room (no opponent) ⇒ accepted + start immediately, no waiting", () => {
    // Solo: there is no second party to handshake with, so a "Play again" must just
    // restart the game — never arm a timeout or show "Waiting for your opponent".
    const r = rematchReduce(null, { kind: "propose", from: "yan", opponentIsBot: false, solo: true, now: NOW });
    expect(r.rematch).toBe(null);
    expect(r.effects).toEqual([{ kind: "accepted", by: "yan" }, { kind: "start" }]);
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

describe("board dimensions (letters × rows)", () => {
  it("guessesFor is the smart default: length+1, plateauing at MAX_ROWS — set_length resets rows here", () => {
    expect(guessesFor(4)).toBe(5);
    expect(guessesFor(5)).toBe(6);
    expect(guessesFor(7)).toBe(8);
    expect(guessesFor(11)).toBe(MAX_ROWS); // plateau, not 12
  });

  it("clampRows keeps an in-range override (set_rows within [MIN,MAX])", () => {
    expect(clampRows(3)).toBe(3);
    expect(clampRows(6)).toBe(6);
    expect(clampRows(8)).toBe(8);
  });

  it("clampRows clamps out-of-range and rounds non-integers", () => {
    expect(clampRows(2)).toBe(MIN_ROWS);
    expect(clampRows(99)).toBe(MAX_ROWS);
    expect(clampRows(5.7)).toBe(6);
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

describe("snapshot strips internal rematch fields (matrix #11)", () => {
  it("snapshotFor sets rematch/botRematchAt/rematchTimeoutAt to undefined outbound", () => {
    const src = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
    for (const field of ["rematch: undefined", "botRematchAt: undefined", "rematchTimeoutAt: undefined"]) {
      expect(src).toContain(field);
    }
  });
});

describe("set_rows handler wiring (room.ts)", () => {
  const src = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");
  it("is dispatched in the message switch", () => {
    expect(src).toContain('case "set_rows":');
    expect(src).toContain("this.onSetRows(ws, msg.rows)");
  });
  it("onSetRows clamps to [MIN,MAX] via clampRows and writes maxGuesses", () => {
    expect(src).toContain("private async onSetRows(");
    expect(src).toContain("const clamped = clampRows(rows);");
    expect(src).toContain("this.state.maxGuesses = clamped;");
  });
  it("set_length still resets maxGuesses to the smart default", () => {
    expect(src).toContain("this.state.maxGuesses = guessesFor(length);");
  });
});

function bot(over: Partial<PlayerState> = {}): PlayerState {
  return { username: "maya", connected: true, guesses: [], status: "playing", isBot: true, scienceOptOut: true, points: 0, pointsSpent: 0, ...over };
}

describe("botDelay", () => {
  it("seeded opener is 10–20s; subsequent is 7–17s", () => {
    for (const roll of [0, 0.5, 0.999]) {
      const open = botDelay(true, true, roll);
      expect(open).toBeGreaterThanOrEqual(10_000);
      expect(open).toBeLessThanOrEqual(20_000);
      const next = botDelay(false, true, roll);
      expect(next).toBeGreaterThanOrEqual(7_000);
      expect(next).toBeLessThanOrEqual(17_000);
    }
  });

  it("robot (/robots) opener is 6–12s; subsequent is 4–10s", () => {
    for (const roll of [0, 0.5, 0.999]) {
      const open = botDelay(true, false, roll);
      expect(open).toBeGreaterThanOrEqual(6_000);
      expect(open).toBeLessThanOrEqual(12_000);
      const next = botDelay(false, false, roll);
      expect(next).toBeGreaterThanOrEqual(4_000);
      expect(next).toBeLessThanOrEqual(10_000);
    }
  });
});

describe("dueBots", () => {
  it("returns only playing bots whose nextGuessAt has passed", () => {
    const players = [
      bot({ username: "a", nextGuessAt: 100 }),               // due
      bot({ username: "b", nextGuessAt: 5000 }),              // not yet
      bot({ username: "c", nextGuessAt: 50, status: "won" }), // done
      bot({ username: "h", isBot: false, nextGuessAt: 0 }),   // human
      bot({ username: "d", nextGuessAt: undefined }),         // unset → due (>= now via ?? 0)
    ];
    const due = dueBots(players, 1000).map((p) => p.username);
    expect(due).toEqual(["a", "d"]);
  });
});

describe("nextBotAlarmAt", () => {
  it("is the soonest nextGuessAt across still-playing bots", () => {
    const players = [
      bot({ username: "a", nextGuessAt: 9000 }),
      bot({ username: "b", nextGuessAt: 3000 }),
      bot({ username: "c", nextGuessAt: 1000, status: "lost" }), // excluded
    ];
    expect(nextBotAlarmAt(players)).toBe(3000);
  });

  it("is null when no bot is still playing", () => {
    expect(nextBotAlarmAt([bot({ status: "won" }), bot({ isBot: false })])).toBeNull();
  });
});
