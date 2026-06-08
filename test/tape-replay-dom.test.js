// @vitest-environment jsdom
// test/tape-replay-dom.test.js — driver smoke: builds the stage, applies steps, timer
// shows TRUE elapsed. Steps are applied via the exported applyStep (pure-ish DOM fn)
// so the test doesn't wait on real timers.
import { describe, it, expect, beforeEach } from "vitest";
import { buildTapeStage, applyStep, fmtClock } from "../public/tape-replay.js";

describe("tape replay driver", () => {
  let mount;
  beforeEach(() => { document.body.innerHTML = "<div id='m'></div>"; mount = document.getElementById("m"); });

  it("builds a board of empty tile rows + a timer chip + controls", () => {
    const stage = buildTapeStage(mount, { rows: 6, cols: 5, grid: ["ggggg"], words: ["CRANE"] });
    expect(mount.querySelectorAll(".tape-row").length).toBe(6);
    expect(mount.querySelectorAll(".tape-row .tile").length).toBe(30);
    expect(mount.querySelector(".tape-timer")).toBeTruthy();
    expect(stage.cursor).toEqual({ row: 0, col: 0 });
  });
  it("type/back edit the current row; commit flips it with the grid mask", () => {
    const stage = buildTapeStage(mount, { rows: 6, cols: 5, grid: ["gyxxg"], words: ["CRANE"] });
    for (const l of "CRANE") applyStep(stage, { kind: "type", letter: l, trueT: 0 });
    expect(mount.querySelector(".tape-row").textContent).toBe("CRANE");
    applyStep(stage, { kind: "back", trueT: 0 });
    expect(mount.querySelector(".tape-row").textContent).toBe("CRAN");
    applyStep(stage, { kind: "type", letter: "E", trueT: 0 });
    applyStep(stage, { kind: "commit", row: 0, trueT: 9000 });
    const tiles = mount.querySelectorAll(".tape-row")[0].querySelectorAll(".tile");
    expect(tiles[0].classList.contains("hot")).toBe(true);   // g
    expect(tiles[1].classList.contains("warm")).toBe(true);  // y
    expect(tiles[2].classList.contains("cold")).toBe(true);  // x
    expect(stage.cursor.row).toBe(1);
  });
  it("think shows the true pause; timer renders true elapsed", () => {
    const stage = buildTapeStage(mount, { rows: 6, cols: 5, grid: [], words: [] });
    applyStep(stage, { kind: "think", trueMs: 72000, trueT: 72000 });
    expect(mount.querySelector(".tape-think").textContent).toContain("1m 12s");
    expect(mount.querySelector(".tape-timer").textContent).toBe(fmtClock(72000));
  });
  it("commit paints the step's row even when the cursor sits elsewhere (truncated finish)", () => {
    const stage = buildTapeStage(mount, { rows: 6, cols: 5, grid: ["ggggg", "gyxxg"], words: ["CRANE", "SLATE"] });
    // cursor is at row 0 — a truncated finish() replays a commit for row 1
    applyStep(stage, { kind: "commit", row: 1, trueT: 0 });
    const rows = mount.querySelectorAll(".tape-row");
    expect(rows[1].textContent).toBe("SLATE");
    expect(rows[1].querySelectorAll(".tile")[0].classList.contains("hot")).toBe(true);  // g
    expect(rows[1].querySelectorAll(".tile")[1].classList.contains("warm")).toBe(true); // y
    expect(rows[0].textContent).toBe(""); // cursor row untouched
    expect(stage.cursor).toEqual({ row: 2, col: 0 });
  });
  it("clear empties the current row; reject shakes it", () => {
    const stage = buildTapeStage(mount, { rows: 6, cols: 5, grid: [], words: [] });
    applyStep(stage, { kind: "type", letter: "A", trueT: 0 });
    applyStep(stage, { kind: "reject", trueT: 100 });
    expect(mount.querySelectorAll(".tape-row")[0].classList.contains("shake")).toBe(true);
    applyStep(stage, { kind: "clear", trueT: 200 });
    expect(mount.querySelectorAll(".tape-row")[0].textContent).toBe("");
  });
});
