// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { speakLine, speakAI, playVoice, stopSpeaking } from "/voice.js";
import { lineKey } from "/voice-key.js";

const RAW = "You won. Don't make it weird.";

// voice.js caches manifests per clipBase, so each test uses a distinct clipBase to
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
  window.speechSynthesis = { speak: (u) => spoken.push(u.text), cancel() {}, getVoices: () => [] };
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
    await speakLine("/voice/ed_clip/", RAW, RAW);
    expect(plays).toEqual([`/voice/ed_clip/${file}`]);
  });

  it("falls back to speechSynthesis with the SPOKEN text when no clip exists", async () => {
    mockAudio();
    const spoken = mockSpeech();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await speakLine("/voice/ed_nofile/", "The word was {answer}.", "The word was CRANE.");
    expect(spoken).toEqual(["The word was CRANE."]);
  });

  it("does nothing when muted", async () => {
    const plays = mockAudio();
    const spoken = mockSpeech();
    localStorage.setItem("wordul.muted", "1");
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: "x.mp3" }) });
    await speakLine("/voice/ed_muted/", RAW, RAW);
    expect(plays).toEqual([]);
    expect(spoken).toEqual([]);
  });

  it("falls back to speech when the manifest fetch fails", async () => {
    mockAudio();
    const spoken = mockSpeech();
    global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    await speakLine("/voice/ed_fetchfail/", RAW, RAW);
    expect(spoken).toEqual([RAW]);
  });

  // Regression: a transient manifest failure must NOT be cached. In prod every line
  // reuses the same clipBase ("/voice/yang/") all session, so one bad fetch used to strand the
  // whole session on TTS — the "voice gone until I hard-refresh" bug. A later line on the
  // same clipBase must retry and recover.
  it("retries the manifest after a rejected fetch (a network blip must not poison the session)", async () => {
    const plays = mockAudio();
    const spoken = mockSpeech();
    const file = `${lineKey(RAW)}.mp3`;
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: file }) });
    await speakLine("/voice/ed_blip/", RAW, RAW);
    expect(spoken).toEqual([RAW]);                             // fell back the first time
    await speakLine("/voice/ed_blip/", RAW, RAW);              // same clipBase → must retry
    expect(plays).toEqual([`/voice/ed_blip/${file}`]);         // cloned clip now plays
  });

  it("retries the manifest after a transient non-ok response (a mid-deploy 5xx must not poison the session)", async () => {
    const plays = mockAudio();
    const spoken = mockSpeech();
    const file = `${lineKey(RAW)}.mp3`;
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: file }) });
    await speakLine("/voice/ed_5xx/", RAW, RAW);
    expect(spoken).toEqual([RAW]);                             // 503 → fell back to speech
    await speakLine("/voice/ed_5xx/", RAW, RAW);               // same clipBase → must retry
    expect(plays).toEqual([`/voice/ed_5xx/${file}`]);          // cloned clip now plays
  });
});

