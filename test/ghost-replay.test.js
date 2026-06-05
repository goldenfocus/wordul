import { describe, it, expect } from "vitest";
import { ghostPlayersAt, nextEventAfter, hostFinish } from "../public/ghost-replay.js";

const TAPE = {
  v: 1, wordLength: 5, maxGuesses: 6,
  players: [{ username: "paul", host: true }, { username: "maya", host: false }],
  events: [
    { t: 100, u: "paul", k: "typing", len: 1 },
    { t: 220, u: "paul", k: "typing", len: 2 },
    { t: 300, u: "paul", k: "typing", len: 1 },                    // backspace
    { t: 900, u: "paul", k: "guess", mask: ["hot", "cold", "cold", "cold", "warm"], status: "playing" },
    { t: 1200, u: "maya", k: "typing", len: 3 },
    { t: 2000, u: "paul", k: "guess", mask: ["hot", "hot", "hot", "hot", "hot"], status: "won" },
    { t: 2000, u: "paul", k: "finish", status: "won", guesses: 2 },
    { t: 2000, u: "maya", k: "finish", status: "lost", guesses: 0 },
  ],
};

describe("ghostPlayersAt", () => {
  it("starts everyone pristine before the first event", () => {
    const [paul, maya] = ghostPlayersAt(TAPE, 0);
    expect(paul.guesses).toEqual([]);
    expect(paul.typingLen).toBe(0);
    expect(paul.status).toBe("playing");
    expect(paul.ghost).toBe(true);
    expect(paul.ghostHost).toBe(true);
    expect(maya.ghostHost).toBe(false);
  });

  it("replays typing including the backspace", () => {
    expect(ghostPlayersAt(TAPE, 250)[0].typingLen).toBe(2);
    expect(ghostPlayersAt(TAPE, 350)[0].typingLen).toBe(1); // backspace landed
  });

  it("a guess commit clears typing and lands a mask-only row", () => {
    const paul = ghostPlayersAt(TAPE, 1000)[0];
    expect(paul.guesses.length).toBe(1);
    expect(paul.guesses[0].word).toBe("");           // letters never in a tape
    expect(paul.guesses[0].mask[0]).toBe("hot");
    expect(paul.typingLen).toBe(0);
  });

  it("finish stamps land statuses", () => {
    const [paul, maya] = ghostPlayersAt(TAPE, 9999);
    expect(paul.status).toBe("won");
    expect(maya.status).toBe("lost");
  });
});

describe("nextEventAfter", () => {
  it("walks the schedule and exhausts", () => {
    expect(nextEventAfter(TAPE, 0)).toBe(100);
    expect(nextEventAfter(TAPE, 100)).toBe(220);
    expect(nextEventAfter(TAPE, 2000)).toBe(null);
  });
});

describe("hostFinish", () => {
  it("finds the host's result to beat", () => {
    expect(hostFinish(TAPE)).toEqual({ username: "paul", t: 2000, status: "won", guesses: 2 });
  });
  it("null when the host never finished (eviction-truncated tape)", () => {
    expect(hostFinish({ ...TAPE, events: TAPE.events.slice(0, 4) })).toBe(null);
  });
});
