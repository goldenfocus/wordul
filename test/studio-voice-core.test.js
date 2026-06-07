import { describe, it, expect } from "vitest";
import { setOn, setSource, clearVoice, buildVoiceOverride } from "../public/studio-voice-core.js";

const base = [{ id: "yang" }, { id: "default" }]; // worlds (only id matters here)

describe("studio-voice-core", () => {
  it("setOn toggles a world entry, creating it if absent", () => {
    const w = setOn({}, "yang", true);
    expect(w.yang.on).toBe(true);
  });
  it("setOn does not mutate the input", () => {
    const input = {};
    setOn(input, "yang", true);
    expect(input).toEqual({});
  });
  it("setSource replaces the source and preserves on", () => {
    const w = setSource({ yang: { on: true, source: { kind: "ai", voiceName: "a" } } }, "yang", { kind: "clips", clipSetId: "yang", origin: "clone-existing" });
    expect(w.yang).toEqual({ on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } });
  });
  it("setSource on an absent entry defaults on:false", () => {
    const w = setSource({}, "default", { kind: "ai", voiceName: "x" });
    expect(w.default).toEqual({ on: false, source: { kind: "ai", voiceName: "x" } });
  });
  it("clearVoice removes an entry", () => {
    const w = clearVoice({ yang: { on: true, source: { kind: "ai", voiceName: "x" } } }, "yang");
    expect(w.yang).toBeUndefined();
  });
  it("buildVoiceOverride keeps only configured, complete entries", () => {
    const working = {
      yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } },
      default: { on: false },                 // no source => dropped
    };
    expect(buildVoiceOverride(working, base)).toEqual({
      yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } },
    });
  });
  it("buildVoiceOverride drops entries for unknown world ids and keeps on:false-with-source", () => {
    const working = {
      ghost: { on: true, source: { kind: "ai", voiceName: "x" } },     // unknown id => dropped
      default: { on: false, source: { kind: "ai", voiceName: "x" } },  // assigned but off => KEPT
    };
    expect(buildVoiceOverride(working, base)).toEqual({
      default: { on: false, source: { kind: "ai", voiceName: "x" } },
    });
  });
});
