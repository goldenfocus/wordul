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
