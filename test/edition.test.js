// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { getGold, setGold, addGold, spendGold, drainGold } from "/edition.js";

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
  it("addGold/setGold still clamp at 0 (the public balance never goes negative)", () => {
    setGold(10); expect(addGold(-50)).toBe(0); expect(getGold()).toBe(0);
    expect(setGold(-99)).toBe(0);
  });
  it("resets corrupt balance to 0", () => {
    localStorage.setItem("wordul.gold", "not-a-number"); expect(getGold()).toBe(0);
  });
});

describe("drainGold (C4 — gold can go negative)", () => {
  it("drains below zero (no clamp) and getGold reads the negative value back", () => {
    setGold(100);
    expect(drainGold(150)).toBe(-50);
    expect(getGold()).toBe(-50);
  });
  it("keeps sinking on repeated drains (bankruptcy is reachable)", () => {
    setGold(0);
    drainGold(200); expect(getGold()).toBe(-200);
    drainGold(200); expect(getGold()).toBe(-400);
  });
  it("a positive drain at a positive balance just subtracts", () => {
    setGold(500); expect(drainGold(200)).toBe(300); expect(getGold()).toBe(300);
  });
});

import { resolveEdition, companionReact } from "/edition.js";

describe("editions + companion", () => {
  it("resolveEdition falls back to default for unknown id", () => {
    expect(resolveEdition("nope").id).toBe("default");
    expect(resolveEdition("default").id).toBe("default");
  });
  it("companionReact returns a line for each event type", () => {
    for (const ev of ["invalid", "wrong", "win", "loss", "idle", "wipe"]) {
      const r = companionReact(ev, { answer: "CRANE" });
      expect(typeof r.text).toBe("string");
      expect(r.text.length).toBeGreaterThan(0);
    }
  });
  it("companionReact substitutes {answer}", () => {
    // Rotate through the loss bank until we hit an {answer} template, then
    // confirm it was substituted (some loss lines legitimately omit the token).
    let substituted = false;
    for (let i = 0; i < 40; i++) {
      const r = companionReact("loss", { answer: "CRANE" });
      if (r.raw.includes("{answer}")) {
        expect(r.text).toContain("CRANE");
        substituted = true;
        break;
      }
    }
    expect(substituted).toBe(true);
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
    expect(html.style.getPropertyValue("--hot").trim()).toBe("#9d8bff");
    expect(window.WordulMotion.revealStaggerMs).toBe(110);
    expect(localStorage.getItem("wordul.edition")).toBe("default");
  });
  it("unknown id falls back to default without throwing", () => {
    expect(() => applyEdition("ghost")).not.toThrow();
    expect(document.documentElement.dataset.edition).toBe("default");
  });
});

describe("applyEdition — neutral board (morphBoard gate)", () => {
  const html = document.documentElement;
  // Board vars must NEVER carry inline overrides from an unblessed edition; they fall back
  // to the elegant :root default. Chrome (accent) always morphs so the day keeps its signature.
  const BOARD = ["--bg", "--fg", "--tile-empty", "--key-bg", "--hot", "--warm", "--cold", "--border"];

  it("an unblessed edition (tactile) leaves the board neutral but still morphs the accent", () => {
    applyEdition("tactile");
    for (const v of BOARD) expect(html.style.getPropertyValue(v).trim()).toBe("");
    // chrome still morphs: tactile's orange accent drives the enter key + glow
    expect(html.style.getPropertyValue("--accent").trim()).toBe("#ff9a52");
    // shape/texture + fonts still come from the edition
    expect(html.dataset.edition).toBe("tactile");
    expect(html.style.getPropertyValue("--font-display")).not.toBe("");
  });

  it("clears stale board overrides when morphing from a blessed edition to an unblessed one", () => {
    applyEdition("default");                                   // blessed: paints the board
    expect(html.style.getPropertyValue("--tile-empty").trim()).toBe("#0e0e10");
    applyEdition("robot");                                     // unblessed: must wipe the board
    for (const v of BOARD) expect(html.style.getPropertyValue(v).trim()).toBe("");
    expect(html.style.getPropertyValue("--accent").trim()).toBe("#ff7043");
  });

  it("blessed editions (default, yang) still paint the full board", () => {
    applyEdition("yang");
    expect(html.style.getPropertyValue("--bg").trim()).toBe("#0b0a0c");
    expect(html.style.getPropertyValue("--hot").trim()).toBe("#6f9e7a");
    expect(html.style.getPropertyValue("--accent").trim()).toBe("#f0c14b");
  });
});

