// src/economy.ts — pure, shared economy math (server + tests). No DOM, no I/O.
// Ported from public/celebrate.js (discovery helpers) and public/gold.js (constants),
// so the ROOM Durable Object computes the exact same numbers the client animates.
import type { Color } from "./color.ts";

export type GuessRow = { word: string; mask: Color[] };
// Optional per-component breakdown of a single earning (e.g. score / daily / speed).
// Invariant: Σ parts.delta === delta when present.
export type LedgerPart = { label: string; delta: number };
export type LedgerTx = { token: string; delta: number; reason: string; ts: number; ref?: string; parts?: LedgerPart[] };

export const POINTS = {
  green: 100,
  yellow: 50,
  solve: 500,
  speedPerGuessLeft: 300,
  revealCost: 4000,
  vowelCost: 200,
  wastedLetterPenalty: 50,
  wastedCapPerGuess: 200,
};

// 2 hits -> 1.5x, 3 -> 2x, 4 -> 2.5x, 5 -> 3x.
export function comboMultiplier(discoveries: number): number {
  return discoveries >= 2 ? 1 + (discoveries - 1) * 0.5 : 1;
}

// --- Time bonus (section C): a wall-clock speed reward, separate from the
// per-guess speedPerGuessLeft bonus baked into pointsEarned. Linear decay from
// SPEED_CAP at 0ms down to 0 once the window elapses; clamped to >= 0.
export const SPEED_CAP = 500;
export const SPEED_WINDOW_MS = 180000; // 3 minutes
export function speedBonusPoints(elapsedMs: number): number {
  return Math.max(0, Math.round(SPEED_CAP * (1 - elapsedMs / SPEED_WINDOW_MS)));
}

// 1st reuse of a dead letter = base, 2nd = 2x base, ...
export function escalatedPenalty(base: number, reuseCount: number): number {
  return base * (Math.max(0, reuseCount) + 1);
}

// New discoveries in the LATEST guess — yellows first, then greens, ascending index.
// NO DOUBLE-PAY (section D):
//   • GREEN dedups by POSITION — a column pays its green once, even if a yellow→green
//     upgrade lands there (the upgrade still earns, because that position was never green).
//   • YELLOW dedups by LETTER — a yellow pays only if that LETTER wasn't already proven
//     present (yellow OR green at any position) in a prior guess. A "moving" yellow that
//     just relocates a known-present letter earns nothing.
export function orderedDiscoveriesInLast(
  guesses: GuessRow[],
): { index: number; kind: "warm" | "hot"; letter: string }[] {
  if (!guesses || guesses.length === 0) return [];
  const last = guesses[guesses.length - 1];
  if (!last || !last.mask) return [];
  const wasGreen = new Set<number>();        // positions already hot
  const provenPresent = new Set<string>();   // letters already proven present (warm OR hot)
  for (let g = 0; g < guesses.length - 1; g++) {
    const mask = guesses[g].mask || [];
    const w = guesses[g].word || "";
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === "hot") {
        wasGreen.add(i);
        provenPresent.add((w[i] || "").toUpperCase());
      } else if (mask[i] === "warm") {
        provenPresent.add((w[i] || "").toUpperCase());
      }
    }
  }
  const word = last.word || "";
  const out: { index: number; kind: "warm" | "hot"; letter: string }[] = [];
  for (let i = 0; i < last.mask.length; i++) {
    if (last.mask[i] === "warm" && !provenPresent.has((word[i] || "").toUpperCase())) {
      out.push({ index: i, kind: "warm", letter: word[i] });
    }
  }
  for (let i = 0; i < last.mask.length; i++) {
    if (last.mask[i] === "hot" && !wasGreen.has(i)) out.push({ index: i, kind: "hot", letter: word[i] });
  }
  return out;
}

// Letters PROVEN dead: gray somewhere and never green/yellow at any position (dup-safe).
export function deadLettersFrom(guesses: GuessRow[]): Set<string> {
  if (!guesses || guesses.length === 0) return new Set();
  const good = new Set<string>();
  for (const g of guesses) {
    if (!g || !g.mask) continue;
    const word = g.word || "";
    for (let i = 0; i < g.mask.length; i++) {
      if (g.mask[i] === "hot" || g.mask[i] === "warm") good.add((word[i] || "").toUpperCase());
    }
  }
  const dead = new Set<string>();
  for (const g of guesses) {
    if (!g || !g.mask) continue;
    const word = g.word || "";
    for (let i = 0; i < g.mask.length; i++) {
      if (g.mask[i] === "cold") {
        const c = (word[i] || "").toUpperCase();
        if (c && !good.has(c)) dead.add(c);
      }
    }
  }
  return dead;
}

