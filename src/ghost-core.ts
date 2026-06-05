// src/ghost-core.ts — pure ghost-tape logic (unit-tested). A tape is the spectator-safe
// event stream of one seeded Arena race: length-only typing pulses, color-mask guess
// commits, and finish stamps — NEVER letters or the answer (the same hidden-word rule
// the live spectator boards follow). Recorded by the Room DO, stored on the Challenge
// DO, replayed client-side so a late visitor races the original field.
import type { Color } from "./color.ts";

export type GhostEvent =
  | { t: number; u: string; k: "typing"; len: number }
  | { t: number; u: string; k: "guess"; mask: Color[]; status: "playing" | "won" | "lost" }
  | { t: number; u: string; k: "finish"; status: "won" | "lost"; guesses: number };

export type GhostTape = {
  v: 1;
  wordLength: number;
  maxGuesses: number;
  players: { username: string; host: boolean }[]; // host = the original human racer
  events: GhostEvent[];                           // ascending t (ms since GO)
};

// Backstop only — a real race is a few hundred events.
export const TAPE_EVENT_CAP = 5000;

export function newTape(
  wordLength: number,
  maxGuesses: number,
  players: { username: string; host: boolean }[],
): GhostTape {
  return { v: 1, wordLength, maxGuesses, players, events: [] };
}

// Append, clamping a skewed clock so t stays monotonic, dropping past the cap.
export function tapePush(tape: GhostTape, ev: GhostEvent): void {
  if (tape.events.length >= TAPE_EVENT_CAP) return;
  const last = tape.events[tape.events.length - 1];
  if (last && ev.t < last.t) ev.t = last.t;
  tape.events.push(ev);
}

// Re-cut a stored solveGrid ("g"/"y"/"x" rows, the profile's colors-only record) into a
// cadence-paced ghost tape — the dual-replay half of a wiki word challenge. No commit
// times survive in a GameRecord, so pacing is synthetic (same constants as the client's
// owner-tape). Masks only, like every tape. Malformed rows → null, never a corrupt tape.
const CELL_COLOR: Record<string, Color> = { g: "hot", y: "warm", x: "cold" };
const FIRST_GUESS_MS = 4500;
const GAP_MS = 7000;

export function tapeFromSolveGrid(args: {
  username: string;
  wordLength: number;
  maxGuesses: number;
  solveGrid: string[];
  won: boolean;
}): GhostTape | null {
  const { username, wordLength, maxGuesses, solveGrid, won } = args;
  if (!Array.isArray(solveGrid) || solveGrid.length === 0 || solveGrid.length > maxGuesses) return null;
  const tape = newTape(wordLength, maxGuesses, [{ username, host: true }]);
  let t = 0;
  for (let i = 0; i < solveGrid.length; i++) {
    const row = solveGrid[i];
    if (typeof row !== "string" || row.length !== wordLength) return null;
    const mask: Color[] = [];
    for (const cell of row) {
      const c = CELL_COLOR[cell];
      if (!c) return null;
      mask.push(c);
    }
    t += i === 0 ? FIRST_GUESS_MS : GAP_MS;
    const last = i === solveGrid.length - 1;
    tapePush(tape, { t, u: username, k: "guess", mask, status: last ? (won ? "won" : "lost") : "playing" });
  }
  tapePush(tape, { t, u: username, k: "finish", status: won ? "won" : "lost", guesses: solveGrid.length });
  return tape;
}
