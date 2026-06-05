import { describe, it, expect } from "vitest";
import { planKeystrokes, timelineMs, SHARP_HAND, NOOB_HAND, type RhythmProfile } from "../src/rhythm.ts";

// deterministic PRNG (mulberry32) so timelines are reproducible across runs
function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("planKeystrokes", () => {
  it("is deterministic for a given seed", () => {
    expect(planKeystrokes("CRANE", NOOB_HAND, rngFrom(1))).toEqual(planKeystrokes("CRANE", NOOB_HAND, rngFrom(1)));
  });

  it("builds up to the full word, first beat is positive, time is non-decreasing", () => {
    const steps = planKeystrokes("CRANE", SHARP_HAND, rngFrom(2));
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].atMs).toBeGreaterThan(0);
    expect(steps[steps.length - 1].len).toBe(5);
    for (let i = 1; i < steps.length; i++) expect(steps[i].atMs).toBeGreaterThanOrEqual(steps[i - 1].atMs);
  });

  it("never types beyond the word and never below zero", () => {
    for (const s of planKeystrokes("HELLO", NOOB_HAND, rngFrom(3))) {
      expect(s.len).toBeGreaterThanOrEqual(0);
      expect(s.len).toBeLessThanOrEqual(5);
    }
  });

  it("with backspaceRate=1 produces at least one len dip", () => {
    const profile: RhythmProfile = { ...SHARP_HAND, backspaceRate: 1, clearRate: 0 };
    const steps = planKeystrokes("CRANE", profile, rngFrom(4));
    expect(steps.some((s, i) => i > 0 && s.len < steps[i - 1].len)).toBe(true);
  });

  it("with backspaceRate=0 and clearRate=0 is strictly monotonic to full length", () => {
    const profile: RhythmProfile = { ...SHARP_HAND, backspaceRate: 0, clearRate: 0 };
    const steps = planKeystrokes("CRANE", profile, rngFrom(5));
    for (let i = 1; i < steps.length; i++) expect(steps[i].len).toBe(steps[i - 1].len + 1);
    expect(steps.length).toBe(5);
  });

  it("with clearRate=1 drops to zero after progress, then rebuilds to full", () => {
    const profile: RhythmProfile = { ...NOOB_HAND, clearRate: 1, backspaceRate: 0 };
    const steps = planKeystrokes("CRANE", profile, rngFrom(6));
    expect(steps.findIndex((s, i) => i > 0 && s.len === 0)).toBeGreaterThan(0);
    expect(steps[steps.length - 1].len).toBe(5);
  });
});

describe("timelineMs", () => {
  it("is 0 for an empty timeline and the last atMs otherwise", () => {
    expect(timelineMs([])).toBe(0);
    expect(timelineMs([{ atMs: 10, len: 1 }, { atMs: 42, len: 2 }])).toBe(42);
  });
});

describe("presets", () => {
  it("SHARP_HAND is faster and cleaner than NOOB_HAND across every knob", () => {
    expect(SHARP_HAND.firstKeyMs).toBeLessThan(NOOB_HAND.firstKeyMs);
    expect(SHARP_HAND.readPauseMs).toBeLessThan(NOOB_HAND.readPauseMs);
    expect(SHARP_HAND.keyMeanMs).toBeLessThan(NOOB_HAND.keyMeanMs);
    expect(SHARP_HAND.keyJitter).toBeLessThan(NOOB_HAND.keyJitter);
    expect(SHARP_HAND.hesitateRate).toBeLessThan(NOOB_HAND.hesitateRate);
    expect(SHARP_HAND.backspaceRate).toBeLessThan(NOOB_HAND.backspaceRate);
    expect(SHARP_HAND.clearRate).toBeLessThanOrEqual(NOOB_HAND.clearRate);
  });

  it("SHARP_HAND types a word faster than NOOB_HAND on average", () => {
    let sharp = 0, noob = 0;
    for (let s = 0; s < 200; s++) {
      sharp += timelineMs(planKeystrokes("CRANE", SHARP_HAND, rngFrom(s)));
      noob += timelineMs(planKeystrokes("CRANE", NOOB_HAND, rngFrom(s)));
    }
    expect(sharp / 200).toBeLessThan(noob / 200);
  });
});

describe("human variety (not a fixed cadence)", () => {
  it("with hesitateRate=1 inserts a mid-word pause far longer than a normal keystroke", () => {
    const profile: RhythmProfile = { ...SHARP_HAND, hesitateRate: 1, backspaceRate: 0, clearRate: 0 };
    const steps = planKeystrokes("CRANE", profile, rngFrom(7));
    let maxGap = 0;
    for (let i = 1; i < steps.length; i++) maxGap = Math.max(maxGap, steps[i].atMs - steps[i - 1].atMs);
    expect(maxGap).toBeGreaterThan(profile.keyMeanMs * 2); // a real "thinking" pause, not a uniform beat
  });

  it("produces a different timeline almost every game (no single fixed rhythm)", () => {
    const sigs = new Set<string>();
    for (let s = 0; s < 20; s++) {
      const steps = planKeystrokes("CRANE", NOOB_HAND, rngFrom(s));
      sigs.add(steps.map((x) => `${x.atMs}:${x.len}`).join(","));
    }
    expect(sigs.size).toBeGreaterThan(15); // overwhelmingly unique — the "always the same speed" tell is gone
  });
});