// Unique already-dead letters reused in the latest guess (knowledge from PRIOR guesses).
export function wastedDeadLettersInLast(guesses: GuessRow[]): { letters: string[]; count: number } {
  if (!guesses || guesses.length < 2) return { letters: [], count: 0 };
  const last = guesses[guesses.length - 1];
  if (!last || !last.word) return { letters: [], count: 0 };
  const dead = deadLettersFrom(guesses.slice(0, -1));
  const seen = new Set<string>();
  const letters: string[] = [];
  const word = last.word || "";
  for (let i = 0; i < word.length; i++) {
    const c = (word[i] || "").toUpperCase();
    if (dead.has(c) && !seen.has(c)) {
      seen.add(c);
      letters.push(c);
    }
  }
  return { letters, count: letters.length };
}

// Deterministic total Points earned across a whole guess sequence (no spends).
// Walks guess-by-guess so wasted-letter penalties escalate exactly like the client.
export function pointsEarned(guesses: GuessRow[], maxGuesses: number): number {
  if (!guesses || guesses.length === 0) return 0;
  let pts = 0;
  const reuse = new Map<string, number>();
  for (let k = 0; k < guesses.length; k++) {
    const upto = guesses.slice(0, k + 1);
    const disc = orderedDiscoveriesInLast(upto);
    const base = disc.reduce((s, d) => s + (d.kind === "hot" ? POINTS.green : POINTS.yellow), 0);
    pts += Math.round(base * comboMultiplier(disc.length));
    const wasted = wastedDeadLettersInLast(upto);
    let pen = 0;
    for (const letter of wasted.letters) {
      const c = reuse.get(letter) ?? 0;
      pen += escalatedPenalty(POINTS.wastedLetterPenalty, c);
      reuse.set(letter, c + 1);
    }
    pts -= Math.min(pen, POINTS.wastedCapPerGuess);
  }
  const last = guesses[guesses.length - 1];
  if (last && last.mask.length > 0 && last.mask.every((c) => c === "hot")) {
    const guessesLeft = Math.max(0, maxGuesses - guesses.length);
    pts += POINTS.solve + POINTS.speedPerGuessLeft * guessesLeft;
  }
  return pts;
}

// Cash-out conversion. Tunable. Never mints negative gold from a single bad game.
export function goldFromPoints(points: number): number {
  return Math.max(0, Math.round(points / 100));
}

// --- Settlement (Phase 1 spec: docs/superpowers/specs/2026-06-05-gold-settlement-engine-design.md)
// The Law: wallet moves only at game edges. This is the edge.
//   minted = round(points/100) · earned = round(minted × mult)
//   payout = buyIn + earned − spends + bonus, clamped ≥ 0 unless `signed` (hard-mode preset).
export type SettlementInput = {
  buyIn: number; points: number; mult: number; spends: number; bonus: number;
  signed?: boolean;
};
export type SettlementReceipt = {
  buyIn: number; points: number; minted: number; mult: number; earned: number;
  spends: number; bonus: number; payout: number; net: number; signed: boolean;
};
export function settle(i: SettlementInput): SettlementReceipt {
  const minted = Math.max(0, Math.round(i.points / 100));
  const earned = Math.round(minted * i.mult);
  const raw = i.buyIn + earned - i.spends + i.bonus;
  const payout = i.signed ? raw : Math.max(0, raw);
  return {
    buyIn: i.buyIn, points: i.points, minted, mult: i.mult, earned,
    spends: i.spends, bonus: i.bonus, payout, net: payout - i.buyIn, signed: !!i.signed,
  };
}
// Ledger legs for the settle tx. Invariant: Σ parts.delta === payout − buyIn (the settle
// delta when buy-in is its own tx — and equals payout while buyIn is 0 in Phase 1).
export function settleParts(r: SettlementReceipt): LedgerPart[] {
  const parts: LedgerPart[] = [];
  if (r.earned) parts.push({ label: "score", delta: r.earned });
  if (r.spends) parts.push({ label: "power-ups", delta: -r.spends });
  if (r.bonus) parts.push({ label: "bonus", delta: r.bonus });
  const floor = r.payout - (r.buyIn + r.earned - r.spends + r.bonus);
  if (floor !== 0) parts.push({ label: "house floor", delta: floor });
  return parts;
}

// Sum of signed deltas for one token. Allows negative (day-one credit card).
export function balance(ledger: LedgerTx[], token: string): number {
  return (ledger || []).reduce((s, tx) => (tx.token === token ? s + tx.delta : s), 0);
}
