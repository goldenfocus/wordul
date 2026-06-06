// test/inspire.test.js — the forfeit pool: lines written to be SPOKEN.
import { describe, it, expect } from "vitest";
import { FORFEIT, pickForfeit } from "/inspire.js";

describe("FORFEIT pool", () => {
  it("is a deep pool of non-empty lines", () => {
    expect(FORFEIT.length).toBeGreaterThanOrEqual(30);
    for (const line of FORFEIT) {
      expect(typeof line).toBe("string");
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it("lines are written to be spoken — no templates, no '— Author' attributions", () => {
    for (const line of FORFEIT) {
      expect(line).not.toMatch(/\{.*\}/); // would hit speakTemplated's reveal machinery
      expect(line).not.toMatch(/—\s*[A-Z][a-z]+\s*$/); // attributions sound robotic aloud
    }
  });

  it("includes both flavors: empowerment and Tip:-prefixed tactics", () => {
    const tips = FORFEIT.filter((l) => l.startsWith("Tip:"));
    expect(tips.length).toBeGreaterThanOrEqual(10);
    expect(FORFEIT.length - tips.length).toBeGreaterThanOrEqual(10);
  });

  it("pickForfeit draws from the pool", () => {
    for (let i = 0; i < 50; i++) expect(FORFEIT).toContain(pickForfeit());
  });
});
