export type Color = "hot" | "warm" | "cold";

export function scoreGuess(guess: string, answer: string): Color[] {
  const g = guess.toUpperCase();
  const a = answer.toUpperCase();
  const result: Color[] = new Array(g.length).fill("cold");
  const leftover: Record<string, number> = {};

  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) {
      result[i] = "hot";
    } else {
      leftover[a[i]] = (leftover[a[i]] ?? 0) + 1;
    }
  }
  for (let i = 0; i < g.length; i++) {
    if (result[i] === "hot") continue;
    const c = g[i];
    if ((leftover[c] ?? 0) > 0) {
      result[i] = "warm";
      leftover[c] -= 1;
    }
  }
  return result;
}

// --- EZ-mode power-up helpers (server-side: only the DO has the answer) ---

export function countVowels(word: string): number {
  return (word.toUpperCase().match(/[AEIOU]/g) ?? []).length;
}

// The set of positions a player has already pinned hot across all their guesses.
export function greenedPositions(guesses: { mask: Color[] }[]): Set<number> {
  const s = new Set<number>();
  for (const g of guesses) g.mask.forEach((c, i) => { if (c === "hot") s.add(i); });
  return s;
}

// Reveal one letter the player doesn't know yet — leftmost position that's neither
// greened nor already revealed (passed in `known`). null when nothing new is left,
// so repeated buys progressively uncover the word instead of repeating one letter.
export function revealUngreened(
  word: string,
  guesses: { mask: Color[] }[],
  known: number[] = [],
): { index: number; letter: string } | null {
  const seen = greenedPositions(guesses);
  for (const k of known) seen.add(k);
  for (let i = 0; i < word.length; i++) {
    if (!seen.has(i)) return { index: i, letter: word[i].toUpperCase() };
  }
  return null;
}
