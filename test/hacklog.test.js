// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { createHacklog } from "/hacklog.js";

function mount() {
  const el = document.createElement("div");
  el.id = "hacklog";
  document.body.appendChild(el);
  return el;
}

describe("createHacklog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns a no-op API when given no mount element", () => {
    const log = createHacklog(null, { reducedMotion: true });
    log.logLine("hello");
    expect(log.getEntries()).toEqual([{ text: "hello", tone: null }]);
    // none of these should throw
    log.collapse(); log.expand(); log.addInstant("x"); log.clear();
    expect(log.getEntries()).toEqual([]);
  });

  it("mounts a body + ticker into the element", () => {
    const el = mount();
    createHacklog(el, { reducedMotion: true });
    expect(el.classList.contains("hacklog")).toBe(true);
    expect(el.querySelector(".hacklog-body")).toBeTruthy();
    expect(el.querySelector(".hacklog-ticker")).toBeTruthy();
  });

  it("logLine prefixes with '> ' and records structured entries in order", () => {
    const el = mount();
    const log = createHacklog(el, { reducedMotion: true });
    log.logLine("hot N pos 4  +100", { tone: "gain" });
    log.logLine("warm C pos 1  +50", { tone: "gain" });
    expect(log.getEntries()).toEqual([
      { text: "> hot N pos 4  +100", tone: "gain" },
      { text: "> warm C pos 1  +50", tone: "gain" },
    ]);
  });

  it("reducedMotion writes the full text instantly (no pending timers)", () => {
    const el = mount();
    const log = createHacklog(el, { reducedMotion: true });
    log.logLine("instant line");
    const lines = el.querySelectorAll(".hacklog-body .hacklog-line");
    expect(lines.length).toBe(1);
    expect(lines[0].textContent).toBe("> instant line"); // fully written, no typing
  });

  it("addInstant always writes the full text immediately, without the '>' prompt", () => {
    const el = mount();
    const log = createHacklog(el, { reducedMotion: false });
    log.addInstant("✦ 1.5× COMBO  +125", { tone: "combo" });
    const line = el.querySelector(".hacklog-body .hacklog-line");
    expect(line.textContent).toBe("✦ 1.5× COMBO  +125");
    expect(line.classList.contains("combo")).toBe(true);
    expect(log.getEntries()).toEqual([{ text: "✦ 1.5× COMBO  +125", tone: "combo" }]);
  });

  it("collapse() shows the ticker with the last line; expand() restores scrollback", () => {
    const el = mount();
    const log = createHacklog(el, { reducedMotion: true });
    log.logLine("first");
    log.logLine("last");
    log.collapse();
    expect(el.classList.contains("collapsed")).toBe(true);
    const ticker = el.querySelector(".hacklog-ticker");
    expect(ticker.textContent).toContain("> last");
    expect(ticker.textContent).toContain("▸");
    log.expand();
    expect(el.classList.contains("collapsed")).toBe(false);
  });

  it("tapping the ticker toggles expand/collapse", () => {
    const el = mount();
    const log = createHacklog(el, { reducedMotion: true });
    log.logLine("line");
    const ticker = el.querySelector(".hacklog-ticker");
    log.collapse();
    expect(el.classList.contains("collapsed")).toBe(true);
    ticker.click(); // tap to expand
    expect(el.classList.contains("collapsed")).toBe(false);
    // collapse() then tap again to confirm round-trip
    log.collapse();
    ticker.click();
    expect(el.classList.contains("collapsed")).toBe(false);
  });

  it("clear() empties scrollback, entries, and DOM", () => {
    const el = mount();
    const log = createHacklog(el, { reducedMotion: true });
    log.logLine("a");
    log.logLine("b");
    log.clear();
    expect(log.getEntries()).toEqual([]);
    expect(el.querySelectorAll(".hacklog-body .hacklog-line").length).toBe(0);
  });

  it("getEntries returns copies, not the internal array (no external mutation)", () => {
    const el = mount();
    const log = createHacklog(el, { reducedMotion: true });
    log.logLine("a");
    const snap = log.getEntries();
    snap.push({ text: "tampered", tone: null });
    expect(log.getEntries().length).toBe(1);
  });

  it("types lines sequentially (no interleaving) — final text matches the queued order", async () => {
    const el = mount();
    const log = createHacklog(el, { reducedMotion: false });
    log.logLine("alpha");
    log.logLine("beta");
    // Wait for both lines to finish typing. TYPE_CHAR_MS=22; ~7 chars each => well under 1s.
    await new Promise((r) => setTimeout(r, 600));
    const lines = el.querySelectorAll(".hacklog-body .hacklog-line");
    expect(lines.length).toBe(2);
    expect(lines[0].textContent).toBe("> alpha");
    expect(lines[1].textContent).toBe("> beta");
    expect(log.getEntries().map((e) => e.text)).toEqual(["> alpha", "> beta"]);
  });
});
