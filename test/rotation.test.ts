import { describe, it, expect } from "vitest";
import { nextSeatRole, applyKothRotation, MAX_DUELISTS } from "../src/rotation.ts";

describe("nextSeatRole", () => {
  it("seats the first two as duelists, then queues", () => {
    expect(nextSeatRole([])).toBe("duelist");
    expect(nextSeatRole([{ role: "duelist" }])).toBe("duelist");
    expect(nextSeatRole([{ role: "duelist" }, { role: "duelist" }])).toBe("queued");
  });
  it("counts duelist seats by role even if more queued exist", () => {
    expect(nextSeatRole([{ role: "duelist" }, { role: "queued" }])).toBe("duelist");
  });
  it("exposes a two-seat duel", () => {
    expect(MAX_DUELISTS).toBe(2);
  });
});

describe("applyKothRotation", () => {
  it("winner keeps the throne; loser goes to back of queue; front steps up", () => {
    const r = applyKothRotation({ duelists: ["king", "loser"], winner: "king", queue: ["next"], throne: { username: "king", streak: 1 } });
    expect(r.duelists).toEqual(["king", "next"]);
    expect(r.queue).toEqual(["loser"]);
    expect(r.throne).toEqual({ username: "king", streak: 2 });
  });
  it("a new winner takes the throne with streak 1", () => {
    const r = applyKothRotation({ duelists: ["king", "chal"], winner: "chal", queue: [], throne: { username: "king", streak: 3 } });
    expect(r.duelists).toEqual(["chal", "king"]); // empty queue → rematch, champ first
    expect(r.throne).toEqual({ username: "chal", streak: 1 });
  });
  it("empty queue → the same two rematch", () => {
    const r = applyKothRotation({ duelists: ["a", "b"], winner: "a", queue: [], throne: null });
    expect(r.duelists).toEqual(["a", "b"]);
    expect(r.queue).toEqual([]);
    expect(r.throne).toEqual({ username: "a", streak: 1 });
  });
  it("tie with a reigning king: king holds, challenger to back, front steps up", () => {
    const r = applyKothRotation({ duelists: ["king", "chal"], winner: null, queue: ["next"], throne: { username: "king", streak: 2 } });
    expect(r.duelists).toEqual(["king", "next"]);
    expect(r.queue).toEqual(["chal"]);
    expect(r.throne).toEqual({ username: "king", streak: 2 }); // unchanged on a tie
  });
  it("tie with no reigning king → rematch, no throne", () => {
    const r = applyKothRotation({ duelists: ["a", "b"], winner: null, queue: ["c"], throne: null });
    expect(r.duelists).toEqual(["a", "b"]);
    expect(r.queue).toEqual(["c"]);
    expect(r.throne).toBe(null);
  });
  it("fewer than two duelists (solo) is returned unchanged", () => {
    const r = applyKothRotation({ duelists: ["solo"], winner: "solo", queue: [], throne: null });
    expect(r.duelists).toEqual(["solo"]);
  });
});
