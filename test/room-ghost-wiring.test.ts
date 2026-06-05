import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// House pattern (see room-core.test.ts "snapshot strips internal rematch fields"):
// no DO harness exists, so load-bearing room.ts wiring is locked by source assertions.
const src = readFileSync(new URL("../src/room.ts", import.meta.url), "utf8");

describe("seeded arena ghost wiring (spec 2026-06-05-arena-ghost-replay)", () => {
  it("seeded auto-start enters the countdown, not an instant runStart", () => {
    const block = src.slice(src.indexOf("FILL the remaining seats"), src.indexOf("Public human Arena room"));
    expect(block).toContain("beginCountdown");
    expect(block).not.toContain('runStart("arena")');
  });

  it("seeded rejections hand off to the share challenge instead of a bare room-full", () => {
    expect(src).toContain("sendArenaHandoffOrFull");
    expect(src).toContain('"arena_handoff"');
  });

  it("runStart mints the share challenge for seeded rooms", () => {
    expect(src).toContain("shareChallengeId = id");
    expect(src).toContain("share-challenge mint");
  });

  it("tape posts to the challenge DO at finish", () => {
    expect(src).toContain('"https://do/tape"');
  });

  it("tape lives on persisted state (hibernation recycles the instance mid-race) and is stripped outbound", () => {
    // Regression: a `private tape` class field dies between bot-turn alarms — the live
    // smoke on 2026-06-05 lost the whole tape that way. It must ride this.state.
    expect(src).not.toMatch(/private tape\b/);
    expect(src).toContain("this.state.tape");
    expect(src).toContain("tape: undefined,"); // snapshotFor strip, like `seed`
  });

  it("tape records masks via tapePush, never a word field", () => {
    // every tapePush callsite in room.ts must not pass the guess word
    const calls = src.split("tapePush(").slice(1).map((s) => s.slice(0, 200));
    expect(calls.length).toBeGreaterThanOrEqual(4); // human typing, bot typing, guess, finish
    for (const c of calls) expect(c).not.toMatch(/\bword\b/);
  });
});