import { colorSchemeVars } from "/edition.js";

describe("colorSchemeVars", () => {
  it("maps a valid trio to accent + atom vars (a1 drives --accent)", () => {
    expect(colorSchemeVars({ a1: "#f0c14b", a2: "#6f9e7a", a3: "#0b0a0c" })).toEqual({
      "--accent": "#f0c14b", "--a1": "#f0c14b", "--a2": "#6f9e7a", "--a3": "#0b0a0c",
    });
  });
  it("returns null for absent or non-object input", () => {
    expect(colorSchemeVars(null)).toBeNull();
    expect(colorSchemeVars(undefined)).toBeNull();
    expect(colorSchemeVars("nope")).toBeNull();
  });
  it("returns null when any member is missing, non-string, or empty", () => {
    expect(colorSchemeVars({ a1: "#fff", a2: "#000" })).toBeNull();
    expect(colorSchemeVars({ a1: "#fff", a2: 5, a3: "#000" })).toBeNull();
    expect(colorSchemeVars({ a1: "#fff", a2: "", a3: "#000" })).toBeNull();
  });
});

import { applyColorScheme } from "/edition.js";

describe("applyColorScheme", () => {
  const html = document.documentElement;
  it("applies accent + atoms and flags data-themed for a valid palette", () => {
    expect(applyColorScheme({ a1: "#f0c14b", a2: "#6f9e7a", a3: "#0b0a0c" })).toBe(true);
    expect(html.style.getPropertyValue("--accent").trim()).toBe("#f0c14b");
    expect(html.style.getPropertyValue("--a2").trim()).toBe("#6f9e7a");
    expect(html.dataset.themed).toBe("1");
  });
  it("clears atoms + the flag for a null palette (returns false)", () => {
    applyColorScheme({ a1: "#f0c14b", a2: "#6f9e7a", a3: "#0b0a0c" });
    expect(applyColorScheme(null)).toBe(false);
    expect(html.style.getPropertyValue("--a1").trim()).toBe("");
    expect(html.style.getPropertyValue("--a3").trim()).toBe("");
    expect(html.dataset.themed).toBeUndefined();
  });
});

import { setDefaultEdition, getActiveEditionId } from "/edition.js";

describe("edition try-on vs default persistence", () => {
  beforeEach(() => { localStorage.clear(); });

  it("applyEdition persists by default", () => {
    applyEdition("jackpot");
    expect(getActiveEditionId()).toBe("jackpot");
  });

  it("applyEdition with persist:false does NOT change the saved default", () => {
    setDefaultEdition("default");
    applyEdition("arcade", { persist: false });
    expect(getActiveEditionId()).toBe("default");
  });

  it("setDefaultEdition persists the chosen edition", () => {
    setDefaultEdition("robot");
    expect(getActiveEditionId()).toBe("robot");
  });

  it("setDefaultEdition falls back to a real edition for an unknown id", () => {
    setDefaultEdition("not-an-edition");
    expect(getActiveEditionId()).toBe("default");
  });
});

import { paintEditionVars } from "/edition.js";
import { getEdition } from "/editions/index.js";

describe("paintEditionVars — per-element edition chrome", () => {
  it("sets the edition's accent + card bg + display font on the element, not <html>", () => {
    document.documentElement.dataset.edition = "default";
    const el = document.createElement("div");
    paintEditionVars(el, "jackpot");
    const ed = getEdition("jackpot");
    expect(el.style.getPropertyValue("--accent")).toBe(ed.palette.accent);
    expect(el.style.getPropertyValue("--bg-card")).toBe(ed.palette.bgCard);
    expect(el.style.getPropertyValue("--font-display")).toBe(ed.fonts.display);
    expect(el.style.getPropertyValue("--fg")).toBe(ed.palette.fg);
    expect(el.style.getPropertyValue("--border")).toBe(ed.palette.border);
    expect(el.style.getPropertyValue("--muted")).toBe(ed.palette.muted);
    expect(el.dataset.edition).toBe("jackpot");
    // It must NOT mutate the global <html> default.
    expect(document.documentElement.dataset.edition === "jackpot").toBe(false);
  });

  it("falls back to the default edition for an unknown id (never throws)", () => {
    const el = document.createElement("div");
    expect(() => paintEditionVars(el, "not-real")).not.toThrow();
    const def = getEdition("default");
    expect(el.style.getPropertyValue("--accent")).toBe(def.palette.accent);
  });
});
