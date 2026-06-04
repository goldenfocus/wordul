// src/records.ts — pure: turn a finished room into one record per player.

import type { GameOutcome } from "./stats.ts";
import type { Color } from "./color.ts";
export type Opponent = { username: string; result: GameOutcome; guesses: number };

export type GameRecord = {
  roomPath: string;
  finishedAt: number;
  wordLength: number;
  word: string;
  result: GameOutcome;
  guesses: number;
  opponents: Opponent[];
  solveGrid?: string[];   // daily: the player's color pattern, one row string per guess
                          // ("g"=correct, "y"=present, "x"=absent) — powers the home stamp
};

// Pure: encode a player's guess masks into compact row strings for the home's solve
// stamp. green→"g", yellow→"y", gray→"x". (The letters never leave the server.)
const CELL: Record<Color, string> = { green: "g", yellow: "y", gray: "x" };
export function encodeSolveGrid(rows: { mask: Color[] }[]): string[] {
  return (rows ?? []).map((r) => (r?.mask ?? []).map((c) => CELL[c] ?? "x").join(""));
}

type FinishedPlayer = { username: string; status: "won" | "lost" | "playing"; guesses: number };

const outcome = (s: FinishedPlayer["status"]): GameOutcome => (s === "won" ? "won" : "lost");

// One compact summary per finished game, kept in room state for the Games tab.
export type RoomGame = {
  round: number;
  word: string;
  winner: string | null;
  solo: boolean;
  finishedAt: number;
  players: { username: string; result: GameOutcome; guesses: number }[];
};

// Pure: build a single room-history entry from the finished players + meta.
export function summarizeRoomGame(params: {
  round: number;
  word: string;
  winner: string | null;
  finishedAt: number;
  players: FinishedPlayer[];
}): RoomGame {
  const { round, word, winner, finishedAt, players } = params;
  return {
    round,
    word,
    winner,
    solo: players.length === 1,
    finishedAt,
    players: players.map((p) => ({ username: p.username, result: outcome(p.status), guesses: p.guesses })),
  };
}

export function buildGameRecords(params: {
  roomPath: string;
  word: string;
  wordLength: number;
  finishedAt: number;
  players: FinishedPlayer[];
}): Record<string, GameRecord> {
  const { roomPath, word, wordLength, finishedAt, players } = params;
  const out: Record<string, GameRecord> = {};
  for (const p of players) {
    out[p.username] = {
      roomPath, word, wordLength, finishedAt,
      result: outcome(p.status),
      guesses: p.guesses,
      opponents: players
        .filter((o) => o.username !== p.username)
        .map((o) => ({ username: o.username, result: outcome(o.status), guesses: o.guesses })),
    };
  }
  return out;
}
