// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getGold, setGold, addGold, spendGold } from "/edition.js";

beforeEach(() => localStorage.clear());

describe("wallet", () => {
  it("defaults to 0 gold (you start broke)", () => { expect(getGold()).toBe(0); });
  it("addGold adds to the balance and returns the new total", () => {
    setGold(40); expect(addGold(25)).toBe(65); expect(getGold()).toBe(65);
  });
  it("spendGold refuses overspend and never goes negative", () => {
    setGold(15); expect(spendGold(20)).toBe(false); expect(getGold()).toBe(15);
    expect(spendGold(10)).toBe(true); expect(getGold()).toBe(5);
  });
  it("resets corrupt balance to 0", () => {
    localStorage.setItem("wordul.gold", "not-a-number"); expect(getGold()).toBe(0);
  });
});

import { resolveEdition, companionReact } from "/edition.js";

describe("editions + companion", () => {
  it("resolveEdition falls back to default for unknown id", () => {
    expect(resolveEdition("nope").id).toBe("default");
    expect(resolveEdition("default").id).toBe("default");
  });
  it("companionReact returns a line for each event type", () => {
    for (const ev of ["invalid", "wrong", "win", "loss", "idle"]) {
      const r = companionReact(ev, { answer: "CRANE" });
      expect(typeof r.text).toBe("string");
      expect(r.text.length).toBeGreaterThan(0);
    }
  });
  it("companionReact substitutes {answer}", () => {
    expect(companionReact("loss", { answer: "CRANE" }).text).toContain("CRANE");
  });
  it("companion lines rotate on repeat calls", () => {
    const a = companionReact("wrong").text;
    const b = companionReact("wrong").text;
    expect(a === b).toBe(false);
  });
  it("returns the raw template alongside substituted text", () => {
    const r = companionReact("loss", { answer: "CRANE" });
    expect(typeof r.raw).toBe("string");
    expect(r.text).not.toContain("{answer}");
    // raw is the UNsubstituted template; text is raw with {answer} -> CRANE.
    expect(r.text).toBe(r.raw.replace("{answer}", "CRANE"));
  });
  it("never leaks a {answer} token even with no answer supplied", () => {
    for (let i = 0; i < 30; i++) {
      const r = companionReact("loss", {});
      expect(r.text).not.toContain("{answer}");
    }
  });
});

import { applyEdition } from "/edition.js";

describe("applyEdition", () => {
  it("sets data-edition, palette vars, motion globals, and persists", () => {
    applyEdition("default");
    const html = document.documentElement;
    expect(html.dataset.edition).toBe("default");
    expect(html.style.getPropertyValue("--bg").trim()).toBe("#0e0e10");
    expect(html.style.getPropertyValue("--green").trim()).toBe("#5b8c6e");
    expect(window.WordulMotion.revealStaggerMs).toBe(200);
    expect(localStorage.getItem("wordul.edition")).toBe("default");
  });
  it("unknown id falls back to default without throwing", () => {
    expect(() => applyEdition("ghost")).not.toThrow();
    expect(document.documentElement.dataset.edition).toBe("default");
  });
});
