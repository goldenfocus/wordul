// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHacklog, TYPE_CHAR_MS, HOLD_MS, FADE_MS, GHOST_MS } from "/hacklog.js";

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

  it("collapse() shows only the bare ▸ affordance (no last-line text); expand() restores scrollback", () => {
    // The floating line is the visible play surface now — the rest ticker is a dim
    // tap target, NOT a persistent copy of the last event (that was the old design).
    const el = mount();
    const log = createHacklog(el, { reducedMotion: true });
    log.logLine("first");
    log.logLine("last");
    log.collapse();
    expect(el.classList.contains("collapsed")).toBe(true);
    const ticker = el.querySelector(".hacklog-ticker");
    expect(ticker.textContent).toBe("▸");
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

  it("scrollback body receives the full text instantly even when motion is on", () => {
    // The body is the audit log: it never types. The typewriter lives on the
    // floating play-surface line only.
    const el = mount();
    const log = createHacklog(el, { reducedMotion: false });
    log.logLine("alpha");
    log.logLine("beta");
    const lines = el.querySelectorAll(".hacklog-body .hacklog-line");
    expect(lines.length).toBe(2);
    expect(lines[0].textContent).toBe("> alpha");
    expect(lines[1].textContent).toBe("> beta");
    expect(log.getEntries().map((e) => e.text)).toEqual(["> alpha", "> beta"]);
  });
});

describe("floating line — the vanish ritual (collapsed play surface)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function mountLog(opts = { reducedMotion: false }) {
    const el = mount();
    return { el, log: createHacklog(el, opts) };
  }

  it("logLine surfaces a tone-classed float line that types in, holds, then vanishes", () => {
    const { el, log } = mountLog();
    log.logLine("hot N pos 4  +100", { tone: "hot" });
    const fl = el.querySelector(".hacklog-float .hacklog-fline");
    expect(fl).toBeTruthy();
    expect(fl.classList.contains("hot")).toBe(true);
    // typewriter finishes
    vi.advanceTimersByTime(TYPE_CHAR_MS * 25);
    expect(fl.textContent).toBe("> hot N pos 4  +100");
    // hold elapses → fading out
    vi.advanceTimersByTime(HOLD_MS);
    expect(fl.classList.contains("vanishing")).toBe(true);
    // fade elapses → gone
    vi.advanceTimersByTime(FADE_MS + 50);
    expect(el.querySelector(".hacklog-float .hacklog-fline")).toBeNull();
  });

  it("a new line preempts the current one: it ghosts immediately, then dissolves", () => {
    const { el, log } = mountLog();
    log.logLine("warm E pos 3  +50", { tone: "warm" });
    vi.advanceTimersByTime(TYPE_CHAR_MS * 25); // typed, mid-hold
    log.logLine("hot N pos 4  +100", { tone: "hot" });
    const all = el.querySelectorAll(".hacklog-float .hacklog-fline");
    expect(all.length).toBe(2);
    expect(all[0].classList.contains("ghost")).toBe(true);
    const active = el.querySelectorAll(".hacklog-float .hacklog-fline:not(.ghost)");
    expect(active.length).toBe(1);
    expect(active[0].classList.contains("hot")).toBe(true);
    // the ghost dissolves on its own
    vi.advanceTimersByTime(GHOST_MS + 50);
    expect(el.querySelectorAll(".hacklog-float .ghost").length).toBe(0);
  });

  it("a line preempted mid-typewriter ghosts with its FULL text (true after-image)", () => {
    const { el, log } = mountLog();
    log.logLine("warm E pos 3  +50", { tone: "warm" });
    vi.advanceTimersByTime(TYPE_CHAR_MS * 2); // barely started typing
    log.logLine("hot N pos 4  +100", { tone: "hot" });
    const ghost = el.querySelector(".hacklog-float .ghost");
    expect(ghost.textContent).toBe("> warm E pos 3  +50");
  });

  it("burst of three: never more than one active line + one ghost at a time", () => {
    const { el, log } = mountLog();
    log.logLine("a", { tone: "warm" });
    log.logLine("b", { tone: "hot" });
    log.logLine("c", { tone: "combo" });
    const all = el.querySelectorAll(".hacklog-float .hacklog-fline");
    expect(all.length).toBeLessThanOrEqual(2);
    expect(el.querySelectorAll(".hacklog-float .hacklog-fline:not(.ghost)").length).toBe(1);
  });

  it("reducedMotion: float line renders instantly and still auto-hides after the hold", () => {
    const { el, log } = mountLog({ reducedMotion: true });
    log.logLine("hot N pos 4  +100", { tone: "hot" });
    const fl = el.querySelector(".hacklog-float .hacklog-fline");
    expect(fl.textContent).toBe("> hot N pos 4  +100"); // no typewriter
    vi.advanceTimersByTime(HOLD_MS + FADE_MS + 50);
    expect(el.querySelector(".hacklog-float .hacklog-fline")).toBeNull();
  });

  it("addInstant surfaces a float line with no typewriter even with motion on", () => {
    const { el, log } = mountLog();
    log.addInstant("> ↳ ×1.5 combo  +75  (=225)", { tone: "combo" });
    const fl = el.querySelector(".hacklog-float .hacklog-fline");
    expect(fl.textContent).toBe("> ↳ ×1.5 combo  +75  (=225)");
    expect(fl.classList.contains("combo")).toBe(true);
  });

  it("clear() removes float DOM and cancels timers (no late mutations)", () => {
    const { el, log } = mountLog();
    log.logLine("doomed", { tone: "hot" });
    log.clear();
    expect(el.querySelector(".hacklog-float .hacklog-fline")).toBeNull();
    // advancing past every lifecycle stage must not throw or resurrect DOM
    vi.advanceTimersByTime(TYPE_CHAR_MS * 50 + HOLD_MS + FADE_MS + GHOST_MS + 100);
    expect(el.querySelector(".hacklog-float .hacklog-fline")).toBeNull();
  });

  it("getEntries keeps every entry with its tone regardless of vanish state", () => {
    const { log } = mountLog();
    log.logLine("warm E pos 3  +50", { tone: "warm" });
    log.logLine("hot N pos 4  +100", { tone: "hot" });
    vi.advanceTimersByTime(TYPE_CHAR_MS * 60 + HOLD_MS + FADE_MS + 100); // all vanished
    expect(log.getEntries()).toEqual([
      { text: "> warm E pos 3  +50", tone: "warm" },
      { text: "> hot N pos 4  +100", tone: "hot" },
    ]);
  });

  it("scrollback lines carry the new tones (hot/warm) as classes", () => {
    const { el, log } = mountLog({ reducedMotion: true });
    log.logLine("warm E pos 3  +50", { tone: "warm" });
    log.logLine("hot N pos 4  +100", { tone: "hot" });
    const lines = el.querySelectorAll(".hacklog-body .hacklog-line");
    expect(lines[0].classList.contains("warm")).toBe(true);
    expect(lines[1].classList.contains("hot")).toBe(true);
  });
});
