// src/wordstats.ts — pure per-word aggregation (no Cloudflare deps), mirroring stats.ts.
import type { GameOutcome } from "./stats.ts";

export type WordStatsState = {
  answered: number;
  wins: number;
  guessSum: number; // sum of guesses across WINS only (for average)
  guessDistribution: Record<number, number>;
};

export type WordStatsView = {
  answered: number;
  solveRate: number;       // 0..1
  avgGuesses: number | null;
  guessDistribution: Record<number, number>;
  neverPlayed: boolean;
};

export function emptyWordStats(): WordStatsState {
  return { answered: 0, wins: 0, guessSum: 0, guessDistribution: {} };
}

export function applyWordGame(s: WordStatsState, game: { result: GameOutcome; guesses: number }): WordStatsState {
  const next: WordStatsState = { ...s, guessDistribution: { ...s.guessDistribution } };
  next.answered += 1;
  if (game.result === "won") {
    next.wins += 1;
    next.guessSum += game.guesses;
    next.guessDistribution[game.guesses] = (next.guessDistribution[game.guesses] ?? 0) + 1;
  }
  return next;
}

export function deriveWordStats(s: WordStatsState): WordStatsView {
  return {
    answered: s.answered,
    solveRate: s.answered ? s.wins / s.answered : 0,
    avgGuesses: s.wins ? s.guessSum / s.wins : null,
    guessDistribution: s.guessDistribution,
    neverPlayed: s.answered === 0,
  };
}
