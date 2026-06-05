import { describe, it, expect } from "vitest";
import { detectCues } from "/drama.js";

const G = "hot", Y = "warm", X = "cold";
const row = (mask) => ({ mask });
const P = (username, status, masks) => ({ username, status, guesses: masks.map(row) });
const CTX = { me: "yan", maxGuesses: 6, phase: "playing", isDaily: false };
const ME = P("yan", "playing", [[X, X, X, X, X]]);

describe("detectCues — gates", () => {
  it("silent with no prev snapshot (first snapshot / reconnect)", () => {
    expect(detectCues(null, [ME, P("bot", "playing", [[G, X, X, X, X]])], CTX))
      .toEqual({ cues: [], dangerLevel: 0 });
  });
  it("silent in the daily", () => {
    const r = detectCues([ME], [ME, P("bot", "playing", [[G, X, X, X, X]])], { ...CTX, isDaily: true });
    expect(r).toEqual({ cues: [], dangerLevel: 0 });
  });
  it("silent when the round is over", () => {
    const prev = [ME, P("bot", "playing", [[G, X, X, X, X]])];
    const next = [ME, P("bot", "won", [[G, X, X, X, X], [G, G, G, G, G]])];
    expect(detectCues(prev, next, { ...CTX, phase: "finished" })).toEqual({ cues: [], dangerLevel: 0 });
  });
  it("silent once I'm not playing (lost/won/spectating)", () => {
    const meLost = P("yan", "lost", [[X, X, X, X, X]]);
    const prev = [meLost, P("bot", "playing", [])];
    const next = [meLost, P("bot", "playing", [[G, G, X, X, X]])];
    expect(detectCues(prev, next, CTX)).toEqual({ cues: [], dangerLevel: 0 });
  });
  it("my own rows never produce cues", () => {
    const prev = [P("yan", "playing", [])];
    const next = [P("yan", "playing", [[G, G, G, X, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([]);
  });
});

describe("detectCues — progress stings", () => {
  it("new hot letters in an opponent's fresh row → hot cue with count", () => {
    const prev = [ME, P("bot", "playing", [[G, X, X, X, X]])];
    const next = [ME, P("bot", "playing", [[G, X, X, X, X], [G, G, X, G, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "hot", count: 2 }]);
  });
  it("re-confirmed hot columns are not news", () => {
    const prev = [ME, P("bot", "playing", [[G, G, X, X, X]])];
    const next = [ME, P("bot", "playing", [[G, G, X, X, X], [G, G, X, X, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([]);
  });
  it("warm-only progress → warm cue", () => {
    const prev = [ME, P("bot", "playing", [])];
    const next = [ME, P("bot", "playing", [[Y, X, X, Y, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "warm" }]);
  });
  it("no new row → no sting (snapshot for unrelated reasons)", () => {
    const prev = [ME, P("bot", "playing", [[G, X, X, X, X]])];
    const next = [ME, P("bot", "playing", [[G, X, X, X, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([]);
  });
  it("an opponent who joined mid-round produces no cues yet", () => {
    const prev = [ME];
    const next = [ME, P("newbot", "playing", [[G, G, G, X, X]])];
    expect(detectCues(prev, next, CTX).cues).toEqual([]);
  });
});

describe("detectCues — danger layer", () => {
  const rows = (n) => Array.from({ length: n }, () => [X, X, X, X, X]);
  it("level 0 below maxGuesses-2", () => {
    const bot = P("bot", "playing", rows(3));
    expect(detectCues([ME, bot], [ME, bot], CTX).dangerLevel).toBe(0);
  });
  it("level 1 at maxGuesses-2 committed rows", () => {
    const bot = P("bot", "playing", rows(4));
    expect(detectCues([ME, bot], [ME, bot], CTX).dangerLevel).toBe(1);
  });
  it("level 2 on the final row", () => {
    const bot = P("bot", "playing", rows(5));
    expect(detectCues([ME, bot], [ME, bot], CTX).dangerLevel).toBe(2);
  });
  it("multi-opponent: deepest still-playing opponent wins", () => {
    const a = P("a", "playing", rows(5));
    const b = P("b", "playing", rows(2));
    expect(detectCues([ME, a, b], [ME, a, b], CTX).dangerLevel).toBe(2);
  });
  it("a lost opponent stops driving the layer", () => {
    const deadDeep = P("a", "lost", rows(6));
    expect(detectCues([ME, deadDeep], [ME, deadDeep], CTX).dangerLevel).toBe(0);
  });
});

describe("detectCues — busts", () => {
  const rows = (n) => Array.from({ length: n }, () => [X, X, X, X, X]);
  it("opponent playing→lost while I'm alive → bust cue, deep when they were row-4+", () => {
    const prev = [ME, P("bot", "playing", rows(5))];
    const next = [ME, P("bot", "lost", rows(6))];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "bust", deep: true }]);
  });
  it("shallow bust (early give-up) → bust cue, deep:false", () => {
    const prev = [ME, P("bot", "playing", rows(1))];
    const next = [ME, P("bot", "lost", rows(1))];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "bust", deep: false }]);
  });
  it("no bust cue when I went down in the same snapshot (opponent solved first)", () => {
    const prev = [P("yan", "playing", rows(2)), P("a", "playing", rows(3)), P("b", "playing", rows(4))];
    const next = [P("yan", "lost", rows(2)), P("a", "won", rows(4)), P("b", "lost", rows(4))];
    expect(detectCues(prev, next, CTX)).toEqual({ cues: [], dangerLevel: 0 });
  });
  it("malformed players (missing guesses) never throw", () => {
    const prev = [ME, { username: "bot", status: "playing" }];
    const next = [ME, { username: "bot", status: "lost" }];
    expect(detectCues(prev, next, CTX).cues).toEqual([{ kind: "bust", deep: false }]);
  });
});
