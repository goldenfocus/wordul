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
    const n = steps.length;
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
    // The step CARRYING the THINK_MS dt is the think beat — mark it fixed too, or
    // the driver divides the beat at 2x/4x (the think step itself has dt 0).
    if (gap > GAP_MS && steps.length > n) steps[n].fixed = true;
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

const V_KEYS = ["raw", "text", "answer", "revealVoice", "voice"];

// Client-side mirror of the server's v-payload checks (src/tape-core.ts) — the tape
// is another player's upload, so the descriptor is re-checked before it reaches
// /voice.js (defense in depth). Returns a clean line or null (the driver skips).
export function sanitizeVoiceLine(line) {
  if (typeof line !== "object" || line === null || Array.isArray(line)) return null;
  for (const k of Object.keys(line)) if (!V_KEYS.includes(k)) return null;
  const { raw, text, answer, revealVoice, voice } = line;
  if (typeof raw !== "string" || raw.length > 300) return null;
  if (typeof text !== "string" || text.length > 300) return null;
  if (answer !== undefined && !(typeof answer === "string" && answer.length <= 64)) return null;
  if (revealVoice !== undefined && revealVoice !== "robot" && revealVoice !== "split") return null;
  const v = sanitizeVoice(voice);
  if (!v) return null;
  return { raw, text, voice: v, revealVoice, answer };
}

// silent | ai (bounded prosody) | clips — clipBase must be a same-origin absolute
// path: leading "/", never "//" (protocol-relative URL!), no "..".
function sanitizeVoice(v) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const keys = Object.keys(v);
  if (v.mode === "silent") return keys.length === 1 ? { mode: "silent" } : null;
  if (v.mode === "ai") {
    for (const k of keys) if (k !== "mode" && k !== "voiceName" && k !== "rate" && k !== "pitch") return null;
    const { voiceName, rate, pitch } = v;
    if (voiceName !== undefined && !(typeof voiceName === "string" && voiceName.length <= 64)) return null;
    if (rate !== undefined && !(typeof rate === "number" && Number.isFinite(rate) && rate >= 0.1 && rate <= 4)) return null;
    if (pitch !== undefined && !(typeof pitch === "number" && Number.isFinite(pitch) && pitch >= 0 && pitch <= 2)) return null;
    return { mode: "ai", voiceName, rate, pitch };
  }
  if (v.mode === "clips") {
    if (keys.length !== 2 || typeof v.clipBase !== "string") return null;
    const b = v.clipBase;
    // backslash normalizes to a slash in browser URL parsing ("/\evil.com/" → "//evil.com/")
    if (b.length > 128 || !b.startsWith("/") || b.startsWith("//") || b.includes("..") || b.includes("\\")) return null;
    return { mode: "clips", clipBase: b };
  }
  return null;
}
