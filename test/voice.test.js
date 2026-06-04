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

  // Regression: a transient manifest failure must NOT be cached. In prod every line
  // reuses the same editionId ("yang") all session, so one bad fetch used to strand the
  // whole session on TTS — the "voice gone until I hard-refresh" bug. A later line on the
  // same edition must retry and recover.
  it("retries the manifest after a rejected fetch (a network blip must not poison the session)", async () => {
    const plays = mockAudio();
    const spoken = mockSpeech();
    const file = `${lineKey(RAW)}.mp3`;
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: file }) });
    await speakLine("ed_blip", RAW, RAW);
    expect(spoken).toEqual([RAW]);                       // fell back the first time
    await speakLine("ed_blip", RAW, RAW);                // same edition → must retry
    expect(plays).toEqual([`/voice/ed_blip/${file}`]);   // cloned clip now plays
  });

  it("retries the manifest after a transient non-ok response (a mid-deploy 5xx must not poison the session)", async () => {
    const plays = mockAudio();
    const spoken = mockSpeech();
    const file = `${lineKey(RAW)}.mp3`;
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: file }) });
    await speakLine("ed_5xx", RAW, RAW);
    expect(spoken).toEqual([RAW]);                       // 503 → fell back to speech
    await speakLine("ed_5xx", RAW, RAW);                 // same edition → must retry
    expect(plays).toEqual([`/voice/ed_5xx/${file}`]);    // cloned clip now plays
  });
});

describe("robotic answer voice (loss reveal)", () => {
  // Regression: the answer is the session's first speechSynthesis call (the line's
  // prefix/suffix are mp3 clips). Chrome's getVoices() returns [] on that cold first
  // call, then loads asynchronously. voice.js must trigger the load at import so the
  // reveal picks the robot voice instead of falling to the pitch-mangle that turned a
  // short word into a "grshhh" distortion. We model that: getVoices() is empty on its
  // first (cold) call, then returns the robot voice once the load has been kicked off.
  it("warms voices at import so the answer uses the robot voice, not the distorted mangle", async () => {
    const zarvox = { name: "Zarvox" };
    let calls = 0;
    const spoken = [];
    global.SpeechSynthesisUtterance = class {
      constructor(t) { this.text = t; this.pitch = 1; this.rate = 1; this.voice = null; }
    };
    window.speechSynthesis = {
      getVoices: () => (++calls === 1 ? [] : [zarvox]), // first (cold) call empty, then loaded
      addEventListener() {},
      speak: (u) => spoken.push(u),
      cancel() {},
    };
    vi.resetModules();
    const { speakRobotic } = await import("/voice.js"); // import-time warm fires the cold getVoices()
    speakRobotic("SNACK");
    const u = spoken.at(-1);
    expect(u.voice).toBe(zarvox); // robot voice selected — not the pitched-down default
    expect(u.pitch).toBe(1);      // untouched: no garbling pitch-mangle
  });

  it("keeps the word legible when no novelty voice exists (mangle not below 0.6)", async () => {
    const spoken = [];
    global.SpeechSynthesisUtterance = class {
      constructor(t) { this.text = t; this.pitch = 1; this.rate = 1; this.voice = null; }
    };
    window.speechSynthesis = {
      getVoices: () => [{ name: "Samantha" }, { name: "Daniel" }], // no robot/novelty voice
      addEventListener() {},
      speak: (u) => spoken.push(u),
      cancel() {},
    };
    vi.resetModules();
    const { speakRobotic } = await import("/voice.js");
    speakRobotic("SNACK");
    const u = spoken.at(-1);
    expect(u.voice).toBe(null);             // no special voice to assign
    expect(u.pitch).toBeGreaterThanOrEqual(0.6); // legible, not the old 0.3 growl
  });
});
