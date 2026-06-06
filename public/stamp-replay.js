// public/stamp-replay.js — click a solve stamp → it plays itself back.
// Reads the board straight off the rendered .daily-stamp DOM (color classes +
// letters), so every render site — home recap, featured leaderboard card,
// profile recent games — gets replay for free with zero data plumbing.
// One delegated listener wires the whole app (wireStampReplays in app.js).
import { buildReplaySteps } from "/stamp-replay-core.js";

const playing = new WeakMap(); // stampEl -> { timers, cells }

// Grid + per-row cell elements off the DOM. Pad rows (is-empty) are skipped.
function stampBoard(stamp) {
  const grid = [], cells = [];
  for (const rowEl of stamp.querySelectorAll(".stamp-row")) {
    const rowCells = Array.from(rowEl.querySelectorAll(".stamp-cell"));
    if (!rowCells.length || rowCells[0].classList.contains("is-empty")) continue;
    grid.push(rowCells.map((c) =>
      c.classList.contains("is-correct") ? "g" : c.classList.contains("is-present") ? "y" : "x").join(""));
    cells.push(rowCells);
  }
  return { grid, cells };
}

// Snap to the final board: cancel timers, strip every replay class.
function finish(stamp) {
  const run = playing.get(stamp);
  if (!run) return;
  run.timers.forEach(clearTimeout);
  run.cells.flat().forEach((c) => c.classList.remove("is-veiled", "is-typed", "stamp-pop"));
  playing.delete(stamp);
}

function play(stamp) {
  if (playing.has(stamp)) { finish(stamp); return; } // tap mid-replay → snap to final
  // Reduced motion: the final board is already on screen; don't animate it away.
  // (typeof guard: jsdom has no matchMedia — tests stub it, but don't require it.)
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { grid, cells } = stampBoard(stamp);
  if (!grid.length) return;
  const { steps, total } = buildReplaySteps(grid, stamp.classList.contains("has-letters"));
  cells.flat().forEach((c) => c.classList.add("is-veiled"));
  const timers = steps.map((s) => setTimeout(() => {
    const cell = cells[s.row]?.[s.col];
    if (!cell) return;
    if (s.kind === "type") cell.classList.add("is-typed");
    else { cell.classList.remove("is-veiled", "is-typed"); cell.classList.add("stamp-pop"); }
  }, s.t));
  timers.push(setTimeout(() => finish(stamp), total + 400)); // sweep pop classes
  playing.set(stamp, { timers, cells });
}

// Discovery: most people never find tap-to-replay on their own, so the home recap
// plays itself ONCE per page load (never a loop, never twice — even across SPA
// navigations back home). Manual taps stay unlimited.
let autoPlayed = false;
export function autoPlayStampOnce(stamp) {
  if (autoPlayed) return;
  autoPlayed = true;
  play(stamp);
}

// One delegated listener covers every stamp the app ever renders (the featured
// card and profile lists re-render their stamps freely — nothing to re-wire).
export function wireStampReplays(root = document) {
  root.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return; // @name links etc. keep their meaning
    const stamp = e.target.closest(".daily-stamp");
    if (stamp) play(stamp);
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const stamp = e.target.closest && e.target.closest(".daily-stamp");
    if (stamp) { e.preventDefault(); play(stamp); }
  });
}
