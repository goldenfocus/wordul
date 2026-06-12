// A blind, fallible, slow opponent. Wraps the sharp solver: most turns it plays the
// optimal guess, but when `roll < mistakeRate` it commits a believable human slip — a
// legal word that still HONORS every confirmed green (a slip, not insanity).
//
// Structurally blind by construction: imports only the solver (which never sees the
// answer) and the word pools. test/noob.test.ts enforces this with a src-reading regex.
import { computeNextGuess, type BotView } from "./solver.ts";
import { WORDS_BY_SIZE } from "./wordsbysize.ts";

export type NoobProfile = { mistakeRate: number }; // [0,1)
export const NOOB: NoobProfile = { mistakeRate: 0.4 };

// Longer words AND bigger fields are harder, so a fixed rate would make either unwinnable.
// Scale fallibility UP with length (+0.06/letter over 5) and with field size (+0.05 per extra
// opponent over 1), capped strictly below certainty. Still 100% blind — this only changes how
// often noobGuess takes the believable-slip branch, never what it can see. `opponents` = the
// number of OTHER players the bot races (players.length − 1); defaults to 1 (single-bot parity).
export function mistakeRateFor(length: number, opponents = 1): number {
  const lengthRate = NOOB.mistakeRate + 0.06 * Math.max(0, length - 5);
  const fieldBump = 0.05 * Math.max(0, opponents - 1);
  return Math.min(0.85, lengthRate + fieldBump);
}

// Confirmed greens: position -> required uppercase letter, derived from masks only.
function greensFromView(guesses: BotView["ownGuesses"]): Map<number, string> {
  const greens = new Map<number, string>();
  for (const { word, mask } of guesses) {
    const w = word.toUpperCase();
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === "hot") greens.set(i, w[i]);
    }
  }
  return greens;
}

function honorsGreens(word: string, greens: Map<number, string>): boolean {
  for (const [pos, letter] of greens) {
    if (word[pos] !== letter) return false;
  }
  return true;
}

/**
 * roll in [0,1): tests pass fixed values; the DO passes Math.random(). Never computed here.
 * roll >= mistakeRate → the sharp guess (note >=, so roll===mistakeRate plays sharp).
 * `style` (per-persona, see bots.botStyleFor) passes through to the solver so each
 * persona's sharp line differs — without it every persona shares one brain and plays
 * clone boards. Must never be derived from anything answer-bearing.
 */
export function noobGuess(view: BotView, profile: NoobProfile, roll: number, style = 0): string {
  const sharp = computeNextGuess(view, style);
  if (roll >= profile.mistakeRate) return sharp;

  const answers = WORDS_BY_SIZE[view.wordLength]?.answers ?? [];
  const greens = greensFromView(view.ownGuesses);
  const candidates = answers.filter((w) => w !== sharp && honorsGreens(w, greens));
  if (candidates.length === 0) return sharp; // no believable slip available → play sharp

  // Pick a roll-seeded sub-optimal candidate rather than the strict worst — avoids the
  // learnable "honors greens perfectly, forgets everything else" tell (review fix #8).
  const idx = Math.floor((roll / profile.mistakeRate) * candidates.length) % candidates.length;
  return candidates[idx];
}
