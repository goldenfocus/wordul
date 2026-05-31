import type { Color } from "./color.ts";

export interface Env {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace;
  DESIGNS: R2Bucket;
}

export type GuessRow = { word: string; mask: Color[] };

export type PlayerState = {
  id: string;
  nickname: string;
  connected: boolean;
  guesses: GuessRow[];
  status: "playing" | "won" | "lost";
};

export type RoomPhase = "lobby" | "playing" | "finished";

export type ChatEntry =
  | { kind: "user"; from: string; text: string; t: number }
  | { kind: "system"; text: string; t: number };

export type RoomSnapshot = {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: PlayerState[];
  word: string | null;   // null while playing, revealed when finished
  winnerId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  round: number;
  chat: ChatEntry[];
  wordLength: number;    // letters per guess (4-12)
  maxGuesses: number;    // rows per board, derived from wordLength
};

export type ClientMessage =
  | { type: "hello"; nickname: string; playerId: string; wordLength?: number }
  | { type: "start" }
  | { type: "guess"; word: string }
  | { type: "rematch" }
  | { type: "chat"; text: string }
  | { type: "set_length"; wordLength: number }
  | { type: "ping" };

export type ServerMessage =
  | { type: "snapshot"; room: RoomSnapshot }
  | { type: "error"; message: string }
  | { type: "invalid_guess"; reason: string }
  | { type: "pong" };
