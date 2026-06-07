// public/stamp-replay-core.js — condensed cinematic replay scheduler for solve
// stamps. Pure: grid in, ordered timeline of steps out. Fixed cadence (never the
// real solve timing — see the spec), so a 5-minute think still replays in ~7s.
// The DOM driver (stamp-replay.js) applies the steps; tests run on this file alone.
export const TIMING = { TYPE_MS: 80, FLIP_STAGGER_MS: 70, FLIP_MS: 260, ROW_BEAT_MS: 380 };

// grid: array of row strings ("g"/"y"/"x"). typed: whether the stamp has letters
// (typed boards type each letter in before the flip; colors-only boards just flip).
// timing: cadence override — the big-board replay (board-replay.js) passes its own so
// the flips match the live reveal instead of the stamp's miniature pace.
// Returns { steps: [{ t, row, col, kind: "type"|"flip" }], total } — t in ms.
export function buildReplaySteps(grid, typed, timing = TIMING) {
  const steps = [];
  let t = 0;
  for (let row = 0; row < (Array.isArray(grid) ? grid.length : 0); row++) {
    const cols = String(grid[row] ?? "").length;
    if (typed) for (let col = 0; col < cols; col++) { steps.push({ t, row, col, kind: "type" }); t += timing.TYPE_MS; }
    for (let col = 0; col < cols; col++) steps.push({ t: t + col * timing.FLIP_STAGGER_MS, row, col, kind: "flip" });
    t += (cols - 1) * timing.FLIP_STAGGER_MS + timing.FLIP_MS + timing.ROW_BEAT_MS;
  }
  return { steps, total: steps.length ? t - timing.ROW_BEAT_MS : 0 };
}