describe("full-robot reveal (speakTemplated)", () => {
  const zarvox = { name: "Zarvox" };
  let spoken;

  // Utterances whose `end` fires as soon as speak() is called, so the segment
  // chain advances; the only real wait left is the deliberate beat before the word.
  function mockRobotSpeech() {
    spoken = [];
    global.SpeechSynthesisUtterance = class {
      constructor(t) { this.text = t; this.pitch = 1; this.rate = 1; this.voice = null; this.h = {}; }
      addEventListener(ev, fn) { this.h[ev] = fn; }
    };
    window.speechSynthesis = {
      getVoices: () => [zarvox],
      addEventListener() {},
      speak: (u) => { spoken.push(u); u.h.end?.(); },
      cancel() {},
    };
  }

  it("by default speaks frame → ½s beat → word, all in the same robot voice, no clip fetch", async () => {
    vi.useFakeTimers();
    mockRobotSpeech();
    global.fetch = vi.fn(); // robot mode needs no manifest — must never fetch
    vi.resetModules();
    const { speakTemplated } = await import("/voice.js");
    const p = speakTemplated("/voice/ed_fullrobot/", "The word was {answer}.", { answer: "CRANE" });
    await vi.advanceTimersByTimeAsync(0);
    expect(spoken.map((u) => u.text)).toEqual(["The word was"]); // word held back during the beat
    await vi.advanceTimersByTimeAsync(500);
    await p;
    expect(spoken.map((u) => u.text)).toEqual(["The word was", "CRANE"]);
    expect(spoken.every((u) => u.voice === zarvox)).toBe(true); // same bot throughout
    expect(global.fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("speaks a real suffix after the word, but skips punctuation-only leftovers", async () => {
    vi.useFakeTimers();
    mockRobotSpeech();
    vi.resetModules();
    const { speakTemplated } = await import("/voice.js");
    const p = speakTemplated("/voice/ed_suffix/", "Bzzt... it was {answer}. No rust on you!", { answer: "CRANE" });
    await vi.advanceTimersByTimeAsync(500);
    await p;
    expect(spoken.map((u) => u.text)).toEqual(["Bzzt... it was", "CRANE", ". No rust on you!"]);
    vi.useRealTimers();
  });

  it("stays SILENT when the answer is empty — never a dangling 'the word was…'", async () => {
    // Regression: a forfeit announced before the server's reveal snapshot landed,
    // and the reveal spoke its frame with nothing after it.
    mockRobotSpeech();
    vi.resetModules();
    const { speakTemplated } = await import("/voice.js");
    await speakTemplated("/voice/ed_noanswer/", "The word was {answer}.", { answer: "" });
    await speakTemplated("/voice/ed_noanswer/", "The word was {answer}.", {});
    expect(spoken).toEqual([]);
  });

  it('"split" mode preserves the cloned-frame + robot-word behavior', async () => {
    mockRobotSpeech();
    const plays = [];
    global.Audio = class {
      constructor(src) { this.src = src; plays.push(src); this.h = {}; }
      addEventListener(ev, fn) { this.h[ev] = fn; }
      play() { this.h.ended?.(); return Promise.resolve(); }
      pause() {}
    };
    const file = `${lineKey("The word was")}.mp3`;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ [lineKey("The word was")]: file }) });
    vi.resetModules();
    const { speakTemplated } = await import("/voice.js");
    await speakTemplated("/voice/ed_split/", "The word was {answer}.", { answer: "CRANE" }, "split");
    expect(plays).toEqual([`/voice/ed_split/${file}`]);          // frame: cloned clip
    // word: robot. (The trailing "." suffix still goes through TTS as before — silent.)
    expect(spoken.map((u) => u.text)).toEqual(["CRANE", "."]);
    expect(spoken[0].voice).toBe(zarvox);
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

describe("playVoice dispatcher", () => {
  function mockSpeechFull() {
    const spoken = [];
    global.SpeechSynthesisUtterance = class {
      constructor(t) { this.text = t; this.voice = null; this.rate = undefined; this.pitch = undefined; }
    };
    window.speechSynthesis = {
      speak: (u) => spoken.push(u),
      cancel() {},
      getVoices: () => [{ name: "Samantha" }, { name: "Zarvox" }],
    };
    return spoken;
  }

  it("does nothing when mode is 'silent'", () => {
    const spoken = mockSpeechFull();
    const plays = mockAudio();
    playVoice({ mode: "silent" }, RAW, RAW);
    expect(spoken).toEqual([]);
    expect(plays).toEqual([]);
  });

  it("does nothing when voice is null/undefined", () => {
    const spoken = mockSpeechFull();
    const plays = mockAudio();
    playVoice(null, RAW, RAW);
    playVoice(undefined, RAW, RAW);
    expect(spoken).toEqual([]);
    expect(plays).toEqual([]);
  });

  it("speakAI: calls speechSynthesis.speak with the named voice, rate, and pitch", () => {
    const spoken = mockSpeechFull();
    playVoice({ mode: "ai", voiceName: "Zarvox", rate: 1.2, pitch: 0.8 }, RAW, "Hello there");
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe("Hello there");
    expect(spoken[0].voice).toEqual({ name: "Zarvox" });
    expect(spoken[0].rate).toBe(1.2);
    expect(spoken[0].pitch).toBe(0.8);
  });

  it("speakAI: for a templated raw line uses `text` (the rendered answer)", () => {
    const spoken = mockSpeechFull();
    playVoice(
      { mode: "ai", voiceName: "Samantha" },
      "The word was {answer}.",
      "The word was CRANE.",
    );
    expect(spoken[0].text).toBe("The word was CRANE.");
  });

  it("speakAI: for a non-templated raw line falls back to text ?? raw", () => {
    const spoken = mockSpeechFull();
    playVoice({ mode: "ai", voiceName: "Samantha" }, RAW, undefined);
    expect(spoken[0].text).toBe(RAW);
  });

  it("clips mode: non-templated line routes to speakLine (clip or fallback TTS)", async () => {
    const plays = mockAudio();
    const spoken = mockSpeechFull();
    const file = `${lineKey(RAW)}.mp3`;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ [lineKey(RAW)]: file }) });
    await playVoice({ mode: "clips", clipBase: "/voice/pv_clips/" }, RAW, RAW);
    expect(plays).toEqual([`/voice/pv_clips/${file}`]);
    expect(spoken).toEqual([]);
  });

  it("clips mode: templated line routes to speakTemplated (robot default)", async () => {
    vi.useFakeTimers();
    const spoken = [];
    const zarvox = { name: "Zarvox" };
    global.SpeechSynthesisUtterance = class {
      constructor(t) { this.text = t; this.pitch = 1; this.rate = 1; this.voice = null; this.h = {}; }
      addEventListener(ev, fn) { this.h[ev] = fn; }
    };
    window.speechSynthesis = {
      getVoices: () => [zarvox],
      addEventListener() {},
      speak: (u) => { spoken.push(u); u.h.end?.(); },
      cancel() {},
    };
    global.fetch = vi.fn(); // robot mode — no manifest needed
    vi.resetModules();
    const { playVoice: playVoiceFresh } = await import("/voice.js");
    const p = playVoiceFresh(
      { mode: "clips", clipBase: "/voice/pv_templated/" },
      "The word was {answer}.",
      "The word was CRANE.",
      { answer: "CRANE" },
    );
    await vi.advanceTimersByTimeAsync(500);
    await p;
    expect(spoken.map((u) => u.text)).toContain("CRANE");
    expect(global.fetch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
