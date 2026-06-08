// public/tape-recorder.js — records the real daily solve as a compact event tape:
// every letter, backspace, clear, submit, reject, power-up, and companion line, with
// ms offsets from recording start. Uploaded ONCE on finish (app.js sends {type:"tape"});
// the server stores it behind the finisher-token gate. Mirrored to localStorage every
// few events so a crashed tab can still file its tape on the next visit.
// Pattern: src/ghost-core.ts (cap + monotonic clamp), kept DOM-free for tests.
export const TAPE_EVENT_CAP = 5000; // backstop — a real solve is a few hundred events
// Deliberately UNDER the server's 32KB TAPE_BYTE_CAP (src/tape-core.ts): the server
// rejects oversize tapes wholesale, so the recorder must stop first — a tape that
// passes the recorder can never bounce off the validator and be lost.
export const TAPE_BYTE_CAP = 30 * 1024;
const MIRROR_EVERY = 10;            // localStorage flush cadence (events)
const LS_PREFIX = "wr.tape:";

export function newTape(now = Date.now()) {
  return { v: 1, t0: now, truncated: false, events: [], bytes: 2 }; // 2 = "[]" envelope
}

// Append [t, kind, data?]: clamp a skewed clock so t stays monotonic, drop past the
// event cap OR the byte cap (approximate running serialized size of `events`).
export function tapePush(tape, kind, data, now = Date.now()) {
  if (tape.truncated) return;
  if (tape.events.length >= TAPE_EVENT_CAP) { tape.truncated = true; return; }
  let t = Math.max(0, now - tape.t0);
  const last = tape.events[tape.events.length - 1];
  if (last && t < last[0]) t = last[0];
  const event = data === undefined ? [t, kind] : [t, kind, data];
  tape.bytes ??= JSON.stringify(tape.events).length; // tape predates the field — recompute
  const eventBytes = JSON.stringify(event).length + 1; // +1 = joining comma
  if (tape.bytes + eventBytes > TAPE_BYTE_CAP) { tape.truncated = true; return; }
  tape.bytes += eventBytes;
  tape.events.push(event);
}

// --- the live singleton app.js records into -----------------------------------
let live = null; // { tape, key, dirty }

function readMirror(date) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + date);
    const tape = raw ? JSON.parse(raw) : null;
    return tape && Array.isArray(tape.events) ? tape : null;
  } catch { return null; }
}

// Start (or resume) recording for a date. A same-day mirror means the tab reloaded
// mid-game — resume from it so the early guesses aren't lost; t0 shifts so new events
// stay monotonic after the mirrored ones.
export function tapeStart(date, now = Date.now()) {
  const mirror = readMirror(date);
  const tape = mirror ?? newTape(now);
  if (mirror) {
    const lastT = mirror.events.length ? mirror.events[mirror.events.length - 1][0] : 0;
    tape.t0 = now - lastT; // new events land at >= lastT
    tape.bytes ??= JSON.stringify(tape.events).length; // mirror predates the byte cap — recompute
  }
  live = { tape, key: LS_PREFIX + date, dirty: 0 };
}

export function tapeIsLive() { return !!live; }

// Record one event. Wrapped so a recorder bug can NEVER break gameplay.
export function tapeRecord(kind, data, now = Date.now()) {
  if (!live) return;
  try {
    tapePush(live.tape, kind, data, now);
    if (++live.dirty >= MIRROR_EVERY) {
      live.dirty = 0;
      localStorage.setItem(live.key, JSON.stringify(live.tape));
    }
  } catch { /* never throw into the input path */ }
}

// The finish hand-off: return the tape to upload (live recording, else a crash
// mirror from an earlier tab), and clear both — the upload is one-shot.
export function tapeForUpload(date) {
  try {
    const tape = live && live.key === LS_PREFIX + date ? live.tape : readMirror(date);
    live = null;
    localStorage.removeItem(LS_PREFIX + date);
    if (!tape || !tape.events.length) return null;
    return { events: tape.events, truncated: !!tape.truncated };
  } catch { return null; }
}

// Leaving a room must stop recording — otherwise the next room's keystrokes pollute
// this tape — WITHOUT losing the crash mirror: a re-join resumes from it via tapeStart's
// mirror path. Flush the buffered tail first so the mirror is complete.
export function tapeSuspend() {
  if (!live) return;
  try { localStorage.setItem(live.key, JSON.stringify(live.tape)); } catch { /* ignore */ }
  live = null;
}

export function tapeMirror(date) { return readMirror(date); }
export function tapeClear(date) {
  live = null;
  try { localStorage.removeItem(LS_PREFIX + date); } catch { /* ignore */ }
}
