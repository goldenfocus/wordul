// src/records.ts — pure: turn a finished room into one record per player.

import type { GameOutcome } from "./stats.ts";
export type Opponent = { username: string; result: GameOutcome; guesses: number };

export type GameRecord = {
  roomPath: string;
  finishedAt: number;
  wordLength: number;
  word: string;
  result: GameOutcome;
  guesses: number;
  opponents: Opponent[];
};

type FinishedPlayer = { username: string; status: "won" | "lost" | "playing"; guesses: number };

const outcome = (s: FinishedPlayer["status"]): GameOutcome => (s === "won" ? "won" : "lost");

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
