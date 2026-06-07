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
// byte cap bounds abuse; "k" is checked tightly because it renders into the board.
export function validateTapeEvents(raw: unknown): TapeEvent[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TAPE_EVENT_CAP) return null;
  let prev = 0;
  for (const ev of raw) {
    if (!Array.isArray(ev) || ev.length < 2 || ev.length > 3) return null;
    const [t, kind, data] = ev as [unknown, unknown, unknown];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t < prev) return null;
    if (typeof kind !== "string" || !KINDS.has(kind)) return null;
    if (kind === "k" && !(typeof data === "string" && /^[A-Z]$/.test(data))) return null;
    prev = t;
  }
  try {
    if (JSON.stringify(raw).length > TAPE_BYTE_CAP) return null;
  } catch { return null; }
  return raw as TapeEvent[];
}
