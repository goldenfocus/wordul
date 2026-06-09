// public/board-replay.js — your finished daily board plays itself back.
// On a cold render of an already-finished daily (page load / return visit) the big
// board re-types each guess and flips the rows with the signature live reveal,
// instead of sitting there flat. Same condensed-cinematic scheduler as the solve
// stamps (stamp-replay-core), driven at the big tiles' own cadence. Tap → snap to
// the final board. Zero new CSS: it reuses .tile.filled/.pop/.reveal + color classes.
import { buildReplaySteps } from "/stamp-replay-core.js";

// The big board's cadence: flips match the live reveal (110ms stagger, 0.4s flip,
// color swap at the edge-on halfway point) so the replay feels like the game being
// played, not a blown-up stamp. Typing + row beats are tighter than the stamp's —
// the flips alone eat 840ms/row — keeping a full 6×5 board under the stamps' 8s cap.
export const TIMING = { TYPE_MS: 65, FLIP_STAGGER_MS: 110, FLIP_MS: 400, ROW_BEAT_MS: 180 };
const FLIP_HALF_MS = 200; // matches the tile-reveal keyframe halfway point (0.4s flip)
const COLORS = ["hot", "warm", "cold"];

let run = null; // { timers, gridEl, guesses } — at most one own-board replay at a time

export function boardReplayActive() { return !!run; }

// The ◆ Dare ◆ pill fades while the board replays and re-lights when it lands
// (dare-pill.js). board-replay is the single place that knows both edges — a replay
// only starts after the reduced-motion/empty guards, and finishBoardReplay is the one
// completion point (natural end AND tap-to-snap). Guarded for non-DOM imports/tests.
function emit(name) {
  if (typeof document !== "undefined" && typeof CustomEvent === "function") {
    document.dispatchEvent(new CustomEvent(name));
  }
}

function eachGuessTile(gridEl, guesses, fn) {
  const rows = gridEl.querySelectorAll(".grid-row");
  guesses.forEach((guess, r) => {
    const tiles = rows[r] ? rows[r].children : [];
    for (let c = 0; c < guess.word.length && c < tiles.length; c++) fn(tiles[c], guess, c);
  });
}

// Snap to the final board: cancel timers, paint every tile its settled state.
// (Doubles as the tap-to-skip click handler — the event arg is ignored.)
export function finishBoardReplay() {
  if (!run) return;
  const { timers, gridEl, guesses } = run;
  run = null;
  timers.forEach(clearTimeout);
  gridEl.removeEventListener("click", finishBoardReplay);
  eachGuessTile(gridEl, guesses, (tile, guess, c) => {
    tile.classList.remove("filled", "pop", "reveal", ...COLORS);
    tile.classList.add(guess.mask[c]);
    tile.textContent = guess.word[c];
  });
  emit("daily-board-replay-done"); // → re-light the Dare pill
}

export function playBoardReplay(gridEl, guesses) {
  finishBoardReplay(); // a re-trigger snaps any in-flight run to final first
  // Reduced motion: the final board is already on screen; don't animate it away.
  // (typeof guard: jsdom has no matchMedia — tests stub it, but don't require it.)
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!gridEl || !guesses?.length) return;
  emit("daily-board-replay-start"); // → fade the Dare pill while the board replays
  // The scheduler only needs cols-per-row for timing; colors come straight off guesses.
  const { steps, total } = buildReplaySteps(guesses.map((g) => "x".repeat(g.word.length)), true, TIMING);
  // Veil: strip color + letter so the board starts blank, exactly like live play did.
  eachGuessTile(gridEl, guesses, (tile) => {
    tile.classList.remove("filled", "pop", "reveal", ...COLORS);
    tile.textContent = "";
  });
  const rows = gridEl.querySelectorAll(".grid-row");
  const timers = steps.map((s) => setTimeout(() => {
    const tile = rows[s.row]?.children?.[s.col];
    const guess = guesses[s.row];
    if (!tile || !guess || !run) return;
    if (s.kind === "type") {
      tile.textContent = guess.word[s.col];
      tile.classList.add("filled", "pop");
    } else {
      // Per-cell flip at the step's own time — no --reveal-delay; the scheduler staggers.
      tile.classList.add("reveal");
      run.timers.push(setTimeout(() => { // color swap while the tile is edge-on
        tile.classList.remove("filled");
        tile.classList.add(guess.mask[s.col]);
      }, FLIP_HALF_MS));
    }
  }, s.t));
  timers.push(setTimeout(finishBoardReplay, total + 100)); // sweep transient classes
  run = { timers, gridEl, guesses };
  gridEl.addEventListener("click", finishBoardReplay); // tap mid-replay → snap to final
}

// The auto-trigger plays ONCE per page load (never a loop, never twice — even across
// SPA navigations back to the daily). Mirrors autoPlayStampOnce on the home recap.
let autoPlayed = false;
export function autoPlayBoardOnce(gridEl, guesses) {
  if (autoPlayed) return;
  autoPlayed = true;
  playBoardReplay(gridEl, guesses);
}
