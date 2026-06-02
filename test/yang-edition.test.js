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
  it("has non-empty banks for all events", () => {
    const nonEmpty = (bank) => Array.isArray(bank)
      ? bank.length > 0
      : Object.values(bank).every((t) => Array.isArray(t) && t.length > 0);
    for (const ev of ["invalid", "wrong", "win", "loss", "idle", "greens"]) {
      expect(nonEmpty(ed.companion.lines[ev])).toBe(true);
    }
  });
  it("idle is the biggest bank (the star)", () => {
    expect(ed.companion.lines.idle.length).toBeGreaterThanOrEqual(20);
  });
  it("loss bank includes {answer} template lines", () => {
    expect(ed.companion.lines.loss.some((l) => l.includes("{answer}"))).toBe(true);
  });
  it("every line is TTS-clean: short, no emoji/symbols/quotes", () => {
    const collect = (node, out = []) => {
      if (typeof node === "string") out.push(node);
      else if (Array.isArray(node)) node.forEach((n) => collect(n, out));
      else if (node && typeof node === "object") Object.values(node).forEach((n) => collect(n, out));
      return out;
    };
    for (const line of collect(ed.companion.lines)) {
      expect(line.length).toBeLessThanOrEqual(80);
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
