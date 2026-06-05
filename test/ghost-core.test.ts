import { describe, it, expect } from "vitest";
import { newTape, tapePush, TAPE_EVENT_CAP, type GhostTape } from "../src/ghost-core.ts";

const mkTape = (): GhostTape =>
  newTape(5, 6, [{ username: "paul", host: true }, { username: "maya", host: false }]);

describe("newTape", () => {
  it("stamps shape + roster and starts empty", () => {
    const t = mkTape();
    expect(t.v).toBe(1);
    expect(t.wordLength).toBe(5);
    expect(t.maxGuesses).toBe(6);
    expect(t.players).toEqual([{ username: "paul", host: true }, { username: "maya", host: false }]);
    expect(t.events).toEqual([]);
  });
});

describe("tapePush", () => {
  it("appends in order", () => {
    const t = mkTape();
    tapePush(t, { t: 100, u: "paul", k: "typing", len: 1 });
    tapePush(t, { t: 250, u: "paul", k: "typing", len: 2 });
    expect(t.events.map((e) => e.t)).toEqual([100, 250]);
  });

  it("clamps a backwards clock to stay monotonic", () => {
    const t = mkTape();
    tapePush(t, { t: 500, u: "paul", k: "typing", len: 1 });
    tapePush(t, { t: 400, u: "maya", k: "typing", len: 1 }); // skewed
    expect(t.events[1].t).toBe(500);
  });

  it("drops events past the cap", () => {
    const t = mkTape();
    for (let i = 0; i < TAPE_EVENT_CAP + 10; i++) tapePush(t, { t: i, u: "paul", k: "typing", len: 1 });
    expect(t.events.length).toBe(TAPE_EVENT_CAP);
  });

  it("a guess event carries masks only — letters can never enter a tape", () => {
    const t = mkTape();
    tapePush(t, { t: 900, u: "paul", k: "guess", mask: ["hot", "warm", "cold", "cold", "cold"], status: "playing" });
    tapePush(t, { t: 1500, u: "paul", k: "finish", status: "won", guesses: 3 });
    const json = JSON.stringify(t);
    expect(json).not.toMatch(/"word":/);  // no `word` key anywhere in a tape (wordLength is fine)
    expect(json).not.toContain("CRANE");  // sanity: no letter payloads
  });
});
