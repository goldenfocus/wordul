// @vitest-environment jsdom
// Integration: a finished daily board → board-replay veils, types, flips, and
// restores the big tiles. The fixture mirrors renderBoards' markup (.grid >
// .grid-row > .tile + hot/warm/cold classes) so a drift between app.js and
// board-replay.js fails here, not in prod.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { playBoardReplay, finishBoardReplay, boardReplayActive, autoPlayBoardOnce, TIMING } from "../public/board-replay.js";
import { buildReplaySteps } from "../public/stamp-replay-core.js";

const GUESSES = [
  { word: "MANGO", mask: ["cold", "cold", "cold", "hot", "warm"] },
  { word: "GOLLY", mask: ["hot", "hot", "hot", "hot", "hot"] },
];

// renderBoards-shaped board: maxGuesses rows, played rows painted flat.
function buildGrid(guesses, rows = 6, cols = 5) {
  const grid = document.createElement("div");
  grid.className = "grid";
  for (let r = 0; r < rows; r++) {
    const row = document.createElement("div");
    row.className = "grid-row";
    for (let c = 0; c < cols; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      const g = guesses[r];
      if (g) { tile.classList.add(g.mask[c]); tile.textContent = g.word[c]; }
      row.appendChild(tile);
    }
    grid.appendChild(row);
  }
  return grid;
}

let reduced = false;
let grid;
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  window.matchMedia = () => ({ matches: reduced });
  finishBoardReplay(); // sweep any run a prior test left behind
  grid = buildGrid(GUESSES);
  document.body.replaceChildren(grid);
});

const colored = () => grid.querySelectorAll(".tile.hot, .tile.warm, .tile.cold").length;
const lettered = () => [...grid.querySelectorAll(".tile")].filter((t) => t.textContent).length;
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("board replay driver", () => {
  it("veils played tiles, then restores the exact final board", () => {
    playBoardReplay(grid, GUESSES);
    expect(colored()).toBe(0); // both played rows blanked; empty rows untouched
    expect(lettered()).toBe(0);
    expect(boardReplayActive()).toBe(true);
    vi.runAllTimers();
    expect(boardReplayActive()).toBe(false);
    expect(colored()).toBe(10);
    expect(lettered()).toBe(10);
    const row0 = grid.querySelectorAll(".grid-row")[0].children;
    expect(row0[3].classList.contains("hot")).toBe(true);
    expect(row0[4].classList.contains("warm")).toBe(true);
    expect(row0[0].textContent).toBe("M");
    expect(grid.querySelectorAll(".reveal, .filled, .pop").length).toBe(0); // transient classes swept
  });

  it("types the row's letters (no colors) before the flips land", () => {
    playBoardReplay(grid, GUESSES);
    vi.advanceTimersByTime(5 * TIMING.TYPE_MS - 1); // row 0 fully typed; first flip not yet
    expect(lettered()).toBe(5);
    expect(grid.querySelectorAll(".tile.filled").length).toBe(5);
    expect(colored()).toBe(0);
    vi.runAllTimers();
  });

  it("flips reuse the signature reveal: color swaps at the edge-on halfway point", () => {
    playBoardReplay(grid, GUESSES);
    const firstFlip = buildReplaySteps(["xxxxx", "xxxxx"], true, TIMING).steps.find((s) => s.kind === "flip");
    vi.advanceTimersByTime(firstFlip.t + 1);
    const tile = grid.querySelectorAll(".grid-row")[0].children[0];
    expect(tile.classList.contains("reveal")).toBe(true);
    expect(tile.classList.contains("cold")).toBe(false); // still edge-approaching
    vi.advanceTimersByTime(200); // FLIP_HALF_MS
    expect(tile.classList.contains("cold")).toBe(true);
    vi.runAllTimers();
  });

  it("tap mid-replay snaps straight to the final board", () => {
    playBoardReplay(grid, GUESSES);
    vi.advanceTimersByTime(TIMING.TYPE_MS);
    click(grid);
    expect(boardReplayActive()).toBe(false);
    expect(colored()).toBe(10);
    expect(lettered()).toBe(10);
  });

  it("prefers-reduced-motion leaves the flat board alone", () => {
    reduced = true;
    playBoardReplay(grid, GUESSES);
    expect(colored()).toBe(10);
    expect(boardReplayActive()).toBe(false);
  });

  it("a re-trigger snaps the in-flight run before starting over", () => {
    playBoardReplay(grid, GUESSES);
    vi.advanceTimersByTime(TIMING.TYPE_MS * 2);
    playBoardReplay(grid, GUESSES);
    expect(colored()).toBe(0); // freshly veiled, not half-typed leftovers
    vi.runAllTimers();
    expect(colored()).toBe(10);
  });

  // The Dare pill listens for these to fade (armed) while the board replays and
  // re-light when it lands. board-replay is the single source for both edges.
  it("dispatches start when a replay begins and done when it lands", () => {
    const seen = [];
    const onStart = () => seen.push("start");
    const onDone = () => seen.push("done");
    document.addEventListener("daily-board-replay-start", onStart);
    document.addEventListener("daily-board-replay-done", onDone);
    playBoardReplay(grid, GUESSES);
    expect(seen).toEqual(["start"]);
    vi.runAllTimers();
    expect(seen).toEqual(["start", "done"]);
    document.removeEventListener("daily-board-replay-start", onStart);
    document.removeEventListener("daily-board-replay-done", onDone);
  });

  it("dispatches done once when a tap snaps the replay to final", () => {
    const done = vi.fn();
    document.addEventListener("daily-board-replay-done", done);
    playBoardReplay(grid, GUESSES);
    vi.advanceTimersByTime(TIMING.TYPE_MS);
    click(grid);
    expect(done).toHaveBeenCalledTimes(1);
    document.removeEventListener("daily-board-replay-done", done);
  });

  it("reduced motion dispatches neither edge — no replay ran, so the pill stays lit", () => {
    reduced = true;
    const ev = vi.fn();
    document.addEventListener("daily-board-replay-start", ev);
    document.addEventListener("daily-board-replay-done", ev);
    playBoardReplay(grid, GUESSES);
    expect(ev).not.toHaveBeenCalled();
    document.removeEventListener("daily-board-replay-start", ev);
    document.removeEventListener("daily-board-replay-done", ev);
  });

  // Keep last: autoPlayBoardOnce flips a module-level once-per-page-load flag, so
  // any later test calling it would see a no-op.
  it("auto-play fires exactly once per page load", () => {
    autoPlayBoardOnce(grid, GUESSES);
    expect(boardReplayActive()).toBe(true);
    vi.runAllTimers();
    autoPlayBoardOnce(grid, GUESSES);
    expect(boardReplayActive()).toBe(false); // second auto-play is a no-op
  });
});
