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
    // per-event payloads are individually valid; only the serialized size trips
    const fat = Array.from({ length: 4000 }, (_, i) => [i, "p", "x".repeat(60)]);
    expect(validateTapeEvents(fat)).toBeNull();
  });
});

describe("validateTapeEvents — v/p payloads", () => {
  const v = (data: unknown) => validateTapeEvents([[0, "v", data]]);
  const line = (voice: unknown) => ({ raw: "oof", text: "oof", voice });
  it("accepts silent, ai, and same-origin clips voice lines", () => {
    expect(v(line({ mode: "silent" }))).not.toBeNull();
    expect(v(line({ mode: "ai", voiceName: "Zira", rate: 1.1, pitch: 0.9 }))).not.toBeNull();
    expect(v(line({ mode: "clips", clipBase: "/voice/yang/" }))).not.toBeNull();
  });
  it("rejects off-origin, protocol-relative, and traversal clipBase", () => {
    expect(v(line({ mode: "clips", clipBase: "https://evil.example/" }))).toBeNull();
    expect(v(line({ mode: "clips", clipBase: "//evil.example/" }))).toBeNull();
    expect(v(line({ mode: "clips", clipBase: "/voice/../x/" }))).toBeNull();
    expect(v(line({ mode: "clips", clipBase: "/\\evil.com/" }))).toBeNull();
  });
  it("rejects non-string raw, missing voice, and unknown modes", () => {
    expect(v({ raw: 7, text: "oof", voice: { mode: "silent" } })).toBeNull();
    expect(v({ raw: "oof", text: "oof" })).toBeNull();
    expect(v(line({ mode: "loud" }))).toBeNull();
  });
  it("rejects extra keys on the v data and out-of-range ai prosody", () => {
    expect(v({ ...line({ mode: "silent" }), lol: 1 })).toBeNull();
    expect(v(line({ mode: "ai", rate: 99 }))).toBeNull();
    expect(v(line({ mode: "ai", pitch: -1 }))).toBeNull();
  });
  it("rejects p events with non-string or oversized data", () => {
    expect(validateTapeEvents([[0, "p", 7]])).toBeNull();
    expect(validateTapeEvents([[0, "p", "x".repeat(65)]])).toBeNull();
    expect(validateTapeEvents([[0, "p", "vowels"]])).not.toBeNull();
  });
});
