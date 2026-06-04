import { describe, it, expect } from "vitest";
import { everyoneReady, COUNTDOWN_MS } from "../src/duel.ts";

type P = { connected: boolean; ready: boolean };
const p = (connected: boolean, ready: boolean): P => ({ connected, ready });

describe("everyoneReady", () => {
  it("is false with no players", () => {
    expect(everyoneReady([])).toBe(false);
  });

  it("is false when no connected players are present", () => {
    expect(everyoneReady([p(false, true)])).toBe(false);
  });

  it("is true for a single connected, ready player (solo)", () => {
    expect(everyoneReady([p(true, true)])).toBe(true);
  });

  it("is false when a connected player is not ready", () => {
    expect(everyoneReady([p(true, true), p(true, false)])).toBe(false);
  });

  it("is true when all connected players are ready (ignores disconnected)", () => {
    expect(everyoneReady([p(true, true), p(true, true), p(false, false)])).toBe(true);
  });

  it("exposes a 3-second countdown", () => {
    expect(COUNTDOWN_MS).toBe(3000);
  });
});
