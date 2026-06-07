import { describe, it, expect, beforeEach } from "vitest";
import { hydrateVoiceConfig, setActiveVoiceId, activeVoiceLayer, voiceLayer, resolveClipBase } from "../public/voice-config.js";

describe("voiceLayer", () => {
  it("returns {} for absent / off / sourceless", () => {
    expect(voiceLayer(undefined)).toEqual({});
    expect(voiceLayer({ on: false, source: { kind: "ai", voiceName: "x" } })).toEqual({});
    expect(voiceLayer({ on: true })).toEqual({});
  });
  it("wraps an on source as a voice layer", () => {
    expect(voiceLayer({ on: true, source: { kind: "ai", voiceName: "x" } }))
      .toEqual({ voice: { source: { kind: "ai", voiceName: "x" } } });
  });
});

describe("resolveClipBase", () => {
  it("built-in editions resolve to static ASSETS, others to R2 route", () => {
    expect(resolveClipBase("yang")).toBe("/voice/yang/");
    expect(resolveClipBase("my-upload")).toBe("/voice-clips/my-upload/");
  });
});

describe("active voice layer", () => {
  beforeEach(() => { hydrateVoiceConfig({}); setActiveVoiceId(null); });
  it("is {} when nothing active or not configured", () => {
    expect(activeVoiceLayer()).toEqual({});
    setActiveVoiceId("yang");
    expect(activeVoiceLayer()).toEqual({});
  });
  it("returns the active id's layer once hydrated", () => {
    hydrateVoiceConfig({ yang: { on: true, source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } } });
    setActiveVoiceId("yang");
    expect(activeVoiceLayer()).toEqual({ voice: { source: { kind: "clips", clipSetId: "yang", origin: "clone-existing" } } });
  });
});
