// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, getSettings, saveSettings, applySettings, activeDifficulty } from "/settings.js";

beforeEach(() => {
  localStorage.clear();
  document.body.className = "";
});

describe("getSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("merges stored values over the defaults", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ hardMode: true }));
    const s = getSettings();
    expect(s.difficulty).toBe("hard"); // legacy hardMode:true migrates to hard
    expect(s.colorBlind).toBe(false); // default preserved
    expect(s.keyboardLayout).toBe("auto"); // default preserved
  });
  it("defaults companionComments to false (the speech toast clashes with the new design)", () => {
    expect(getSettings().companionComments).toBe(false);
  });
  it("lets a stored companionComments=true override the off default", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ companionComments: true }));
    expect(getSettings().companionComments).toBe(true);
    expect(getSettings().difficulty).toBe("easy"); // other defaults preserved
  });
  it("tolerates corrupt JSON by falling back to defaults", () => {
    localStorage.setItem("wr.settings", "not-json{");
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("does not mutate DEFAULT_SETTINGS between calls", () => {
    const a = getSettings();
    a.difficulty = "hard";
    expect(getSettings().difficulty).toBe("easy");
    expect(DEFAULT_SETTINGS.difficulty).toBe("easy");
  });
});

describe("saveSettings", () => {
  it("round-trips through localStorage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, difficulty: "hard", keyboardLayout: "azerty" });
    const s = getSettings();
    expect(s.difficulty).toBe("hard");
    expect(s.keyboardLayout).toBe("azerty");
  });
  it("applies the settings as a side-effect (body classes update on save)", () => {
    saveSettings({ ...DEFAULT_SETTINGS, colorBlind: true });
    expect(document.body.classList.contains("cb")).toBe(true);
  });
});

describe("applySettings", () => {
  it("toggles the cb + reduced-motion body classes on", () => {
    applySettings({ colorBlind: true, reducedMotion: true });
    expect(document.body.classList.contains("cb")).toBe(true);
    expect(document.body.classList.contains("reduced-motion")).toBe(true);
  });
  it("toggles them back off", () => {
    applySettings({ colorBlind: true, reducedMotion: true });
    applySettings({ colorBlind: false, reducedMotion: false });
    expect(document.body.classList.contains("cb")).toBe(false);
    expect(document.body.classList.contains("reduced-motion")).toBe(false);
  });
});

describe("difficulty setting", () => {
  it("defaults to easy when nothing is stored", () => {
    expect(getSettings().difficulty).toBe("easy");
    expect(activeDifficulty()).toBe("easy");
  });
  it("migrates legacy hardMode:true to hard", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ hardMode: true }));
    expect(getSettings().difficulty).toBe("hard");
  });
  it("migrates legacy hardMode:false to easy", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ hardMode: false }));
    expect(getSettings().difficulty).toBe("easy");
  });
  it("a stored difficulty wins over the legacy hardMode key", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ hardMode: true, difficulty: "medium" }));
    expect(getSettings().difficulty).toBe("medium");
  });
  it("falls back to easy on a garbage stored value", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ difficulty: "nightmare" }));
    expect(getSettings().difficulty).toBe("easy");
  });
  it("activeDifficulty tracks saved changes", () => {
    saveSettings({ ...getSettings(), difficulty: "hard" });
    expect(activeDifficulty()).toBe("hard");
  });
});
