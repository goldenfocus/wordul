// @vitest-environment jsdom
// The ◆ Dare ◆ pill's faded→lit activation. It rests LIT by default (so a finish with
// no board replay — reduced motion, or a revisit after the once-per-load replay already
// fired — never sits faded). It arms (fades) only while a replay is actually animating,
// and re-lights on the replay-done edge. Both edges come from board-replay.js events.
import { describe, it, expect, beforeEach } from "vitest";
import { initDarePillActivation } from "../public/dare-pill.js";

beforeEach(() => {
  document.body.innerHTML = '<button id="dailyShareBtn" class="daily-dare is-lit"></button>';
});

const fire = (name) => document.dispatchEvent(new CustomEvent(name));

describe("dare pill activation", () => {
  it("arms the pill on replay start and re-lights it on replay done", () => {
    initDarePillActivation();
    const btn = document.getElementById("dailyShareBtn");
    fire("daily-board-replay-start");
    expect(btn.classList.contains("is-armed")).toBe(true);
    expect(btn.classList.contains("is-lit")).toBe(false);
    fire("daily-board-replay-done");
    expect(btn.classList.contains("is-lit")).toBe(true);
    expect(btn.classList.contains("is-armed")).toBe(false);
  });

  it("leaves the pill lit when no replay runs (default markup state)", () => {
    initDarePillActivation();
    const btn = document.getElementById("dailyShareBtn");
    expect(btn.classList.contains("is-lit")).toBe(true);
    expect(btn.classList.contains("is-armed")).toBe(false);
  });

  it("re-lights on done even if the start edge was missed (no stuck-faded state)", () => {
    initDarePillActivation();
    const btn = document.getElementById("dailyShareBtn");
    btn.classList.add("is-armed"); // pretend it armed before the listener saw it
    btn.classList.remove("is-lit");
    fire("daily-board-replay-done");
    expect(btn.classList.contains("is-lit")).toBe(true);
    expect(btn.classList.contains("is-armed")).toBe(false);
  });
});
