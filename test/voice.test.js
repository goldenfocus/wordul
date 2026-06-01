// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { speakLine, stopSpeaking } from "/voice.js";
import { lineKey } from "/voice-key.js";

const RAW = "You won. Don't make it weird.";

// voice.js caches manifests per editionId, so each test uses a distinct id to
// guarantee a fresh fetch (no cross-test cache bleed).
function mockAudio() {
  const plays = [];
  global.Audio = class {
    constructor(src) { this.src = src; plays.push(src); }
    play() { return Promise.resolve(); }
    pause() {}
  };
  return plays;
}
function mockSpeech() {
  const spoken = [];
  global.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  window.speechSynthesis = { speak: (u) => spoken.push(u.text), cancel() {} };
  return spoken;
}

beforeEach(() => {
  localStorage.clear();
  stopSpeaking();
});

describe("speakLine", () => {
  it("plays the pre-rendered clip when the manifest has the line", async () => {
    const plays = mockAudio();
    mockSpeech();
    const file = `${lineKey(RAW)}.mp3`;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: file }) });
    await speakLine("ed_clip", RAW, RAW);
    expect(plays).toEqual([`/voice/ed_clip/${file}`]);
  });

  it("falls back to speechSynthesis with the SPOKEN text when no clip exists", async () => {
    mockAudio();
    const spoken = mockSpeech();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await speakLine("ed_nofile", "The word was {answer}.", "The word was CRANE.");
    expect(spoken).toEqual(["The word was CRANE."]);
  });

  it("does nothing when muted", async () => {
    const plays = mockAudio();
    const spoken = mockSpeech();
    localStorage.setItem("wordul.muted", "1");
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: "x.mp3" }) });
    await speakLine("ed_muted", RAW, RAW);
    expect(plays).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it("falls back to speech when the manifest fetch fails", async () => {
    mockAudio();
    const spoken = mockSpeech();
    global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await speakLine("ed_fetchfail", RAW, RAW);
    expect(spoken).toEqual([RAW]);
  });
});
