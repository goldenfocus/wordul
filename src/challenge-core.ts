// src/challenge-core.ts — pure, dependency-free challenge logic (unit-tested).
import type { GhostTape } from "./ghost-core.ts";

export type ChallengeAttempt = {
  username: string;
  score: string;      // "3/6" or "X/6"
  solved: boolean;
  guesses: number;    // rows used
  at: number;         // epoch ms
};

export type ChallengeRecord = { username: string; score: string; guesses: number } | null;

export type ChallengeState = {
  id: string;
  word: string;
  wordLength: number;
  owner: string;
  ownerScore: string;
  ownerGrid: string[][];
  createdAt: number;
  attempts: ChallengeAttempt[];
  ghosts?: GhostTape;  // original race's replay tape (masks only); absent on plain challenges
};

export type ChallengeMeta = {
  id: string;
  owner: string;
  ownerScore: string;
  ownerGrid: string[][];
  wordLength: number;
  record: ChallengeRecord;
};

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function makeChallengeId(rng: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < 5; i++) id += B62[Math.floor(rng() * B62.length)];
  return id;
}

export function computeRecord(attempts: ChallengeAttempt[]): ChallengeRecord {
  const solved = attempts.filter((a) => a.solved);
  if (solved.length === 0) return null;
  solved.sort((a, b) => a.guesses - b.guesses || a.at - b.at);
  const best = solved[0];
  return { username: best.username, score: best.score, guesses: best.guesses };
}

export function toMeta(state: ChallengeState): ChallengeMeta {
  return {
    id: state.id,
    owner: state.owner,
    ownerScore: state.ownerScore,
    ownerGrid: state.ownerGrid,
    wordLength: state.wordLength,
    record: computeRecord(state.attempts),
  };
}

// The wordless ghost view — the ONLY shape /ghosts may return (answer never ships).
export function ghostsOf(state: ChallengeState): { ghosts: GhostTape | null } {
  return { ghosts: state.ghosts ?? null };
}
