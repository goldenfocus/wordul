import { describe, it, expect } from "vitest";
import { buildReplaySteps, TIMING } from "../public/stamp-replay-core.js";

describe("buildReplaySteps", () => {
  it("types each cell then flips it, row by row, in order", () => {
    const { steps } = buildReplaySteps(["xyg", "ggg"], true);
    const row0 = steps.filter((s) => s.row === 0);
    // 3 type + 3 flip per row
    expect(row0.filter((s) => s.kind === "type").map((s) => s.col)).toEqual([0, 1, 2]);
    expect(row0.filter((s) => s.kind === "flip").map((s) => s.col)).toEqual([0, 1, 2]);
    // within a row: every type happens before every flip
    const lastType = Math.max(...row0.filter((s) => s.kind === "type").map((s) => s.t));
    const firstFlip = Math.min(...row0.filter((s) => s.kind === "flip").map((s) => s.t));
    expect(firstFlip).toBeGreaterThanOrEqual(lastType + TIMING.TYPE_MS);
    // row 1 starts strictly after row 0's last flip
    const row1First = Math.min(...steps.filter((s) => s.row === 1).map((s) => s.t));
    const row0LastFlip = Math.max(...row0.filter((s) => s.kind === "flip").map((s) => s.t));
    expect(row1First).toBeGreaterThan(row0LastFlip);
  });

  it("colors-only boards skip the typing phase entirely", () => {
    const { steps } = buildReplaySteps(["xyg", "ggg"], false);
    expect(steps.every((s) => s.kind === "flip")).toBe(true);
    expect(steps.length).toBe(6);
  });

  it("caps a full 6-row board with letters under 8 seconds", () => {
    const grid = Array(6).fill("gygxy");
    expect(buildReplaySteps(grid, true).total).toBeLessThanOrEqual(8000);
  });

  it("empty grid → no steps, zero total", () => {
    expect(buildReplaySteps([], true)).toEqual({ steps: [], total: 0 });
    expect(buildReplaySteps(undefined, true)).toEqual({ steps: [], total: 0 });
  });
});
