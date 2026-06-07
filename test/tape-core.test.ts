// test/tape-core.test.ts — upload validation: shape, kinds, monotonic t, byte cap.
import { describe, it, expect } from "vitest";
import { validateTapeEvents, TAPE_EVENT_CAP, TAPE_BYTE_CAP } from "../src/tape-core.ts";

const ok = [[0, "k", "S"], [120, "k", "T"], [300, "b"], [900, "e"], [1400, "r"], [1500, "c"],
  [3000, "p", "vowels"], [3200, "v", { raw: "oof", text: "oof", voice: { mode: "silent" } }]];

describe("validateTapeEvents", () => {
  it("accepts a well-formed tape", () => {
    expect(validateTapeEvents(ok)).toEqual(ok);
  });
  it("rejects non-arrays, empty tapes, and over-cap tapes", () => {
    expect(validateTapeEvents(null)).toBeNull();
    expect(validateTapeEvents([])).toBeNull();
    expect(validateTapeEvents(Array.from({ length: TAPE_EVENT_CAP + 1 }, (_, i) => [i, "b"]))).toBeNull();
  });
  it("rejects unknown kinds, bad timestamps, and non-monotonic t", () => {
    expect(validateTapeEvents([[0, "z"]])).toBeNull();          // unknown kind
    expect(validateTapeEvents([[-5, "b"]])).toBeNull();          // negative t
    expect(validateTapeEvents([["x", "b"]])).toBeNull();         // non-numeric t
    expect(validateTapeEvents([[100, "b"], [50, "b"]])).toBeNull(); // t went backwards
  });
  it("rejects a letter event that isn't a single A-Z character", () => {
    expect(validateTapeEvents([[0, "k", "SS"]])).toBeNull();
    expect(validateTapeEvents([[0, "k", 7]])).toBeNull();
  });
  it("rejects tapes over the byte cap", () => {
    const fat = [[0, "v", { raw: "x".repeat(TAPE_BYTE_CAP) }]];
    expect(validateTapeEvents(fat)).toBeNull();
  });
});
