// test/tape-replay-core.test.js — pure scheduler: real rhythm in, playable steps out.
// Gap > GAP_MS compresses to one fixed think beat; "e" resolves to commit/reject by
// lookahead; every step carries trueT so the driver's timer shows TRUE elapsed time.
import { describe, it, expect } from "vitest";
import { buildTapeSchedule, sanitizeVoiceLine, GAP_MS, THINK_MS } from "../public/tape-replay-core.js";

describe("buildTapeSchedule", () => {
  it("keeps real relative timing for small gaps", () => {
    const { steps } = buildTapeSchedule([[0, "k", "A"], [800, "k", "B"]]);
    expect(steps[0]).toMatchObject({ dt: 0, kind: "type", letter: "A", trueT: 0 });
    expect(steps[1]).toMatchObject({ dt: 800, kind: "type", letter: "B", trueT: 800 });
  });
  it("compresses a long think into one fixed beat that reports the true gap", () => {
    const { steps } = buildTapeSchedule([[0, "k", "A"], [60000, "k", "B"]]);
    expect(steps[1]).toMatchObject({ dt: 0, kind: "think", trueMs: 60000, fixed: true });
    expect(steps[1].dt + THINK_MS >= THINK_MS).toBe(true);
    // the step CARRYING the THINK_MS dt is fixed too — speed must not squeeze the beat
    expect(steps[2]).toMatchObject({ kind: "type", letter: "B", dt: THINK_MS, trueT: 60000, fixed: true });
  });
  it("resolves an accepted submit to a commit with the right row index", () => {
    const events = [[0, "k", "A"], [100, "e"], [200, "k", "B"], [300, "e"]];
    const { steps } = buildTapeSchedule(events);
    const commits = steps.filter((s) => s.kind === "commit");
    expect(commits.map((s) => s.row)).toEqual([0, 1]);
  });
  it("resolves a rejected submit: the e emits nothing, the r emits the shake", () => {
    const events = [[0, "k", "A"], [100, "e"], [400, "r"], [950, "c"], [1200, "k", "B"], [1300, "e"]];
    const { steps } = buildTapeSchedule(events);
    expect(steps.filter((s) => s.kind === "commit").map((s) => s.row)).toEqual([0]); // only the 2nd e commits
    expect(steps.some((s) => s.kind === "reject")).toBe(true);
    expect(steps.some((s) => s.kind === "clear")).toBe(true);
  });
  it("passes voice and power-up payloads through", () => {
    const line = { raw: "oof", text: "oof", voice: { mode: "silent" } };
    const { steps } = buildTapeSchedule([[0, "v", line], [10, "p", "vowels"]]);
    expect(steps[0]).toMatchObject({ kind: "voice", line });
    expect(steps[1]).toMatchObject({ kind: "power", what: "vowels" });
  });
  it("reports total playback ms and true elapsed ms separately", () => {
    const out = buildTapeSchedule([[0, "k", "A"], [60000, "k", "B"]]);
    expect(out.trueMs).toBe(60000);
    expect(out.totalMs).toBeLessThan(5000); // think compressed
  });
});

describe("sanitizeVoiceLine", () => {
  const good = { raw: "oof", text: "oof", voice: { mode: "silent" } };
  it("passes a good silent line through", () => {
    expect(sanitizeVoiceLine(good)).toMatchObject(good);
  });
  it("accepts a same-origin clips line and bounded ai prosody", () => {
    const clips = { ...good, voice: { mode: "clips", clipBase: "/voice/yang/" } };
    expect(sanitizeVoiceLine(clips)).toMatchObject(clips);
    const ai = { ...good, voice: { mode: "ai", rate: 1.2, pitch: 1 } };
    expect(sanitizeVoiceLine(ai)).toMatchObject(ai);
  });
  it("nulls a clips line with an off-origin / protocol-relative / traversal clipBase", () => {
    for (const clipBase of ["https://evil.example/", "//evil.example/", "/voice/../x/", "/\\evil.com/"]) {
      expect(sanitizeVoiceLine({ ...good, voice: { mode: "clips", clipBase } })).toBeNull();
    }
  });
  it("nulls non-string raw, missing voice, extra keys, and non-objects", () => {
    expect(sanitizeVoiceLine({ ...good, raw: 7 })).toBeNull();
    expect(sanitizeVoiceLine({ raw: "oof", text: "oof" })).toBeNull();
    expect(sanitizeVoiceLine({ ...good, lol: 1 })).toBeNull();
    expect(sanitizeVoiceLine("oof")).toBeNull();
    expect(sanitizeVoiceLine(null)).toBeNull();
  });
});
