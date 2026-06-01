// Count letters that turned green in the player's LATEST guess but were not green
// in any earlier guess — the "new green" moments worth celebrating. Pure + testable.
export function newGreensInLast(guesses) {
  if (!guesses || guesses.length === 0) return 0;
  const last = guesses[guesses.length - 1];
  if (!last || !last.mask) return 0;
  const wasGreen = new Set();
  for (let g = 0; g < guesses.length - 1; g++) {
    const mask = guesses[g].mask || [];
    for (let i = 0; i < mask.length; i++) if (mask[i] === "green") wasGreen.add(i);
  }
  let count = 0;
  for (let i = 0; i < last.mask.length; i++) {
    if (last.mask[i] === "green" && !wasGreen.has(i)) count++;
  }
  return count;
}
