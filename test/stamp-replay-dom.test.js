// @vitest-environment jsdom
// Integration: click a rendered solve stamp → the driver veils, types, flips,
// and restores. Uses the REAL renderStamp markup so a drift in classes/structure
// between daily-card.js and stamp-replay.js fails here, not in prod.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderStamp } from "../public/daily-card.js";
import { wireStampReplays, autoPlayStampOnce } from "../public/stamp-replay.js";
import { TIMING, buildReplaySteps } from "../public/stamp-replay-core.js";

let reduced = false;
let root; // fresh container per test — re-wiring document.body would stack listeners
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  window.matchMedia = () => ({ matches: reduced });
  root = document.createElement("div");
  document.body.replaceChildren(root);
  root.innerHTML = renderStamp(["xyg", "ggg"], ["CAT", "DOG"], 4);
  wireStampReplays(root);
});

const stamp = () => root.querySelector(".daily-stamp");
const cells = (sel) => root.querySelectorAll(sel).length;
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("stamp replay driver", () => {
  it("click veils played cells only, then restores the final board", () => {
    click(stamp());
    expect(cells(".stamp-cell.is-veiled")).toBe(6); // 2 played rows × 3; pad rows untouched
    expect(cells(".stamp-cell.is-empty.is-veiled")).toBe(0);
    vi.runAllTimers();
    expect(cells(".is-veiled") + cells(".is-typed") + cells(".stamp-pop")).toBe(0);
  });

  it("types letters before flipping them", () => {
    click(stamp());
    vi.advanceTimersByTime(3 * TIMING.TYPE_MS - 1); // row 0 fully typed; first flip lands at exactly 3×TYPE_MS
    expect(cells(".stamp-cell.is-typed")).toBe(3);
    expect(cells(".stamp-cell.is-veiled")).toBe(6);
    vi.runAllTimers();
  });

  it("click mid-replay snaps straight to the final board", () => {
    click(stamp());
    vi.advanceTimersByTime(TIMING.TYPE_MS);
    click(stamp());
    expect(cells(".is-veiled") + cells(".is-typed")).toBe(0);
  });

  it("clicks on links inside the card never start a replay", () => {
    root.innerHTML = `<div>${renderStamp(["ggg"], undefined)}<a href="/@maya" id="nm">@maya</a></div>`;
    click(root.querySelector("#nm"));
    expect(cells(".is-veiled")).toBe(0);
  });

  it("prefers-reduced-motion leaves the final board alone", () => {
    reduced = true;
    click(stamp());
    expect(cells(".is-veiled")).toBe(0);
  });

  it("a lost board ends its replay with the flop", () => {
    root.innerHTML = renderStamp(["xxx", "xyx"], ["CAT", "DOG"]);
    const s = root.querySelector(".daily-stamp");
    click(s);
    const { total } = buildReplaySteps(["xxx", "xyx"], true);
    vi.advanceTimersByTime(total + 401); // replay swept → flop begins
    expect(s.classList.contains("stamp-flop")).toBe(true);
    vi.runAllTimers();
    expect(s.classList.contains("stamp-flop")).toBe(false); // flop class swept too
  });

  it("a solved board never flops", () => {
    const s = stamp(); // fixture's last row is all-gold
    click(s);
    const { total } = buildReplaySteps(["xyg", "ggg"], true);
    vi.advanceTimersByTime(total + 401);
    expect(s.classList.contains("stamp-flop")).toBe(false);
  });

  // Keep last: autoPlayStampOnce flips a module-level once-per-page-load flag, so
  // any later test calling it would see a no-op.
  it("auto-play fires exactly once per page load", () => {
    autoPlayStampOnce(stamp());
    expect(cells(".stamp-cell.is-veiled")).toBe(6);
    vi.runAllTimers();
    root.innerHTML = renderStamp(["ggg"], ["FOX"]);
    autoPlayStampOnce(root.querySelector(".daily-stamp"));
    expect(cells(".is-veiled")).toBe(0); // second auto-play is a no-op (manual taps still work)
  });
});
