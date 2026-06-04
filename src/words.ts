// src/words.ts — pure helpers for the word wiki. No Cloudflare deps.
import { WORDS_BY_SIZE } from "./wordsbysize.ts";
import { WORD_EXCLUSIONS } from "./word-exclusions.ts";

/** Every 5-letter answer word, uppercase. The wiki has one page per answer word.
 *  This stays 5-letter only — it backs the live, indexed sitemap. */
export const ANSWER_WORDS: Set<string> = new Set(WORDS_BY_SIZE[5].answers);

/** Answer pool for a given word length, uppercase. Length 5 returns the same set as
 *  ANSWER_WORDS; other lengths return WORDS_BY_SIZE[n].answers (which doubles as that
 *  length's answer + valid-guess pool). Returns an empty set for unsupported lengths.
 *  Additive helper for the multi-length wiki generators — does NOT feed ANSWER_WORDS,
 *  isWordPage, or the sitemap, so 5-letter behavior is unchanged. */
export function answerWordsForLength(n: number): Set<string> {
  const pool = WORDS_BY_SIZE[n];
  return pool ? new Set(pool.answers) : new Set<string>();
}

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
