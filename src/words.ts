// src/words.ts — pure helpers for the word wiki. No Cloudflare deps.
import { WORDS_BY_SIZE } from "./wordsbysize.ts";
import { WORD_EXCLUSIONS } from "./word-exclusions.ts";

/** Every 5-letter answer word, uppercase. The wiki has one page per answer word. */
export const ANSWER_WORDS: Set<string> = new Set(WORDS_BY_SIZE[5].answers);

const EXCLUDED = new Set(WORD_EXCLUSIONS.map((w) => w.toUpperCase()));

/** True when this word should have a public, indexed page. */
export function isWordPage(word: string): boolean {
  const w = String(word).toUpperCase();
  return ANSWER_WORDS.has(w) && !EXCLUDED.has(w);
}

export function slugFor(word: string): string {
  return String(word).toLowerCase();
}
export function wordFromSlug(slug: string): string {
  return String(slug).toUpperCase();
}

/** Deterministic "word of the day": days-since-epoch indexed into the answer list
 *  (sorted for stability). Independent of the multiplayer random-word picker — this is
 *  a purely editorial wiki feature. */
const SORTED_ANSWERS = [...ANSWER_WORDS].sort();
export function wordOfTheDay(date: Date): string {
  const n = SORTED_ANSWERS.length;
  const day = Math.floor(date.getTime() / 86_400_000);
  return SORTED_ANSWERS[((day % n) + n) % n];
}
