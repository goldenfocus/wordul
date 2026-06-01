import { describe, it, expect } from "vitest";
import { getEdition, EDITIONS } from "/editions/index.js";

describe("jackpot edition", () => {
  const ed = getEdition("jackpot");

  it("is registered and resolvable by id", () => {
    expect(ed.id).toBe("jackpot");
    expect(EDITIONS.some((e) => e.id === "jackpot")).toBe(true);
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
  it("loss bank includes {answer} template lines", () => {
    expect(ed.companion.lines.loss.some((l) => l.includes("{answer}"))).toBe(true);
  });
  it("every line is TTS-clean: short, no emoji/symbols/quotes", () => {
    const all = Object.values(ed.companion.lines).flat();
    for (const line of all) {
      expect(line.length).toBeLessThanOrEqual(80);
      expect(line.replace("{answer}", "")).toMatch(/^[A-Za-z0-9 ,.'?\-—]+$/);
    }
  });
  it("uses the Bungee + Chakra Petch fonts", () => {
    expect(ed.fonts.display).toContain("Bungee");
    expect(ed.fonts.body).toContain("Chakra Petch");
  });
});
