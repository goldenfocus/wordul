import { describe, it, expect } from "vitest";
import { getEdition, EDITIONS } from "/editions/index.js";

describe("yang edition", () => {
  const ed = getEdition("yang");

  it("is registered and resolvable by id", () => {
    expect(ed.id).toBe("yang");
    expect(EDITIONS.some((e) => e.id === "yang")).toBe(true);
  });
  it("has voice on and a companion name", () => {
    expect(ed.sound.voice.on).toBe(true);
    expect(typeof ed.companion.name).toBe("string");
  });
  it("has non-empty banks for all five events", () => {
    for (const ev of ["invalid", "wrong", "win", "loss", "idle"]) {
      expect(Array.isArray(ed.companion.lines[ev])).toBe(true);
      expect(ed.companion.lines[ev].length).toBeGreaterThan(0);
    }
  });
  it("idle is the biggest bank (the star)", () => {
    expect(ed.companion.lines.idle.length).toBeGreaterThanOrEqual(20);
  });
  it("loss bank includes {answer} template lines", () => {
    expect(ed.companion.lines.loss.some((l) => l.includes("{answer}"))).toBe(true);
  });
  it("every line is TTS-clean: short, no emoji/symbols/quotes", () => {
    const all = Object.values(ed.companion.lines).flat();
    for (const line of all) {
      expect(line.length).toBeLessThanOrEqual(80);
      // letters, spaces, basic sentence punctuation, and the {answer} token only
      expect(line.replace("{answer}", "")).toMatch(/^[A-Za-z0-9 ,.'?\-—]+$/);
    }
  });
  it("has a full palette and fonts", () => {
    for (const k of ["bg", "fg", "accent", "green", "yellow", "gray"]) {
      expect(typeof ed.palette[k]).toBe("string");
    }
    expect(typeof ed.fonts.display).toBe("string");
    expect(typeof ed.fonts.body).toBe("string");
  });
});
