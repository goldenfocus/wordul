import { describe, it, expect } from "vitest";
import {
  reflowDims, randomHarmony, classifyWord, serializeDraft, restoreDraft,
  previewCols, DEFAULT_AI_PROMPT,
} from "/vibe-studio-core.js";

describe("reflowDims", () => {
  it("passes through in-range integers", () => {
    expect(reflowDims(5, 6)).toEqual({ len: 5, rows: 6 });
  });
  it("clamps len to 4..12 and rows to 3..10", () => {
    expect(reflowDims(2, 1)).toEqual({ len: 4, rows: 3 });
    expect(reflowDims(99, 99)).toEqual({ len: 12, rows: 10 });
  });
  it("floors non-integers and defaults NaN to the minimums", () => {
    expect(reflowDims(5.9, 6.9)).toEqual({ len: 5, rows: 6 });
    expect(reflowDims(NaN, NaN)).toEqual({ len: 4, rows: 3 });
  });
});

describe("randomHarmony", () => {
  const HEX = /^#[0-9a-f]{6}$/;
  it("returns three valid lowercase hex colours", () => {
    const cs = randomHarmony(200);
    expect(cs.a1).toMatch(HEX);
    expect(cs.a2).toMatch(HEX);
    expect(cs.a3).toMatch(HEX);
  });
  it("is deterministic for a given seed hue", () => {
    expect(randomHarmony(120)).toEqual(randomHarmony(120));
  });
  it("produces three distinct colours", () => {
    const { a1, a2, a3 } = randomHarmony(40);
    expect(new Set([a1, a2, a3]).size).toBe(3);
  });
  it("wraps hue into 0..359 so out-of-range seeds still work", () => {
    expect(randomHarmony(380)).toEqual(randomHarmony(20));
  });
});

describe("classifyWord", () => {
  const yes = async () => true;
  const no = async () => false;
  it("flags words shorter than 4 as tooShort without calling lookup", async () => {
    let called = false;
    const spy = async () => { called = true; return true; };
    expect(await classifyWord("CAT", spy)).toBe("tooShort");
    expect(called).toBe(false);
  });
  it("returns real when the lookup resolves true", async () => {
    expect(await classifyWord("EMBER", yes)).toBe("real");
  });
  it("returns invented when the lookup resolves false", async () => {
    expect(await classifyWord("ZQXVW", no)).toBe("invented");
  });
  it("treats a lookup error as invented (soft, never throws)", async () => {
    const boom = async () => { throw new Error("network"); };
    expect(await classifyWord("EMBER", boom)).toBe("invented");
  });
  it("empty/blank word is tooShort", async () => {
    expect(await classifyWord("", yes)).toBe("tooShort");
  });
});

describe("previewCols", () => {
  it("returns 5 for an empty word (board still reads as a board)", () => {
    expect(previewCols("")).toBe(5);
    expect(previewCols(null)).toBe(5);
  });
  it("follows the typed word length, growing letter-by-letter", () => {
    expect(previewCols("PE")).toBe(2);
    expect(previewCols("EMBER")).toBe(5);
  });
  it("caps at 12", () => {
    expect(previewCols("SUPERCALIFRAGILISTIC")).toBe(12);
  });
});

describe("draft round-trip", () => {
  const vibe = { vibeTitle: "Embers", word: "EMBER", rows: 6,
                 story: "the quiet heat after the fire", aiPrompt: "make it glow",
                 colorScheme: { a1: "#d98a3a", a2: "#3a7fd9", a3: "#7f3ad9" } };
  it("round-trips a full vibe", () => {
    expect(restoreDraft(serializeDraft(vibe))).toEqual(vibe);
  });
  it("returns defaults for null/garbage input (no len field anymore)", () => {
    const d = restoreDraft(null);
    expect(d.rows).toBe(6);
    expect(d.word).toBe("");
    expect(d.story).toBe("");
    expect(d.aiPrompt).toBe(DEFAULT_AI_PROMPT);
    expect(d).not.toHaveProperty("len");
    expect(d.colorScheme).toEqual({ a1: "#5ee27a", a2: "#f2c94c", a3: "#ff8a5c" });
    expect(restoreDraft("{not json")).toEqual(d);
  });
  it("fills missing fields and clamps rows from a partial draft", () => {
    const d = restoreDraft(JSON.stringify({ word: "sky", rows: 99 }));
    expect(d.word).toBe("SKY");
    expect(d.rows).toBe(10);
    expect(d.story).toBe("");
    expect(d.aiPrompt).toBe(DEFAULT_AI_PROMPT);
  });
  it("keeps a curator's edited aiPrompt but falls back when blank", () => {
    expect(restoreDraft(JSON.stringify({ aiPrompt: "" })).aiPrompt).toBe(DEFAULT_AI_PROMPT);
    expect(restoreDraft(JSON.stringify({ aiPrompt: "x" })).aiPrompt).toBe("x");
  });
});
