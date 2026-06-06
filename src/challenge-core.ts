// src/challenge-core.ts — pure, dependency-free challenge logic (unit-tested).
import type { GhostTape } from "./ghost-core.ts";
import type { Color } from "./color.ts";

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
  kind?: "word";       // canonical per-word leaderboard challenge (wiki CTA) vs a personal share
};

export type ChallengeMeta = {
  id: string;
  owner: string;
  ownerScore: string;
  ownerGrid: string[][];
  wordLength: number;
  record: ChallengeRecord;
  kind?: "word";
  attempts: number;    // scored attempts so far (one per username) — the wiki "N raced it"
};

// Death is final: a challenge room plays exactly ONE round per player. Scoring was
// always one-shot (addAttempt), but the room used to allow unscored replays of the
// same pinned word that *rendered* as real wins — a loss must end the run for good,
// like dying in a live race. round >= 1 ⇒ this room already played its round.
export function challengeRoundLocked(challengeId: string | null, round: number): boolean {
  return !!challengeId && round >= 1;
}

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function makeChallengeId(rng: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < 5; i++) id += B62[Math.floor(rng() * B62.length)];
  return id;
}

// Deterministic id for a word's CANONICAL challenge (its public leaderboard), from a
// hash digest of the word. Opaque on purpose: /c/OCEAN would spoil the answer; a
// hash-derived id spoils nothing. Pure over bytes so it's unit-testable — the worker
// supplies crypto.subtle.digest("SHA-256", "word:<WORD>") bytes.
export function wordChallengeIdFromBytes(bytes: Uint8Array): string {
  let id = "";
  for (let i = 0; i < 5; i++) id += B62[bytes[i] % B62.length];
  return id;
}

// One-shot scoring: a username's FIRST attempt is their attempt, forever — repeats
// return true and change nothing. This keeps "beat my 3/6" honest: nobody quietly
// re-rolls until the record falls. Mutates `attempts` in place (DO storage style).
export function addAttempt(attempts: ChallengeAttempt[], a: ChallengeAttempt): boolean {
  if (attempts.some((x) => x.username === a.username)) return true;
  attempts.push(a);
  return false;
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
    kind: state.kind,
    attempts: state.attempts.length,
  };
}

// The wordless ghost view — the ONLY shape /ghosts may return (answer never ships).
export function ghostsOf(state: ChallengeState): { ghosts: GhostTape | null } {
  return { ghosts: state.ghosts ?? null };
}

// Mint-time gate for CLIENT-supplied tapes (POST /api/challenge forwards raw JSON
// into the DO). Rebuilds the tape from scratch — only known keys survive, masks are
// colors-only, t is finite + monotonic — or drops it whole. A bad tape never blocks
// the mint; the challenge just stays ghost-less, like before.
const COLORS = new Set(["hot", "warm", "cold"]);

export function sanitizeGhosts(input: unknown): GhostTape | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const t = input as Record<string, unknown>;
  if (t.v !== 1) return undefined;
  const wordLength = t.wordLength;
  const maxGuesses = t.maxGuesses;
  if (!Number.isInteger(wordLength) || (wordLength as number) < 3 || (wordLength as number) > 12) return undefined;
  if (!Number.isInteger(maxGuesses) || (maxGuesses as number) < 1 || (maxGuesses as number) > 12) return undefined;
  if (!Array.isArray(t.players) || t.players.length === 0 || t.players.length > 16) return undefined;
  const players: GhostTape["players"] = [];
  for (const p of t.players as unknown[]) {
    if (typeof p !== "object" || p === null) return undefined;
    const { username, host } = p as Record<string, unknown>;
    if (typeof username !== "string" || username.length === 0 || username.length > 32) return undefined;
    players.push({ username, host: host === true });
  }
  if (!Array.isArray(t.events) || t.events.length > 5000) return undefined;
  const events: GhostTape["events"] = [];
  let lastT = 0;
  for (const e of t.events as unknown[]) {
    if (typeof e !== "object" || e === null) return undefined;
    const ev = e as Record<string, unknown>;
    if (typeof ev.t !== "number" || !Number.isFinite(ev.t) || ev.t < lastT) return undefined;
    if (typeof ev.u !== "string" || ev.u.length === 0 || ev.u.length > 32) return undefined;
    lastT = ev.t;
    if (ev.k === "typing") {
      if (!Number.isInteger(ev.len) || (ev.len as number) < 0 || (ev.len as number) > (wordLength as number)) return undefined;
      events.push({ t: ev.t, u: ev.u, k: "typing", len: ev.len as number });
    } else if (ev.k === "guess") {
      if (ev.status !== "playing" && ev.status !== "won" && ev.status !== "lost") return undefined;
      if (!Array.isArray(ev.mask) || ev.mask.length !== wordLength) return undefined;
      if (!(ev.mask as unknown[]).every((c) => typeof c === "string" && COLORS.has(c))) return undefined;
      events.push({ t: ev.t, u: ev.u, k: "guess", mask: (ev.mask as Color[]).slice(), status: ev.status });
    } else if (ev.k === "finish") {
      if (ev.status !== "won" && ev.status !== "lost") return undefined;
      if (!Number.isInteger(ev.guesses) || (ev.guesses as number) < 0 || (ev.guesses as number) > (maxGuesses as number)) return undefined;
      events.push({ t: ev.t, u: ev.u, k: "finish", status: ev.status, guesses: ev.guesses as number });
    } else {
      return undefined;
    }
  }
  return { v: 1, wordLength: wordLength as number, maxGuesses: maxGuesses as number, players, events };
}
