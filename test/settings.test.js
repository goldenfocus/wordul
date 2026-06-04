// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, getSettings, saveSettings, applySettings } from "/settings.js";

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
    expect(s.hardMode).toBe(true);
    expect(s.colorBlind).toBe(false); // default preserved
    expect(s.keyboardLayout).toBe("auto"); // default preserved
  });
  it("defaults companionComments to true (companion text reactions on)", () => {
    expect(getSettings().companionComments).toBe(true);
  });
  it("lets a stored companionComments=false override the default", () => {
    localStorage.setItem("wr.settings", JSON.stringify({ companionComments: false }));
    expect(getSettings().companionComments).toBe(false);
    expect(getSettings().hardMode).toBe(false); // other defaults preserved
  });
  it("tolerates corrupt JSON by falling back to defaults", () => {
    localStorage.setItem("wr.settings", "not-json{");
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("does not mutate DEFAULT_SETTINGS between calls", () => {
    const a = getSettings();
    a.hardMode = true;
    expect(getSettings().hardMode).toBe(false);
    expect(DEFAULT_SETTINGS.hardMode).toBe(false);
  });
});

describe("saveSettings", () => {
  it("round-trips through localStorage", () => {
    saveSettings({ ...DEFAULT_SETTINGS, hardMode: true, keyboardLayout: "azerty" });
    const s = getSettings();
    expect(s.hardMode).toBe(true);
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
