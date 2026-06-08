// public/tape-replay-core.js — pure scheduler for the REAL solve replay (the deep-dive
// mode; the synthetic skim replay stays stamp-replay-core.js). Raw tape events in,
// ordered steps out. Real relative rhythm, except a gap > GAP_MS compresses into ONE
// fixed think beat carrying the true duration ("💭 thinking… 1m12s"). Each step also
// carries trueT (the original clock) so the driver's timer chip shows TRUE elapsed.
// Steps: {dt, trueT, kind, ...} — dt = ms after the previous step; the driver divides
// dt by the speed multiplier EXCEPT when fixed:true (think beats stay one beat at 4x).
// An "e" submit commits a row unless an "r" arrives before the next k/b/c/e (the
// reject path); rejected rows emit nothing on the e — the r's shake + the taped "c"
// sweep tell the story, exactly like live play.
export const GAP_MS = 3000;   // a pause longer than this is a "think"
export const THINK_MS = 1200; // every think plays as one fixed beat

export function buildTapeSchedule(events) {
  const steps = [];
  let prevTrue = 0;
  let playT = 0;
  let row = 0;
  const evs = Array.isArray(events) ? events : [];
  for (let i = 0; i < evs.length; i++) {
    const [t, kind, data] = evs[i];
    const gap = Math.max(0, t - prevTrue);
    let dt = gap;
    if (gap > GAP_MS) {
      steps.push({ dt: 0, trueT: prevTrue, kind: "think", trueMs: gap, fixed: true });
      dt = THINK_MS;
    }
    prevTrue = t;
    playT += dt;
    // "s" (solved flag) is reserved/unused by the recorder — the validator accepts
    // it for forward-compat; this scheduler simply drops it (no matching branch).
    if (kind === "k") steps.push({ dt, trueT: t, kind: "type", letter: data });
    else if (kind === "b") steps.push({ dt, trueT: t, kind: "back" });
    else if (kind === "c") steps.push({ dt, trueT: t, kind: "clear" });
    else if (kind === "r") steps.push({ dt, trueT: t, kind: "reject" });
    else if (kind === "p") steps.push({ dt, trueT: t, kind: "power", what: data });
    else if (kind === "v") steps.push({ dt, trueT: t, kind: "voice", line: data });
    else if (kind === "e") {
      if (rejected(evs, i)) emitNoop(steps, dt, t);
      else steps.push({ dt, trueT: t, kind: "commit", row: row++ });
    }
  }
  return { steps, totalMs: playT, trueMs: prevTrue };
}

// An e is rejected iff an r appears before the next k/b/c/e.
function rejected(evs, i) {
  for (let j = i + 1; j < evs.length; j++) {
    const k = evs[j][1];
    if (k === "r") return true;
    if (k === "k" || k === "b" || k === "c" || k === "e") return false;
  }
  return false;
}

// A rejected e still spends its dt on the clock — emit a noop step that carries the
// dt/trueT so playback timing stays aligned; the driver skips it visually.
function emitNoop(steps, dt, t) {
  steps.push({ dt, trueT: t, kind: "noop" });
}
