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
  solveGrid?: string[];   // the player's color pattern, one row string per guess
                          // ("g"=correct, "y"=present, "x"=absent) — powers the solve stamp
  words?: string[];       // the player's guessed words (uppercase), parallel to solveGrid —
                          // the LETTERS for a full card. STRIPPED for the live daily in
                          // toPublicGame() so today's answer can never be scraped.
};

// The public projection of a finished game. Two things change vs the stored record:
//   • the redundant top-level `word` is always dropped (the answer also lives in the
//     winning row of `words`, and the client never reads `word`);
//   • for the CURRENT daily, `words` is dropped too — today's letters must never leave the
//     server, or anyone could fetch the answer without playing. Every PAST game keeps its
//     `words` so a full letter-card can render. `solveGrid` (colors) is always kept.
// Pass liveDailyPath = "daily/<activeDate>"; "" means "nothing is live" (reveal all letters).
export type PublicGameRecord = Omit<GameRecord, "word">;
export function toPublicGame(g: GameRecord, liveDailyPath = ""): PublicGameRecord {
  const { word, words, ...rest } = g;
  void word;
  if (liveDailyPath && g.roomPath === liveDailyPath) return rest; // live daily: no letters
  return { ...rest, words };
}

// Pure: encode a player's guess masks into compact row strings for the solve stamp.
// green→"g", yellow→"y", gray→"x".
const CELL: Record<Color, string> = { green: "g", yellow: "y", gray: "x" };
export function encodeSolveGrid(rows: { mask: Color[] }[]): string[] {
  return (rows ?? []).map((r) => (r?.mask ?? []).map((c) => CELL[c] ?? "x").join(""));
}

// Pure: the player's actual guessed words, uppercased, parallel to encodeSolveGrid's rows.
// Stored server-side so a finished game's full letter-card can render on profiles.
export function encodeSolveWords(rows: { word?: string }[]): string[] {
  return (rows ?? []).map((r) => String(r?.word ?? "").toUpperCase());
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
