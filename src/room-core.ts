// Pure decision logic for the race-end boom + rematch handshake. No DO, no I/O —
// the RoomDurableObject is a thin shell that calls these. Mirrors arena-core.ts
// (apply(state, event) + constants), so every transition is unit-testable.

import type { PlayerState } from "./types.ts";

// --- Tunables (Arena family; see the `arena-tunables` memory) ----------------
export const REMATCH_TIMEOUT_MS = 15_000;   // a pending proposal auto-cancels after this
export const BOT_REMATCH_MIN_MS = 3_000;    // bot "thinking" window, low end
export const BOT_REMATCH_MAX_MS = 9_000;    // bot "thinking" window, high end
export const BOT_REMATCH_ACCEPT_P = 0.8;    // P(bot says yes)

// --- Slice 1: first-solve ends the race --------------------------------------
// Given the players and the username who just became the FIRST winner, return the
// usernames of everyone still `playing` who must flip to `lost` ("outpaced").
// Pure; the caller mutates status + emits the per-player finish.
export function outpacedLosers(players: PlayerState[], winner: string): string[] {
  return players
    .filter((p) => p.status === "playing" && p.username !== winner)
    .map((p) => p.username);
}
