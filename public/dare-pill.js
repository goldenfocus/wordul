// public/dare-pill.js — the ◆ Dare ◆ pill's faded→lit activation (spec 2026-06-09).
// The pill is lifted out of the daily card into the board↔card gap. It rests LIT by
// default (markup ships `is-lit`), so a finish with no board replay — reduced motion,
// or a revisit after the once-per-page-load replay already fired — never sits faded.
// It ARMS (fades to a drained gold outline) only while a board replay is actually
// animating, and re-LIGHTS (fill + glow) the instant the replay lands. Both edges are
// dispatched by board-replay.js, the single owner of the replay lifecycle.
const BTN_ID = "dailyShareBtn";

function pill() {
  return typeof document !== "undefined" ? document.getElementById(BTN_ID) : null;
}
function arm() { const b = pill(); if (b) { b.classList.add("is-armed"); b.classList.remove("is-lit"); } }
function lite() { const b = pill(); if (b) { b.classList.remove("is-armed"); b.classList.add("is-lit"); } }

let wired = false;
// Attach once. Idempotent — safe to call from every renderDailyUnlock and from boot.
export function initDarePillActivation() {
  if (wired || typeof document === "undefined") return;
  wired = true;
  document.addEventListener("daily-board-replay-start", arm);
  document.addEventListener("daily-board-replay-done", lite);
}
