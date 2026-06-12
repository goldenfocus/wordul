// solver.ts — the blind brain of a worduler (v0.0000, "it twitches").
//
// SACRED INVARIANT: this module is structurally incapable of seeing the answer.
// It imports the public word lists and nothing else — not room.ts, not user.ts,
// not scoreGuess. Its ONLY game-state input is a BotView: the word length plus
// the color masks the bot itself earned. Making the answer reachable would mean
// editing this file's imports or the BotView type — a visible, test-guarded act.
//
// v0.0000 is deterministic and greedy: filter the answer pool by the masks, rank
// by letter frequency, take the top pick. No playstyle, no fallibility, no pacing,
// no identity, no persistence. Those are L0 and beyond. This just proves the brain
// can play one real game from masks alone — and can't peek.

import { WORDS_BY_SIZE } from "./wordsbysize.ts";
import type { Color } from "./color.ts";

/** The COMPLETE game-state surface the solver ever sees. There is no `word` field. */
export type BotView = {
  wordLength: number;
  ownGuesses: { word: string; mask: Color[] }[];
};

type Constraints = {
  greens: Map<number, string>;        // position -> letter that must sit there
  forbidden: Map<string, Set<number>>; // letter -> positions it canNOT sit (yellows)
  minCounts: Map<string, number>;     // letter -> at least this many occurrences
  maxCounts: Map<string, number>;     // letter -> at most this many (set by gray)
};

// Derive constraints from the masks only. The gray-as-upper-bound handling is the
// load-bearing subtlety: a letter that comes back green/yellow once AND gray once
// occurs EXACTLY once (gray means "no more"), not zero.
function buildConstraints(guesses: BotView["ownGuesses"]): Constraints {
  const greens = new Map<number, string>();
  const forbidden = new Map<string, Set<number>>();
  const minCounts = new Map<string, number>();
  const maxCounts = new Map<string, number>();

  for (const { word, mask } of guesses) {
    const g = word.toUpperCase();
    const nonGray: Record<string, number> = {}; // green+yellow count this guess
    const sawGray: Record<string, boolean> = {};

    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (mask[i] === "hot") {
        greens.set(i, c);
        nonGray[c] = (nonGray[c] ?? 0) + 1;
      } else if (mask[i] === "warm") {
        (forbidden.get(c) ?? forbidden.set(c, new Set()).get(c)!).add(i);
        nonGray[c] = (nonGray[c] ?? 0) + 1;
      } else {
        // gray: this exact position is not c, and it caps c's total count.
        (forbidden.get(c) ?? forbidden.set(c, new Set()).get(c)!).add(i);
        sawGray[c] = true;
      }
    }

    for (const c of Object.keys(nonGray)) {
      minCounts.set(c, Math.max(minCounts.get(c) ?? 0, nonGray[c]));
    }
    // A gray for c means the answer holds exactly the green+yellow count of c.
    for (const c of Object.keys(sawGray)) {
      const exact = nonGray[c] ?? 0;
      maxCounts.set(c, Math.min(maxCounts.get(c) ?? Infinity, exact));
    }
  }
  return { greens, forbidden, minCounts, maxCounts };
}

function matches(word: string, c: Constraints): boolean {
  const w = word.toUpperCase();
  for (const [pos, letter] of c.greens) {
    if (w[pos] !== letter) return false;
  }
  const counts: Record<string, number> = {};
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    counts[ch] = (counts[ch] ?? 0) + 1;
    const bad = c.forbidden.get(ch);
    if (bad?.has(i)) return false;
  }
  for (const [letter, min] of c.minCounts) {
    if ((counts[letter] ?? 0) < min) return false;
  }
  for (const [letter, max] of c.maxCounts) {
    if ((counts[letter] ?? 0) > max) return false;
  }
  return true;
}

// English letters by descending frequency. Rank a word by the sum of its DISTINCT
// letters' frequency weights — favors words that probe many common letters.
const FREQ = "ETAOINSHRDLCUMWFGYPBVKJXQZ";
const WEIGHT = new Map([...FREQ].map((ch, i) => [ch, FREQ.length - i]));

function rankScore(word: string): number {
  let score = 0;
  for (const ch of new Set(word.toUpperCase())) score += WEIGHT.get(ch) ?? 0;
  return score;
}

/**
 * Pick the next guess for a worduler, seeing only the public masks.
 * Greedy + deterministic: filter the answer pool, rank by letter frequency,
 * tie-break alphabetically. Falls back gracefully if nothing matches.
 *
 * `style` de-clones the cast: style k plays the k-th best consistent candidate
 * (mod however many remain), so two wordulers holding the same masks no longer
 * trace identical boards — the tell that exposed Nova and Juno as the same brain.
 * style 0 is the exact pre-style brain. INVARIANT: a style must be derived from
 * persona + room identity ONLY, never from anything answer-bearing — an
 * answer-derived style would smuggle the word through the blindness wall.
 */
export function computeNextGuess(view: BotView, style = 0): string {
  const pool = WORDS_BY_SIZE[view.wordLength]?.answers ?? [];
  const constraints = buildConstraints(view.ownGuesses);

  // Field name is `pick`, not `word` — the blindness guard greps solver source for
  // `.word` access (test/solver.test.ts) and must stay clean.
  const ranked: { pick: string; score: number }[] = [];
  for (const word of pool) {
    if (!matches(word, constraints)) continue;
    ranked.push({ pick: word, score: rankScore(word) });
  }
  // Empty candidate set (impossible constraints / unsupported length): never throw.
  // Fall back to the first pool word, or a same-length filler if the pool is empty.
  if (ranked.length === 0) return pool[0] ?? "A".repeat(view.wordLength);
  ranked.sort((a, b) => b.score - a.score || (a.pick < b.pick ? -1 : 1));
  const s = Number.isFinite(style) ? Math.abs(Math.trunc(style)) : 0;
  return ranked[s % ranked.length].pick;
}
