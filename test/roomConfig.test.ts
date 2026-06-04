import { describe, it, expect } from "vitest";
import { pickGuessEvent, mergeConfig, CONFIG_CAPS } from "/roomConfig.js";

describe("pickGuessEvent — never-silent priority resolver", () => {
  it("greens>=2 fires greens with the real count", () => {
    expect(pickGuessEvent(2, 0, false)).toEqual({ event: "greens", ctx: { count: 2 } });
    expect(pickGuessEvent(5, 1, false)).toEqual({ event: "greens", ctx: { count: 5 } });
  });
  it("one green OR any yellow (and <2 greens) fires progress", () => {
    expect(pickGuessEvent(1, 0, false)).toEqual({ event: "progress", ctx: {} });
    expect(pickGuessEvent(0, 1, false)).toEqual({ event: "progress", ctx: {} });
    expect(pickGuessEvent(1, 3, false)).toEqual({ event: "progress", ctx: {} });
  });
  it("a clean nothing-found guess fires wrong, carrying the sloppy flag", () => {
    expect(pickGuessEvent(0, 0, true)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: true } });
    expect(pickGuessEvent(0, 0, false)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: false } });
  });
  it("priority override lets scolding win over a green burst", () => {
    const voice = { priority: ["wrong", "greens", "progress"] };
    expect(pickGuessEvent(3, 0, false, voice)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: false } });
  });
  it("a disabled event is skipped as a priority slot", () => {
    const voice = { events: { progress: false } };
    expect(pickGuessEvent(0, 1, false, voice)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: false } });
  });
  it("never silent: even with every guess event muted, wrong is the terminal fallback", () => {
    const voice = { events: { greens: false, progress: false, wrong: false } };
    expect(pickGuessEvent(5, 5, true, voice)).toEqual({ event: "wrong", ctx: { reusedDeadLetter: true } });
  });
});

// A representative voice override config used as the merge base in several tests.
const yangVoice = {
  voice: {
    talkativeness: 0.33,
    events: { greens: true },
    priority: ["greens", "progress", "wrong"],
    react: {
      voiceBudget: { routine: 0.33, progress: 1 },
      win: { genius: { maxGuesses: 2 }, clutch: { minGuesses: 6 } },
      greens: { thresholds: [2, 3, 4, 5] },
      mistake: { sloppy: { repeatedKnownGray: true } },
    },
    lines: { wrong: { normal: ["a", "b"], sloppy: ["s"] }, progress: ["p1"] },
  },
};

describe("mergeConfig — the override merge contract", () => {
  it("default-preserving: merging with an empty override returns the base unchanged", () => {
    expect(mergeConfig(yangVoice, {})).toEqual(yangVoice);
  });
  it("sections fall through independently", () => {
    const out = mergeConfig({ voice: { talkativeness: 1 } }, { palette: {} });
    expect(out.voice).toEqual({ talkativeness: 1 });
    expect(out.palette).toEqual({});
  });
  it("voice keys shallow-replace; absent keys fall through", () => {
    const out = mergeConfig({ voice: { talkativeness: 0.33, events: { greens: true } } },
                            { voice: { talkativeness: 1 } });
    expect(out.voice.talkativeness).toBe(1);
    expect(out.voice.events).toEqual({ greens: true });
  });
  it("react deep-merges by sub-key (override one tier, keep the rest)", () => {
    const out = mergeConfig(yangVoice, { voice: { react: { win: { genius: { maxGuesses: 1 } } } } });
    expect(out.voice.react.win.genius.maxGuesses).toBe(1);
    expect(out.voice.react.greens.thresholds).toEqual([2, 3, 4, 5]);
    expect(out.voice.react.voiceBudget.routine).toBe(0.33);
  });
  it("voiceBudget deep-merges (override progress, keep routine)", () => {
    const out = mergeConfig(yangVoice, { voice: { react: { voiceBudget: { progress: 0.5 } } } });
    expect(out.voice.react.voiceBudget).toEqual({ routine: 0.33, progress: 0.5 });
  });
  it("events shallow-merge key-by-key; priority replaces wholesale", () => {
    const out = mergeConfig({ voice: { events: { greens: true, wrong: true }, priority: ["greens"] } },
                            { voice: { events: { progress: false }, priority: ["wrong"] } });
    expect(out.voice.events).toEqual({ greens: true, wrong: true, progress: false });
    expect(out.voice.priority).toEqual(["wrong"]);
  });
  it("line banks APPEND by default", () => {
    const out = mergeConfig({ voice: { lines: { wrong: { normal: ["A"] } } } },
                            { voice: { lines: { wrong: { normal: ["B"] } } } });
    expect(out.voice.lines.wrong.normal).toEqual(["A", "B"]);
  });
  it("a {replace} wrapper discards the base bank", () => {
    const out = mergeConfig({ voice: { lines: { wrong: { normal: ["A"] } } } },
                            { voice: { lines: { wrong: { normal: { replace: ["B"] } } } } });
    expect(out.voice.lines.wrong.normal).toEqual(["B"]);
  });
  it("a flat bank appends too", () => {
    const out = mergeConfig({ voice: { lines: { progress: ["A"] } } },
                            { voice: { lines: { progress: ["B", "C"] } } });
    expect(out.voice.lines.progress).toEqual(["A", "B", "C"]);
  });
  it("a merged bank is truncated to CONFIG_CAPS.bankMax", () => {
    const base = Array.from({ length: 20 }, (_, i) => `a${i}`);
    const over = Array.from({ length: 10 }, (_, i) => `b${i}`);
    const out = mergeConfig({ voice: { lines: { progress: base } } },
                            { voice: { lines: { progress: over } } });
    expect(out.voice.lines.progress.length).toBe(CONFIG_CAPS.bankMax);
    expect(out.voice.lines.progress[0]).toBe("a0");
  });
  it("preset provenance: the last non-empty layer wins", () => {
    expect(mergeConfig({ preset: "quiet" }, { preset: "gremlin" }).preset).toBe("gremlin");
  });
});
