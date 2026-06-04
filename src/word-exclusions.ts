// src/word-exclusions.ts — answer words that should NOT get a public, indexed wiki
// page. They still play in-game; their page route returns a friendly 404. Keep this
// list small and lowercase. Single source of truth (worker + build generator both read it).
export const WORD_EXCLUSIONS: string[] = [
  // e.g. "bitch", "boobs" — fill from a profanity pass before first publish.
];
