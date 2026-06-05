import { describe, it, expect } from "vitest";
import { triesFor, seatModel, compactRowProps } from "../public/lobby-view.js";

describe("triesFor (mirrors server guessesFor)", () => {
  it("is length+1, plateauing at 8", () => {
    expect(triesFor(4)).toBe(5);
    expect(triesFor(5)).toBe(6);
    expect(triesFor(7)).toBe(8);
    expect(triesFor(8)).toBe(8);   // plateau
    expect(triesFor(11)).toBe(8);  // plateau holds
  });
});

describe("seatModel (Your table)", () => {
  it("marks seat 0 as you, fills joined players, pads empties to capacity", () => {
    const m = seatModel({ players: [{ username: "papa" }, { username: "kai", isBot: false }], capacity: 3 }, "papa");
    expect(m.taken).toBe(2);
    expect(m.capacity).toBe(3);
    expect(m.seats.map((s) => s.kind)).toEqual(["you", "taken", "empty"]);
  });
  it("falls back to players.length capacity when capacity missing, min 2", () => {
    const m = seatModel({ players: [{ username: "papa" }] }, "papa");
    expect(m.capacity).toBeGreaterThanOrEqual(2);
    expect(m.taken).toBe(1);
  });
});

describe("compactRowProps (floor row)", () => {
  it("derives ×T tries from wordLength", () => {
    const p = compactRowProps({ routePath: "/@a/x", personaIcon: "🦊", host: "maya", wordLength: 8, seats: "4/5", edition: "jackpot" });
    expect(p.tries).toBe(8);
    expect(p.host).toBe("maya");
    expect(p.seats).toBe("4/5");
  });
});
