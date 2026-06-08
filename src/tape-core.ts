// src/tape-core.ts — pure validation for an uploaded solve tape (unit-tested).
// A tape is the keystroke-level record of one daily solve, recorded client-side
// (public/tape-recorder.js) and stored on the Room DO under `tape:<username>` —
// a SEPARATE storage key, never inside room state, so snapshots stay light.
// Served only behind the finisher token (same gate as real letter rows).

export const TAPE_EVENT_CAP = 5000;       // mirrors the client cap (ghost-core precedent)
export const TAPE_BYTE_CAP = 32 * 1024;   // serialized backstop

export type TapeEvent = [number, string, ...unknown[]];

const KINDS = new Set(["k", "b", "c", "e", "r", "s", "p", "v"]);

// Returns the events array if valid, else null. Per-kind checks stay light — the
// byte cap bounds abuse; "k" is checked tightly because it renders into the board,
// "v"/"p" tightly because their payloads reach the viewer's audio path (SSRF surface).
export function validateTapeEvents(raw: unknown): TapeEvent[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TAPE_EVENT_CAP) return null;
  let prev = 0;
  for (const ev of raw) {
    if (!Array.isArray(ev) || ev.length < 2 || ev.length > 3) return null;
    const [t, kind, data] = ev as [unknown, unknown, unknown];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t < prev) return null;
    if (typeof kind !== "string" || !KINDS.has(kind)) return null;
    if (kind === "k" && !(typeof data === "string" && /^[A-Z]$/.test(data))) return null;
    if (kind === "p" && !(typeof data === "string" && data.length <= 64)) return null;
    if (kind === "v" && !validVoiceLine(data)) return null;
    prev = t;
  }
  try {
    if (JSON.stringify(raw).length > TAPE_BYTE_CAP) return null;
  } catch { return null; }
  return raw as TapeEvent[];
}

const V_KEYS = new Set(["raw", "text", "answer", "revealVoice", "voice"]);

// A "v" payload replays through the viewer's audio path — shape-check it hard.
// Extra keys reject (keep the surface tight). Mirrored client-side by
// sanitizeVoiceLine in public/tape-replay-core.js (defense in depth).
function validVoiceLine(data: unknown): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  for (const k of Object.keys(d)) if (!V_KEYS.has(k)) return false;
  if (typeof d.raw !== "string" || d.raw.length > 300) return false;
  if (typeof d.text !== "string" || d.text.length > 300) return false;
  if (d.answer !== undefined && !(typeof d.answer === "string" && d.answer.length <= 64)) return false;
  if (d.revealVoice !== undefined && d.revealVoice !== "robot" && d.revealVoice !== "split") return false;
  return validVoiceDescriptor(d.voice);
}

// silent | ai (bounded prosody) | clips — clipBase must be a same-origin absolute
// path: leading "/", never "//" (protocol-relative URL!), no "..".
function validVoiceDescriptor(v: unknown): boolean {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const d = v as Record<string, unknown>;
  const keys = Object.keys(d);
  if (d.mode === "silent") return keys.length === 1;
  if (d.mode === "ai") {
    for (const k of keys) if (k !== "mode" && k !== "voiceName" && k !== "rate" && k !== "pitch") return false;
    if (d.voiceName !== undefined && !(typeof d.voiceName === "string" && d.voiceName.length <= 64)) return false;
    if (d.rate !== undefined && !(typeof d.rate === "number" && Number.isFinite(d.rate) && d.rate >= 0.1 && d.rate <= 4)) return false;
    if (d.pitch !== undefined && !(typeof d.pitch === "number" && Number.isFinite(d.pitch) && d.pitch >= 0 && d.pitch <= 2)) return false;
    return true;
  }
  if (d.mode === "clips") {
    if (keys.length !== 2 || !keys.includes("clipBase")) return false;
    const b = d.clipBase;
    return typeof b === "string" && b.length <= 128 &&
      b.startsWith("/") && !b.startsWith("//") && !b.includes("..");
  }
  return false;
}
