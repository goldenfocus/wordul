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

// --- Slices 2–3: the rematch handshake reducer -------------------------------
export type RematchState = { proposer: string; deadline: number } | null;

export type RematchInput =
  | { kind: "propose"; from: string; opponentIsBot: boolean; now: number }
  | { kind: "accept"; from: string }
  | { kind: "decline"; from: string }
  | { kind: "left" }
  | { kind: "bot_decision"; accept: boolean; bot: string }
  | { kind: "timeout" };

export type RematchEffect =
  | { kind: "proposed"; proposer: string }
  | { kind: "accepted"; by: string }
  | { kind: "cancelled"; reason: "declined" | "timeout" | "left" }
  | { kind: "start" }            // DO calls runStart()
  | { kind: "schedule_bot" }     // DO arms botRematchAt = now + random(MIN..MAX)
  | { kind: "schedule_timeout" } // DO arms rematchTimeoutAt = now + REMATCH_TIMEOUT_MS
  | { kind: "bot_leaves" };      // DO removes the bot from players

export type RematchResult = { rematch: RematchState; effects: RematchEffect[] };

// Reduce one handshake event into the next pending-proposal state + the side
// effects the DO must run. Deterministic — the bot's 80/20 roll and the random
// decision delay are decided OUTSIDE (botAccepts(roll), schedule_bot) and passed in.
export function rematchReduce(state: RematchState, input: RematchInput): RematchResult {
  switch (input.kind) {
    case "propose": {
      if (state) {
        // A proposal already pending from the OTHER side ⇒ mutual want ⇒ start once.
        if (state.proposer !== input.from) {
          return { rematch: null, effects: [{ kind: "accepted", by: input.from }, { kind: "start" }] };
        }
        return { rematch: state, effects: [] }; // same proposer re-tapping: no-op
      }
      const rematch = { proposer: input.from, deadline: input.now + REMATCH_TIMEOUT_MS };
      const effects: RematchEffect[] = [{ kind: "proposed", proposer: input.from }, { kind: "schedule_timeout" }];
      if (input.opponentIsBot) effects.push({ kind: "schedule_bot" });
      return { rematch, effects };
    }
    case "accept": {
      if (!state || state.proposer === input.from) return { rematch: state, effects: [] };
      return { rematch: null, effects: [{ kind: "accepted", by: input.from }, { kind: "start" }] };
    }
    case "decline":
      if (!state) return { rematch: null, effects: [] };
      return { rematch: null, effects: [{ kind: "cancelled", reason: "declined" }] };
    case "timeout":
      if (!state) return { rematch: null, effects: [] };
      return { rematch: null, effects: [{ kind: "cancelled", reason: "timeout" }] };
    case "left":
      if (!state) return { rematch: null, effects: [] };
      return { rematch: null, effects: [{ kind: "cancelled", reason: "left" }] };
    case "bot_decision":
      if (!state) return { rematch: null, effects: [] };
      if (input.accept) return { rematch: null, effects: [{ kind: "accepted", by: input.bot }, { kind: "start" }] };
      return { rematch: null, effects: [{ kind: "cancelled", reason: "declined" }, { kind: "bot_leaves" }] };
  }
}

// P(accept) gate, RNG injected exactly like noobGuess(roll): tests pass a fixed
// roll; the DO passes Math.random(). roll < P ⇒ accept.
export function botAccepts(roll: number): boolean {
  return roll < BOT_REMATCH_ACCEPT_P;
}

// Earliest of the currently-armed wake deadlines (null/undefined ignored). null
// when nothing is pending. Drives the DO's single setAlarm().
export function nextAlarmAt(deadlines: Array<number | null | undefined>): number | null {
  const live = deadlines.filter((d): d is number => typeof d === "number");
  return live.length ? Math.min(...live) : null;
}
